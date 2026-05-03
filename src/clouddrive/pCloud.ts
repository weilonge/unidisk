import path from 'path'
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
 * pCloud cloud-storage provider.
 *
 * Authentication:
 *   Obtain an access token from the pCloud developer console
 *   (https://developer.pcloud.com).  Create an app, then use the OAuth 2.0
 *   flow to get a long-lived token, or generate one via the API explorer.
 *
 *   {
 *     "module": "pCloud",
 *     "cacheStore": "disk",
 *     "cachePath": "/tmp/pcloud-cache",
 *     "token": "<access token>",
 *     "apiHost": "api.pcloud.com"
 *   }
 *
 *   apiHost defaults to "api.pcloud.com" (US).
 *   EU-region accounts must use "eapi.pcloud.com".
 *
 * pCloud API notes:
 *   - Path-based API: no ID resolution required (unlike Box).
 *   - Token is passed as the `auth` query parameter.
 *   - Downloads are two-step: getfilelink returns a CDN URL, then Range
 *     requests go directly to the CDN host.  CDN links are cached until
 *     5 minutes before their stated expiry.
 *   - Upload uses POST multipart/form-data to /uploadfile.  Uploading to an
 *     existing path creates a new file revision; the latest version is always
 *     the current content visible via the filesystem.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_HOST   = 'api.pcloud.com'
const HTTP_TIMEOUT_MS    = 30_000
const UPLOAD_TIMEOUT_MS  = 120_000

/** Evict a cached download link this many ms before its stated expiry. */
const DLINK_MARGIN_MS = 5 * 60 * 1000

// pCloud result codes
const RESULT_OK          = 0
const RESULT_NOT_FOUND   = 2009   // file not found
const RESULT_NO_DIR      = 2005   // directory does not exist
const RESULT_EXISTS      = 2004   // file/folder already exists

// ---------------------------------------------------------------------------
// pCloud API shape (partial)
// ---------------------------------------------------------------------------

interface PCloudItem {
  name:           string
  size?:          number
  created:        string    // RFC 2822 date
  modified:       string    // RFC 2822 date
  isfolder:       boolean
  fileid?:        number
  folderid?:      number
  contents?:      PCloudItem[]
}

interface PCloudBaseResponse {
  result:  number
  error?:  string
}

interface PCloudStatResponse extends PCloudBaseResponse {
  metadata: PCloudItem
}

interface PCloudListResponse extends PCloudBaseResponse {
  metadata: PCloudItem & { contents: PCloudItem[] }
}

interface PCloudFileLinkResponse extends PCloudBaseResponse {
  path:    string    // path component on CDN host
  hosts:   string[]
  expires: string    // RFC 2822 date
}

interface PCloudUploadResponse extends PCloudBaseResponse {
  fileids:  number[]
  metadata: PCloudItem[]
}

interface PCloudUserInfo extends PCloudBaseResponse {
  quota:     number
  usedquota: number
}

interface PCloudProfile extends ProviderProfile {
  token:    string
  apiHost?: string
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
// Download-link cache entry
// ---------------------------------------------------------------------------

interface DLink {
  host:      string
  urlPath:   string
  expiresAt: number   // ms timestamp
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

/**
 * GET a pCloud API endpoint.
 * Returns null when the result code indicates "not found" (2005 or 2009).
 * Throws on all other non-zero result codes or HTTP errors.
 */
function pcloudGet<T extends PCloudBaseResponse>(
  host:    string,
  apiPath: string,
  params:  Record<string, string | number>
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const fullPath = `/${apiPath}?${buildQuery(params)}`
    const req = https.request(
      { method: 'GET', hostname: host, path: fullPath },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(
              `pCloud ${apiPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`
            ))
            return
          }
          let parsed: T
          try { parsed = JSON.parse(text) as T }
          catch {
            reject(new Error(`pCloud ${apiPath}: JSON parse failed: ${text.slice(0, 200)}`))
            return
          }
          if (parsed.result === RESULT_NOT_FOUND || parsed.result === RESULT_NO_DIR) {
            resolve(null)
            return
          }
          if (parsed.result !== RESULT_OK) {
            reject(new Error(
              `pCloud ${apiPath}: result=${parsed.result} ${parsed.error ?? ''}`
            ))
            return
          }
          resolve(parsed)
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/**
 * Range-download a slice of a file directly from the pCloud CDN.
 * `host` and `urlPath` come from a prior getfilelink call.
 */
function pcloudRangeGet(
  host:    string,
  urlPath: string,
  offset:  number,
  size:    number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'GET',
        hostname: host,
        path:     urlPath,
        headers:  { 'Range': `bytes=${offset}-${offset + size - 1}` },
      },
      res => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`pCloud CDN: HTTP ${res.statusCode} from ${host}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end',  () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('CDN request timed out')))
    req.end()
  })
}

/**
 * Upload a file to pCloud via multipart/form-data.
 * `dirPath` is the destination folder path; `fileName` is the file name.
 * If a file with that name already exists, a new revision is created and
 * the uploaded content becomes the current version.
 */
function pcloudUpload(
  host:     string,
  token:    string,
  dirPath:  string,
  fileName: string,
  data:     Buffer
): Promise<PCloudUploadResponse> {
  return new Promise((resolve, reject) => {
    const boundary = `----PCloudBoundary${Date.now()}`
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const qs = buildQuery({ path: dirPath, auth: token, nopartial: 1 })
    const req = https.request(
      {
        method:   'POST',
        hostname: host,
        path:     `/uploadfile?${qs}`,
        headers:  {
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`pCloud upload: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          let parsed: PCloudUploadResponse
          try { parsed = JSON.parse(text) as PCloudUploadResponse }
          catch {
            reject(new Error(`pCloud upload: JSON parse failed: ${text.slice(0, 200)}`))
            return
          }
          if (parsed.result !== RESULT_OK) {
            reject(new Error(`pCloud upload: result=${parsed.result} ${parsed.error ?? ''}`))
            return
          }
          resolve(parsed)
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('Upload timed out')))
    req.write(body)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class pCloud implements StorageProvider {
  private _token   = ''
  private _apiHost = DEFAULT_API_HOST
  private _dlinkCache    = new Map<string, DLink>()
  private _pendingWrites = new Map<number, PendingWrite>()

  // ---- Lifecycle -----------------------------------------------------------

  init(options: ProviderProfile): void {
    const profile = options as PCloudProfile
    if (!profile.token) throw new Error('pCloud: "token" is required in the profile')
    this._token   = profile.token
    this._apiHost = profile.apiHost ?? DEFAULT_API_HOST
  }

  // ---- StorageProvider: illegal filenames ---------------------------------

  isIllegalFileName(filePath: string): boolean {
    return filePath.includes('/._')
  }

  // ---- StorageProvider: metadata ------------------------------------------

  async getFileMeta(filePath: string): Promise<{ data: FileMetaData | null }> {
    if (filePath === '/') {
      const now = Date.now()
      return { data: { list: [{ isdir: 1, path: '/', size: 0, mtime: now, ctime: now }] } }
    }

    const res = await pcloudGet<PCloudStatResponse>(
      this._apiHost, 'stat', { path: filePath, auth: this._token }
    )
    if (!res) return { data: null }
    return { data: { list: [this._toFileEntry(res.metadata, filePath)] } }
  }

  async getFileList(filePath: string): Promise<{ data: FileMetaData | null }> {
    const res = await pcloudGet<PCloudListResponse>(
      this._apiHost, 'listfolder',
      { path: filePath, auth: this._token, recursive: 0 }
    )
    if (!res) return { data: null }

    const contents = res.metadata.contents ?? []
    const entries: FileEntry[] = contents.map(item => {
      const itemPath = filePath === '/' ? `/${item.name}` : `${filePath}/${item.name}`
      return this._toFileEntry(item, itemPath)
    })

    return { data: { list: entries } }
  }

  // ---- StorageProvider: download ------------------------------------------

  async getFileDownload(
    filePath: string,
    offset:   number,
    size:     number
  ): Promise<DownloadResponse> {
    const dlink = await this._getDownloadLink(filePath)

    let data: Buffer
    try {
      data = await pcloudRangeGet(dlink.host, dlink.urlPath, offset, size)
    } catch (err) {
      // Evict stale dlink on CDN error so next retry fetches a fresh URL.
      this._dlinkCache.delete(filePath)
      throw err
    }

    return { data: data.subarray(0, size), length: data.length }
  }

  private async _getDownloadLink(filePath: string): Promise<DLink> {
    const cached = this._dlinkCache.get(filePath)
    if (cached && Date.now() < cached.expiresAt - DLINK_MARGIN_MS) return cached

    const res = await pcloudGet<PCloudFileLinkResponse>(
      this._apiHost, 'getfilelink',
      { path: filePath, auth: this._token, forcedownload: 1 }
    )
    if (!res) throw new Error(`pCloud: file not found for download: ${filePath}`)

    const dlink: DLink = {
      host:      res.hosts[0],
      urlPath:   res.path,
      expiresAt: new Date(res.expires).getTime(),
    }
    this._dlinkCache.set(filePath, dlink)
    return dlink
  }

  // ---- StorageProvider: quota ---------------------------------------------

  async quota(): Promise<{ data: QuotaInfo }> {
    const res = await pcloudGet<PCloudUserInfo>(
      this._apiHost, 'userinfo', { auth: this._token }
    )
    if (!res) throw new Error('pCloud: userinfo API returned no data')
    return { data: { quota: res.quota, used: res.usedquota } }
  }

  // ---- StorageProvider: file handles --------------------------------------

  async openFile(filePath: string, flags: string, fd: number): Promise<void> {
    this._pendingWrites.set(fd, { path: filePath, flags, chunks: [] })
  }

  async closeFile(_filePath: string, fd: number): Promise<void> {
    this._pendingWrites.delete(fd)
  }

  // ---- StorageProvider: mutations -----------------------------------------

  async createEmptyFile(filePath: string): Promise<void> {
    const dirPath  = path.posix.dirname(filePath)
    const fileName = path.posix.basename(filePath)
    await pcloudUpload(this._apiHost, this._token, dirPath, fileName, Buffer.alloc(0))
    this._dlinkCache.delete(filePath)
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
      throw new Error(`pCloud: fd ${fd} is not open for "${filePath}"`)
    }
    pending.chunks.push(Buffer.from(buffer))
    return { length }
  }

  async commitFileData(filePath: string, fd: number): Promise<void> {
    const pending = this._pendingWrites.get(fd)
    if (!pending || pending.path !== filePath) return
    if (pending.chunks.length === 0) { this._pendingWrites.delete(fd); return }

    const data     = Buffer.concat(pending.chunks)
    const dirPath  = path.posix.dirname(filePath)
    const fileName = path.posix.basename(filePath)

    // Uploading to an existing path creates a new revision; the uploaded
    // content becomes the current version — no explicit delete needed.
    await pcloudUpload(this._apiHost, this._token, dirPath, fileName, data)

    this._dlinkCache.delete(filePath)
    this._pendingWrites.delete(fd)
  }

  async deleteFile(filePath: string): Promise<void> {
    await pcloudGet(this._apiHost, 'deletefile', { path: filePath, auth: this._token })
    this._dlinkCache.delete(filePath)
  }

  async deleteFolder(filePath: string): Promise<void> {
    await pcloudGet(
      this._apiHost, 'deletefolderrecursive', { path: filePath, auth: this._token }
    )
  }

  async createFolder(filePath: string): Promise<void> {
    try {
      await pcloudGet<PCloudBaseResponse>(
        this._apiHost, 'createfolder', { path: filePath, auth: this._token }
      )
    } catch (err) {
      // result=2004 means the folder already exists — treat as success.
      if ((err as Error).message.includes(`result=${RESULT_EXISTS}`)) return
      throw err
    }
  }

  async move(src: string, dst: string): Promise<void> {
    // Determine whether src is a file or folder by its current metadata.
    const meta = await this.getFileMeta(src)
    const isDir = meta?.data?.list[0]?.isdir === 1

    const endpoint = isDir ? 'renamefolder' : 'renamefile'
    await pcloudGet(
      this._apiHost, endpoint,
      { path: src, topath: dst, auth: this._token }
    )
    this._dlinkCache.delete(src)
  }

  // ---- Private helpers ----------------------------------------------------

  private _toFileEntry(item: PCloudItem, filePath: string): FileEntry {
    return {
      isdir: item.isfolder ? 1 : 0,
      path:  filePath,
      size:  item.size ?? 0,
      mtime: item.modified ? new Date(item.modified).getTime() : Date.now(),
      ctime: item.created  ? new Date(item.created).getTime()  : Date.now(),
    }
  }
}
