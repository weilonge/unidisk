import { EventEmitter } from 'events'
import https from 'https'
import type {
  StorageProvider,
  ProviderProfile,
  FileEntry,
  FileMetaData,
  DownloadResponse,
  QuotaInfo,
} from '../types'

/**
 * Dropbox cloud-storage provider.
 *
 * Authentication:
 *   Obtain a long-lived access token from the Dropbox developer console
 *   (https://www.dropbox.com/developers/apps) and add it to your profile:
 *
 *   {
 *     "module": "Dropbox",
 *     "cacheStore": "disk",
 *     "cachePath": "/tmp/dropbox-cache",
 *     "token": "<access token>"
 *   }
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_HOST     = 'api.dropboxapi.com'
const CONTENT_HOST = 'content.dropboxapi.com'
const NOTIFY_HOST  = 'notify.dropboxapi.com'

/** Socket idle timeout for every HTTPS request. */
const HTTP_TIMEOUT_MS = 30_000

/** How long to wait before retrying the long-poll loop after an error. */
const LONGPOLL_RETRY_DELAY_MS = 5_000

// ---------------------------------------------------------------------------
// Dropbox API shape (partial)
// ---------------------------------------------------------------------------

interface DBEntry {
  '.tag':           'file' | 'folder' | 'deleted'
  path_lower:       string
  size?:            number
  server_modified?: string   // ISO 8601
  client_modified?: string
}

interface DBListFolderResponse {
  entries:  DBEntry[]
  cursor:   string
  has_more: boolean
}

interface DBSpaceUsage {
  used:       number
  allocation: { allocated: number }
}

interface DropboxProfile extends ProviderProfile {
  /** OAuth2 access token from the Dropbox developer console. */
  token: string
}

// ---------------------------------------------------------------------------
// Pending write state
// ---------------------------------------------------------------------------

interface PendingWrite {
  path:   string
  flags:  string
  chunks: Buffer[]
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * POST to a Dropbox API endpoint and return the parsed JSON response body.
 * Returns null on HTTP 409 (Dropbox API-level errors such as path_not_found).
 * Throws on all other non-200 responses.
 *
 * Pass an empty string for `token` to omit the Authorization header (used
 * by the long-poll endpoint which requires no authentication).
 */
function dbPost<T>(
  token:         string,
  host:          string,
  urlPath:       string,
  body?:         unknown,
  extraHeaders?: Record<string, string>
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const bodyBuf = body !== undefined
      ? Buffer.from(JSON.stringify(body), 'utf8')
      : Buffer.alloc(0)

    const headers: Record<string, string | number> = {
      'Content-Length': bodyBuf.length,
      ...extraHeaders,
    }
    if (token)           headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const req = https.request({ method: 'POST', hostname: host, path: urlPath, headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode === 409) { resolve(null); return }
        if (res.statusCode !== 200) {
          reject(new Error(
            `Dropbox: HTTP ${res.statusCode} on ${urlPath}: ${text.slice(0, 200)}`
          ))
          return
        }
        if (!text) { resolve(null); return }
        try   { resolve(JSON.parse(text) as T) }
        catch { reject(new Error(`Dropbox: JSON parse failed: ${text.slice(0, 200)}`)) }
      })
      res.on('error', reject)
    })

    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    if (bodyBuf.length > 0) req.write(bodyBuf)
    req.end()
  })
}

/**
 * Range-download a slice of a Dropbox file.
 * Returns the raw response bytes (may be fewer than `size` at end-of-file).
 */
function dbDownloadRange(
  token:    string,
  filePath: string,
  offset:   number,
  size:     number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'POST',
        hostname: CONTENT_HOST,
        path:     '/2/files/download',
        headers:  {
          'Authorization':   `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
          'Range':           `bytes=${offset}-${offset + size - 1}`,
          'Content-Length':  0,
        },
      },
      res => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`Dropbox: download HTTP ${res.statusCode} for "${filePath}"`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end',  () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/**
 * Upload `data` to a Dropbox path, overwriting any existing content.
 * Uses the single-request upload endpoint (suitable for files up to 150 MB).
 */
function dbUpload(token: string, filePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'POST',
        hostname: CONTENT_HOST,
        path:     '/2/files/upload',
        headers:  {
          'Authorization':   `Bearer ${token}`,
          'Content-Type':    'application/octet-stream',
          'Content-Length':  data.length,
          'Dropbox-API-Arg': JSON.stringify({
            path:       filePath,
            mode:       'overwrite',
            autorename: false,
            mute:       true,
          }),
        },
      },
      res => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else reject(new Error(`Dropbox: upload HTTP ${res.statusCode} for "${filePath}"`))
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class Dropbox extends EventEmitter implements StorageProvider {
  private _token: string = ''
  private _pendingWrites = new Map<number, PendingWrite>()

  // ---- Lifecycle -----------------------------------------------------------

  init(options: ProviderProfile): void {
    const profile = options as DropboxProfile
    if (!profile.token) {
      throw new Error('Dropbox: "token" is required in the profile')
    }
    this._token = profile.token
  }

  // ---- StorageProvider: illegal filenames ---------------------------------

  isIllegalFileName(filePath: string): boolean {
    return filePath.includes('/._')
  }

  // ---- StorageProvider: metadata ------------------------------------------

  async getFileMeta(filePath: string): Promise<{ data: FileMetaData | null }> {
    // Root always exists as a directory; the listing API has no root entry.
    if (filePath === '/') {
      return {
        data: {
          list: [{ isdir: 1, path: '/', size: 0, mtime: Date.now(), ctime: Date.now() }],
        },
      }
    }

    const res = await dbPost<DBEntry>(
      this._token, API_HOST, '/2/files/get_metadata',
      { path: filePath }
    )
    if (!res) return { data: null }
    return { data: { list: [this._toFileEntry(res)] } }
  }

  async getFileList(filePath: string): Promise<{ data: FileMetaData | null }> {
    const entries: FileEntry[] = []

    // First page
    const first = await dbPost<DBListFolderResponse>(
      this._token, API_HOST, '/2/files/list_folder',
      {
        path:                                filePath === '/' ? '' : filePath,
        recursive:                           false,
        include_media_info:                  false,
        include_deleted:                     false,
        include_has_explicit_shared_members: false,
        include_mounted_folders:             true,
      }
    )
    if (!first) return { data: null }

    for (const e of first.entries) {
      if (e['.tag'] !== 'deleted') entries.push(this._toFileEntry(e))
    }

    // Subsequent pages
    let cursor  = first.cursor
    let hasMore = first.has_more
    while (hasMore) {
      const next = await dbPost<DBListFolderResponse>(
        this._token, API_HOST, '/2/files/list_folder/continue',
        { cursor }
      )
      if (!next) break
      for (const e of next.entries) {
        if (e['.tag'] !== 'deleted') entries.push(this._toFileEntry(e))
      }
      cursor  = next.cursor
      hasMore = next.has_more
    }

    return { data: { list: entries } }
  }

  // ---- StorageProvider: download ------------------------------------------

  async getFileDownload(
    filePath: string,
    offset:   number,
    size:     number
  ): Promise<DownloadResponse> {
    const data = await dbDownloadRange(this._token, filePath, offset, size)
    return { data: data.subarray(0, size), length: data.length }
  }

  // ---- StorageProvider: quota ---------------------------------------------

  async quota(): Promise<{ data: QuotaInfo }> {
    const res = await dbPost<DBSpaceUsage>(
      this._token, API_HOST, '/2/users/get_space_usage'
    )
    if (!res) throw new Error('Dropbox: quota API returned no data')
    return { data: { quota: res.allocation.allocated, used: res.used } }
  }

  // ---- StorageProvider: file handles --------------------------------------

  async openFile(filePath: string, flags: string, fd: number): Promise<void> {
    if (this._pendingWrites.has(fd)) {
      throw new Error(`Dropbox: fd ${fd} is already open`)
    }
    this._pendingWrites.set(fd, { path: filePath, flags, chunks: [] })
  }

  async closeFile(_filePath: string, fd: number): Promise<void> {
    this._pendingWrites.delete(fd)
  }

  // ---- StorageProvider: mutations -----------------------------------------

  async createEmptyFile(filePath: string): Promise<void> {
    await dbUpload(this._token, filePath, Buffer.alloc(0))
  }

  async writeFileData(
    filePath: string,
    fd:       number,
    buffer:   Buffer,
    _offset:  number,
    length:   number
  ): Promise<{ length: number }> {
    const pending = this._pendingWrites.get(fd)
    if (!pending || pending.path !== filePath) {
      throw new Error(`Dropbox: fd ${fd} is not open for "${filePath}"`)
    }
    pending.chunks.push(Buffer.from(buffer))
    return { length }
  }

  async commitFileData(filePath: string, fd: number): Promise<void> {
    const pending = this._pendingWrites.get(fd)
    if (!pending || pending.path !== filePath) return
    if (pending.chunks.length > 0) {
      await dbUpload(this._token, filePath, Buffer.concat(pending.chunks))
    }
    this._pendingWrites.delete(fd)
  }

  async deleteFile(filePath: string): Promise<void> {
    await dbPost(this._token, API_HOST, '/2/files/delete_v2', { path: filePath })
  }

  async deleteFolder(filePath: string): Promise<void> {
    return this.deleteFile(filePath)
  }

  async createFolder(filePath: string): Promise<void> {
    await dbPost(this._token, API_HOST, '/2/files/create_folder_v2',
      { path: filePath, autorename: false }
    )
  }

  async move(src: string, dst: string): Promise<void> {
    await dbPost(this._token, API_HOST, '/2/files/move_v2', {
      from_path:                src,
      to_path:                  dst,
      allow_shared_folder:      false,
      autorename:               false,
      allow_ownership_transfer: false,
    })
  }

  // ---- Change notification ------------------------------------------------

  /**
   * Start a long-poll loop that emits 'fileChange' whenever Dropbox reports
   * remote changes.  Runs in the background; errors are silently retried.
   */
  registerChange(): void {
    this._startLongPoll().catch(() => {/* best-effort */})
  }

  private async _startLongPoll(): Promise<void> {
    // Fetch the latest cursor (current snapshot, no entries needed).
    const init = await dbPost<{ cursor: string }>(
      this._token, API_HOST, '/2/files/list_folder/get_latest_cursor',
      {
        path:                                '',
        recursive:                           true,
        include_media_info:                  false,
        include_deleted:                     false,
        include_has_explicit_shared_members: false,
        include_mounted_folders:             true,
      }
    )
    if (!init) return
    let cursor = init.cursor

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Blocks up to 30 s waiting for a change.  No auth required.
        await dbPost(
          '', NOTIFY_HOST, '/2/files/list_folder/longpoll',
          { cursor, timeout: 30 }
        )

        // Fetch the delta to advance the cursor and check for real changes.
        const delta = await dbPost<DBListFolderResponse>(
          this._token, API_HOST, '/2/files/list_folder/continue',
          { cursor }
        )
        if (!delta) continue
        cursor = delta.cursor
        if (delta.entries.length > 0) {
          this.emit('fileChange', { path: '/', recursive: true })
        }
      } catch {
        await new Promise(r => setTimeout(r, LONGPOLL_RETRY_DELAY_MS))
      }
    }
  }

  // ---- Private helpers ----------------------------------------------------

  private _toFileEntry(entry: DBEntry): FileEntry {
    return {
      isdir: entry['.tag'] === 'folder' ? 1 : 0,
      path:  entry.path_lower,
      size:  entry.size ?? 0,
      mtime: entry.server_modified ? new Date(entry.server_modified).getTime() : Date.now(),
      ctime: entry.client_modified ? new Date(entry.client_modified).getTime() : Date.now(),
    }
  }
}
