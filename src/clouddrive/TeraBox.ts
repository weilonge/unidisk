import { EventEmitter } from 'events'
import https from 'https'
import http from 'http'
import path from 'path'
import { logger } from '../helper/logger'
import type {
  StorageProvider,
  ProviderProfile,
  FileEntry,
  FileMetaData,
  DownloadResponse,
  QuotaInfo,
} from '../types'
import { RetryableError } from '../helper/RetryableError'

/**
 * TeraBox cloud-storage provider.
 *
 * Authentication:
 *   Requires the long-lived `ndus` cookie from a TeraBox session.
 *   Log in at terabox.com, open DevTools → Application → Cookies and copy
 *   the value of the `ndus` cookie.  Put it in your settings.json profile:
 *
 *   {
 *     "module": "TeraBox",
 *     "cacheStore": "disk",
 *     "cachePath": "/tmp/terabox-cache",
 *     "ndus": "<paste ndus value here>"
 *   }
 *
 * Write support:
 *   This version is read-only.  Mutation methods (createEmptyFile,
 *   writeFileData, deleteFile, deleteFolder, createFolder, move) are
 *   implemented for the simpler cases (folder ops, delete, move) but
 *   write/upload is not yet wired up.
 */

// ---------------------------------------------------------------------------
// TeraBox API shape (partial — only what we use)
// ---------------------------------------------------------------------------

interface TBListEntry {
  fs_id:           number
  path:            string
  server_filename: string
  size:            number
  server_mtime:    number   // Unix seconds
  server_ctime:    number   // Unix seconds
  isdir:           number   // 0 = file, 1 = directory
  md5?:            string
}

interface TBListResponse {
  errno: number
  list:  TBListEntry[]
}

interface TBDownloadEntry {
  fs_id: number
  dlink: string
}

interface TBDownloadResponse {
  errno: number
  dlink?: TBDownloadEntry[]        // actual API response (confirmed)
  list?: TBDownloadEntry[]         // alternative shape seen in some docs
  data?: { dlink?: TBDownloadEntry[] }  // another alternative shape
}

interface TBQuotaResponse {
  errno: number
  total: number
  used:  number
  available?: number
}

interface TeraBoxProfile extends ProviderProfile {
  /** Long-lived ndus cookie value obtained from a browser session. */
  ndus: string
}

// ---------------------------------------------------------------------------
// DLink cache entry
// ---------------------------------------------------------------------------

interface DLinkEntry {
  url:       string
  expiresAt: number
}

// ---------------------------------------------------------------------------
// HTTP helper: Range GET with redirect following
// ---------------------------------------------------------------------------

/**
 * Fetches a byte range from a URL, following up to `maxRedirects` HTTP
 * redirects.  Returns the response body as a Buffer.
 */
function rangeGet(
  url:          string,
  headers:      Record<string, string>,
  maxRedirects: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function doRequest(reqUrl: string, remaining: number): void {
      if (remaining < 0) {
        reject(new Error('Too many redirects'))
        return
      }

      const lib = reqUrl.startsWith('https') ? https : http
      const req = lib.get(reqUrl, { headers }, res => {
        const { statusCode, headers: resHeaders } = res

        if (statusCode === 301 || statusCode === 302 ||
            statusCode === 303 || statusCode === 307 || statusCode === 308) {
          res.resume()   // discard body
          const location = resHeaders.location
          if (!location) { reject(new Error('Redirect with no Location')); return }
          doRequest(location, remaining - 1)
          return
        }

        if (statusCode !== 200 && statusCode !== 206) {
          res.resume()
          reject(new Error(`HTTP ${statusCode}`))
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end',  () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })

      req.on('error', reject)
      req.setTimeout(15_000, () => {
        req.destroy(new Error('Request timed out'))
      })
    }

    doRequest(url, maxRedirects)
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class TeraBox extends EventEmitter implements StorageProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _app: any = null
  private _profile: TeraBoxProfile | null = null
  private _initPromise: Promise<void> | null = null

  // path → fs_id, populated whenever we list a directory
  private readonly _fsIdCache = new Map<string, number>()

  // fs_id → { url, expiresAt }, dlinks are valid ~1 h from TeraBox
  private readonly _dlinkCache = new Map<number, DLinkEntry>()

  // ---- Lifecycle -----------------------------------------------------------

  init(options: ProviderProfile): void {
    this._profile = options as TeraBoxProfile
    if (!this._profile.ndus) {
      throw new Error('TeraBox: "ndus" cookie token is required in the profile')
    }
  }

  /**
   * Lazily initialise the TeraBoxApp and refresh tokens.
   * Called by every public method before touching the API.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _ensureApp(): Promise<any> {
    if (this._app) return this._app
    // Deduplicate concurrent callers — only one init in flight at a time.
    if (!this._initPromise) {
      this._initPromise = (async () => {
        // terabox-api ships as an ES module; dynamic import works from CJS.
        const mod = await import('terabox-api')
        const TBApp = mod.TeraBoxApp ?? mod.default
        const app = new TBApp(this._profile!.ndus)
        await app.updateAppData()
        this._app = app
      })()
    }
    await this._initPromise
    return this._app
  }

  // ---- StorageProvider: illegal filenames ---------------------------------

  isIllegalFileName(filePath: string): boolean {
    return filePath.includes('/._')
  }

  // ---- StorageProvider: metadata ------------------------------------------

  async getFileList(dirPath: string): Promise<{ data: FileMetaData | null }> {
    const app = await this._ensureApp()
    const res = (await app.getRemoteDir(dirPath)) as TBListResponse

    if (res.errno !== 0) {
      return { data: null }
    }

    const entries = (res.list ?? []).map(e => this._toFileEntry(e))
    return { data: { list: entries } }
  }

  async getFileMeta(filePath: string): Promise<{ data: FileMetaData | null }> {
    // Root always exists as a directory — no API call needed and the listing
    // contains children, not the root entry itself.
    if (filePath === '/') {
      return {
        data: {
          list: [{ isdir: 1, path: '/', size: 0, mtime: Date.now(), ctime: Date.now() }],
        },
      }
    }

    // Always list the parent directory; this populates _fsIdCache for the
    // file so getFileDownload can resolve the fs_id without extra API calls.
    const dir = path.dirname(filePath)
    const listRes = await this.getFileList(dir)

    if (!listRes.data) return { data: null }

    const match = listRes.data.list.find(e => e.path === filePath)
    if (!match) return { data: null }

    return { data: { list: [match] } }
  }

  // ---- StorageProvider: download ------------------------------------------

  async getFileDownload(
    filePath: string,
    offset:   number,
    size:     number
  ): Promise<DownloadResponse> {
    const app = await this._ensureApp()

    // Resolve fs_id (list the parent dir if not yet cached)
    let fsId = this._fsIdCache.get(filePath)
    if (fsId === undefined) {
      await this.getFileMeta(filePath)
      fsId = this._fsIdCache.get(filePath)
      if (fsId === undefined) {
        throw new Error(`TeraBox: cannot resolve fs_id for "${filePath}"`)
      }
    }

    // Get (or renew) the download link
    const dlink = await this._getDlink(app, fsId)

    // HTTP Range request, following up to 10 redirects
    const rangeEnd = offset + size - 1
    const extraHeaders: Record<string, string> = {
      'Range':      `bytes=${offset}-${rangeEnd}`,
      'User-Agent': app.params.ua as string,
      'Cookie':     app.params.cookie as string,
    }

    let data: Buffer
    try {
      data = await rangeGet(dlink, extraHeaders, 10)
    } catch (err) {
      const msg = (err as Error).message
      // Evict the cached dlink only for HTTP auth/permission errors (4xx/5xx).
      // Transient network failures (socket hang up, timeout, ETIMEDOUT) do NOT
      // mean the dlink itself has expired — evicting it on every network hiccup
      // forces an unnecessary ~6 s TeraBox API round-trip before each retry,
      // which pushes the total retry window past the FUSE kernel read timeout.
      if (/HTTP [45]/.test(msg)) {
        this._dlinkCache.delete(fsId)
      }
      throw new Error(`TeraBox: download failed for "${filePath}": ${msg}`)
    }

    // If the CDN returned fewer bytes than requested it usually means it sent
    // a throttle/error JSON body instead of file content.  Log the raw body,
    // then surface the errno as a proper Error so the retry log is meaningful
    // (e.g. "errno=424629 need verify") rather than "Block size mismatch".
    if (data.length < size) {
      const bodyText = data.slice(0, 300).toString('utf8')
      logger.verbose(
        `TeraBox: CDN short response for "${filePath}" @${offset}: ` +
        `got ${data.length} B (wanted ${size} B) — body: ${bodyText}`
      )
      try {
        const parsed = JSON.parse(bodyText) as { errno?: number; errmsg?: string }
        if (typeof parsed.errno === 'number' && parsed.errno !== 0) {
          const msg = `TeraBox: CDN errno=${parsed.errno} "${parsed.errmsg ?? ''}" for "${filePath}"`
          // errno=424629 ("need verify") is a per-session CDN throttle that
          // clears within ~1–5 s.  Signal the retry loop to back off longer.
          throw parsed.errno === 424629
            ? new RetryableError(msg, 3000)
            : new Error(msg)
        }
      } catch (parseErr) {
        // Re-throw only errors we constructed above; ignore JSON parse failures.
        if ((parseErr as Error).message.startsWith('TeraBox:')) throw parseErr
      }
    }

    return { data: data.subarray(0, size), length: data.length }
  }

  // ---- StorageProvider: quota ---------------------------------------------

  async quota(): Promise<{ data: QuotaInfo }> {
    const app = await this._ensureApp()
    const res = (await app.getQuota()) as TBQuotaResponse

    if (res.errno !== 0) {
      throw new Error(`TeraBox: quota API error (errno=${res.errno})`)
    }

    return { data: { quota: res.total, used: res.used } }
  }

  // ---- StorageProvider: file handles (no-op for read-only) ----------------

  async openFile(_path: string, _flags: string, _fd: number): Promise<void> {
    // TeraBox has no server-side open; downloads are stateless Range GETs.
  }

  async closeFile(_path: string, _fd: number): Promise<void> {
    // Nothing to release.
  }

  // ---- StorageProvider: mutations -----------------------------------------

  async deleteFile(filePath: string): Promise<void> {
    const app = await this._ensureApp()
    const res = await app.filemanager('delete', [filePath])
    if (res.errno !== 0) {
      throw new Error(`TeraBox: delete failed (errno=${res.errno}) for "${filePath}"`)
    }
    this._fsIdCache.delete(filePath)
  }

  async deleteFolder(filePath: string): Promise<void> {
    const app = await this._ensureApp()
    const res = await app.filemanager('delete', [filePath])
    if (res.errno !== 0) {
      throw new Error(`TeraBox: deleteFolder failed (errno=${res.errno}) for "${filePath}"`)
    }
    this._fsIdCache.delete(filePath)
  }

  async createFolder(filePath: string): Promise<void> {
    const app = await this._ensureApp()
    const res = await app.createDir(filePath)
    if (res.errno !== 0) {
      throw new Error(`TeraBox: createFolder failed (errno=${res.errno}) for "${filePath}"`)
    }
  }

  async move(src: string, dst: string): Promise<void> {
    const app = await this._ensureApp()
    const destDir  = path.dirname(dst)
    const newName  = path.basename(dst)
    const res = await app.filemanager('move', [
      { path: src, dest: destDir, newname: newName },
    ])
    if (res.errno !== 0) {
      throw new Error(`TeraBox: move failed (errno=${res.errno}) "${src}" → "${dst}"`)
    }
    // Invalidate cached fs_id for the old path
    this._fsIdCache.delete(src)
  }

  // Write path — not yet implemented ----------------------------------------

  async createEmptyFile(_filePath: string): Promise<void> {
    throw new Error('TeraBox: file upload not yet implemented')
  }

  async writeFileData(
    _path: string, _fd: number, _buffer: Buffer, _offset: number, _length: number
  ): Promise<{ length: number }> {
    throw new Error('TeraBox: file upload not yet implemented')
  }

  async commitFileData(_path: string, _fd: number): Promise<void> {
    // No-op: called by UdManager after closeFile; safe to ignore for read-only.
  }

  // ---- Private helpers ----------------------------------------------------

  /** Convert a TeraBox list entry to a FileEntry and cache its fs_id. */
  private _toFileEntry(entry: TBListEntry): FileEntry {
    this._fsIdCache.set(entry.path, entry.fs_id)
    return {
      isdir: entry.isdir === 1 ? 1 : 0,
      path:  entry.path,
      size:  entry.size ?? 0,
      mtime: entry.server_mtime * 1000,   // seconds → milliseconds
      ctime: entry.server_ctime * 1000,
    }
  }

  /**
   * Returns a cached dlink URL for the given fs_id, refreshing it when the
   * TTL has elapsed.  TeraBox dlinks are valid for ~1 hour; we cache for 50
   * minutes to stay comfortably within that window.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _getDlink(app: any, fsId: number): Promise<string> {
    const cached = this._dlinkCache.get(fsId)
    if (cached && cached.expiresAt > Date.now()) return cached.url

    const res = (await app.download([fsId])) as TBDownloadResponse
    if (res.errno !== 0) {
      throw new Error(`TeraBox: download API error (errno=${res.errno}) for fs_id=${fsId}`)
    }

    // TeraBox API response shape (confirmed): { dlink: [{ fs_id, dlink }] }
    // Guard against alternative shapes seen in older docs just in case.
    const item = res.dlink?.[0] ?? res.list?.[0] ?? res.data?.dlink?.[0]
    if (!item?.dlink) {
      logger.error(`TeraBox: no dlink in response for fs_id=${fsId}`)
      logger.verbose(`TeraBox: download response was: ${JSON.stringify(res, null, 2)}`)
      throw new Error(`TeraBox: no dlink returned for fs_id=${fsId}`)
    }

    this._dlinkCache.set(fsId, {
      url:       item.dlink,
      expiresAt: Date.now() + 50 * 60 * 1000,  // 50 minutes
    })

    return item.dlink
  }
}
