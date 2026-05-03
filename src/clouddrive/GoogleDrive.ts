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
 * Google Drive cloud-storage provider.
 *
 * Authentication:
 *   Obtain an OAuth 2.0 access token with the
 *   https://www.googleapis.com/auth/drive scope.  Quick way for testing:
 *   visit https://developers.google.com/oauthplayground, select
 *   "Drive API v3 → https://www.googleapis.com/auth/drive", and exchange
 *   the authorization code for a (1-hour) access token.
 *
 *   {
 *     "module": "GoogleDrive",
 *     "cacheStore": "disk",
 *     "cachePath": "/tmp/gdrive-cache",
 *     "token": "<access token>"
 *   }
 *
 * Google Drive API notes:
 *   - Every item (file or folder) has an opaque string ID; "root" is a
 *     stable alias for the user's My Drive root folder.
 *   - Paths are resolved to IDs by walking the directory tree.  Resolved
 *     IDs are cached in memory and invalidated on any mutating operation.
 *   - Google Workspace documents (Docs, Sheets, Slides, …) cannot be
 *     downloaded via the files API and are excluded from directory listings.
 *   - File downloads are Range requests against
 *     GET /drive/v3/files/{id}?alt=media (no redirect needed).
 *   - Uploads use multipart (create) or media-only PATCH (update) to
 *     /upload/drive/v3/files.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_HOST = 'www.googleapis.com'

const FOLDER_MIME          = 'application/vnd.google-apps.folder'
const WORKSPACE_MIME_PREFIX = 'application/vnd.google-apps.'

const ROOT_ID = 'root'

const HTTP_TIMEOUT_MS   = 30_000
const UPLOAD_TIMEOUT_MS = 120_000

/** Placeholder quota for G Suite accounts that report no limit. */
const UNLIMITED_QUOTA_BYTES = 1_000_000_000_000  // 1 TB display value

const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime'

// ---------------------------------------------------------------------------
// Google Drive API shape (partial)
// ---------------------------------------------------------------------------

interface GDriveFile {
  id:            string
  name:          string
  mimeType:      string
  size?:         string   // number serialised as string
  modifiedTime?: string   // RFC 3339
  createdTime?:  string   // RFC 3339
}

interface GDriveFileList {
  files:          GDriveFile[]
  nextPageToken?: string
}

interface GDriveAbout {
  storageQuota: {
    limit?:       string   // absent / null for unlimited G Suite accounts
    usage:        string
    usageInDrive?: string
  }
}

interface GDriveProfile extends ProviderProfile {
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

/** GET a Drive API endpoint and return the parsed JSON body, or null on 404. */
function gdriveGet<T>(token: string, urlPath: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'GET',
        hostname: API_HOST,
        path:     urlPath,
        headers:  { 'Authorization': `Bearer ${token}` },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 404) { resolve(null); return }
          if (res.statusCode !== 200) {
            reject(new Error(`GDrive GET ${urlPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          try   { resolve(JSON.parse(text) as T) }
          catch { reject(new Error(`GDrive GET ${urlPath}: JSON parse failed: ${text.slice(0, 200)}`)) }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/** POST or PATCH JSON to a Drive API endpoint and return the parsed response. */
function gdriveJsonRequest<T>(
  method:  'POST' | 'PATCH',
  token:   string,
  urlPath: string,
  body:    unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request(
      {
        method,
        hostname: API_HOST,
        path:     urlPath,
        headers:  {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/json; charset=UTF-8',
          'Content-Length': bodyBuf.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 200 || res.statusCode === 201) {
            if (!text) { resolve(null as unknown as T); return }
            try   { resolve(JSON.parse(text) as T) }
            catch { reject(new Error(`GDrive ${method} ${urlPath}: JSON parse failed`)) }
            return
          }
          reject(new Error(`GDrive ${method} ${urlPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.write(bodyBuf)
    req.end()
  })
}

/** DELETE a Drive resource. Resolves on 204/200 (success) or 404 (already gone). */
function gdriveDelete(token: string, fileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'DELETE',
        hostname: API_HOST,
        path:     `/drive/v3/files/${fileId}`,
        headers:  { 'Authorization': `Bearer ${token}` },
      },
      res => {
        res.resume()
        if (res.statusCode === 204 || res.statusCode === 200 || res.statusCode === 404) {
          resolve(); return
        }
        reject(new Error(`GDrive DELETE /drive/v3/files/${fileId}: HTTP ${res.statusCode}`))
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/** Range-download a slice of a Drive file using GET …?alt=media. */
function gdriveDownloadRange(
  token:  string,
  fileId: string,
  offset: number,
  size:   number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'GET',
        hostname: API_HOST,
        path:     `/drive/v3/files/${fileId}?alt=media`,
        headers:  {
          'Authorization': `Bearer ${token}`,
          'Range':         `bytes=${offset}-${offset + size - 1}`,
        },
      },
      res => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`GDrive: download HTTP ${res.statusCode} for file ${fileId}`))
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
 * Create a new Drive file using a multipart upload.
 * Returns the created file resource including its assigned ID.
 */
function gdriveUploadCreate(
  token:    string,
  parentId: string,
  fileName: string,
  data:     Buffer
): Promise<GDriveFile> {
  return new Promise((resolve, reject) => {
    const boundary = `GDriveBoundary${Date.now()}`
    const metadata = JSON.stringify({ name: fileName, parents: [parentId] })
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n`
      ),
      Buffer.from(metadata),
      Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const urlPath = `/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`
    const req = https.request(
      {
        method:   'POST',
        hostname: API_HOST,
        path:     urlPath,
        headers:  {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 200 || res.statusCode === 201) {
            try   { resolve(JSON.parse(text) as GDriveFile) }
            catch { reject(new Error(`GDrive: upload create JSON parse failed`)) }
            return
          }
          reject(new Error(`GDrive: upload create HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
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

/**
 * Overwrite an existing Drive file's content using a media-only PATCH upload.
 */
function gdriveUploadUpdate(token: string, fileId: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method:   'PATCH',
        hostname: API_HOST,
        path:     `/upload/drive/v3/files/${fileId}?uploadType=media`,
        headers:  {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/octet-stream',
          'Content-Length': data.length,
        },
      },
      res => {
        res.resume()
        if (res.statusCode === 200) { resolve(); return }
        reject(new Error(`GDrive: upload update HTTP ${res.statusCode} for file ${fileId}`))
      }
    )
    req.on('error', reject)
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('Upload timed out')))
    req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class GoogleDrive implements StorageProvider {
  private _token     = ''
  private _idCache   = new Map<string, string>()            // POSIX path → Drive item ID
  private _typeCache = new Map<string, 'file' | 'folder'>() // POSIX path → item type
  private _pendingWrites = new Map<number, PendingWrite>()

  // ---- Lifecycle -----------------------------------------------------------

  init(options: ProviderProfile): void {
    const profile = options as GDriveProfile
    if (!profile.token) throw new Error('GoogleDrive: "token" is required in the profile')
    this._token = profile.token
    this._idCache.set('/', ROOT_ID)
    this._typeCache.set('/', 'folder')
  }

  // ---- StorageProvider: illegal filenames ---------------------------------

  isIllegalFileName(filePath: string): boolean {
    return filePath.includes('/._')
  }

  // ---- Internal: ID resolution --------------------------------------------

  /**
   * Resolve a POSIX path to a Drive item ID.
   *
   * Walks the tree component by component, listing each parent on a cache
   * miss and populating all siblings at once.  Returns null if any
   * component is not found.
   */
  private async _resolveId(filePath: string): Promise<string | null> {
    if (filePath === '/') return ROOT_ID

    const cached = this._idCache.get(filePath)
    if (cached !== undefined) return cached

    const parts = filePath.split('/').filter(Boolean)
    let parentId  = ROOT_ID
    let builtPath = ''

    for (const part of parts) {
      const childPath = `${builtPath}/${part}`
      const cachedId  = this._idCache.get(childPath)
      if (cachedId !== undefined) {
        parentId  = cachedId
        builtPath = childPath
        continue
      }

      // List the parent folder and populate the cache for all siblings at once.
      const items = await this._listFolderById(parentId)
      if (items === null) return null

      for (const item of items) {
        const p = `${builtPath}/${item.name}`
        this._idCache.set(p, item.id)
        this._typeCache.set(p, item.mimeType === FOLDER_MIME ? 'folder' : 'file')
      }

      const found = this._idCache.get(childPath)
      if (found === undefined) return null

      parentId  = found
      builtPath = childPath
    }

    return parentId
  }

  /**
   * List all items inside a Drive folder by ID, following pagination.
   * Google Workspace documents (non-folder google-apps types) are excluded
   * because they have no downloadable binary content.
   */
  private async _listFolderById(folderId: string): Promise<GDriveFile[] | null> {
    const all: GDriveFile[] = []
    let pageToken: string | undefined

    for (;;) {
      const q      = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
      const fields = encodeURIComponent(`nextPageToken,files(${FILE_FIELDS})`)
      let urlPath  = `/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`
      if (pageToken) urlPath += `&pageToken=${encodeURIComponent(pageToken)}`

      const res = await gdriveGet<GDriveFileList>(this._token, urlPath)
      if (res === null) return null

      for (const f of res.files) {
        // Skip Google Workspace documents — they are not downloadable binary files.
        if (f.mimeType !== FOLDER_MIME && f.mimeType.startsWith(WORKSPACE_MIME_PREFIX)) continue
        all.push(f)
      }

      if (!res.nextPageToken) break
      pageToken = res.nextPageToken
    }

    return all
  }

  /** Invalidate path→ID caches after any mutation that changes the tree. */
  private _invalidateCache(): void {
    this._idCache.clear()
    this._typeCache.clear()
    this._idCache.set('/', ROOT_ID)
    this._typeCache.set('/', 'folder')
  }

  // ---- StorageProvider: metadata ------------------------------------------

  async getFileMeta(filePath: string): Promise<{ data: FileMetaData | null }> {
    if (filePath === '/') {
      const now = Date.now()
      return { data: { list: [{ isdir: 1, path: '/', size: 0, mtime: now, ctime: now }] } }
    }

    // Fast path: ID already cached — fetch fresh metadata directly.
    const cachedId   = this._idCache.get(filePath)
    const cachedType = this._typeCache.get(filePath)
    if (cachedId !== undefined && cachedType !== undefined) {
      const res = await gdriveGet<GDriveFile>(
        this._token,
        `/drive/v3/files/${cachedId}?fields=${encodeURIComponent(FILE_FIELDS)}`
      )
      if (!res) return { data: null }
      return { data: { list: [this._toFileEntry(res, filePath)] } }
    }

    // Slow path: list the parent folder (also populates cache for siblings).
    const parentPath = path.posix.dirname(filePath)
    const name       = path.posix.basename(filePath)
    const listResult = await this.getFileList(parentPath)
    if (!listResult.data) return { data: null }

    const entry = listResult.data.list.find(e => path.posix.basename(e.path) === name)
    return entry ? { data: { list: [entry] } } : { data: null }
  }

  async getFileList(filePath: string): Promise<{ data: FileMetaData | null }> {
    const folderId = await this._resolveId(filePath)
    if (folderId === null) return { data: null }

    const items = await this._listFolderById(folderId)
    if (items === null) return { data: null }

    const entries: FileEntry[] = []
    for (const item of items) {
      const itemPath = filePath === '/' ? `/${item.name}` : `${filePath}/${item.name}`
      this._idCache.set(itemPath, item.id)
      this._typeCache.set(itemPath, item.mimeType === FOLDER_MIME ? 'folder' : 'file')
      entries.push(this._toFileEntry(item, itemPath))
    }

    return { data: { list: entries } }
  }

  // ---- StorageProvider: download ------------------------------------------

  async getFileDownload(
    filePath: string,
    offset:   number,
    size:     number
  ): Promise<DownloadResponse> {
    const fileId = await this._resolveId(filePath)
    if (fileId === null) throw new Error(`GoogleDrive: file not found: ${filePath}`)

    const data = await gdriveDownloadRange(this._token, fileId, offset, size)
    return { data: data.subarray(0, size), length: data.length }
  }

  // ---- StorageProvider: quota ---------------------------------------------

  async quota(): Promise<{ data: QuotaInfo }> {
    const res = await gdriveGet<GDriveAbout>(
      this._token,
      '/drive/v3/about?fields=storageQuota'
    )
    if (!res) throw new Error('GoogleDrive: quota API returned no data')
    const { storageQuota } = res
    // limit is absent / null for G Suite accounts with unlimited storage.
    const quota = storageQuota.limit ? Number(storageQuota.limit) : UNLIMITED_QUOTA_BYTES
    const used  = Number(storageQuota.usage)
    return { data: { quota, used } }
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
    const parentPath = path.posix.dirname(filePath)
    const fileName   = path.posix.basename(filePath)
    const parentId   = await this._resolveId(parentPath) ?? ROOT_ID

    const result = await gdriveUploadCreate(this._token, parentId, fileName, Buffer.alloc(0))
    this._idCache.set(filePath, result.id)
    this._typeCache.set(filePath, 'file')
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
      throw new Error(`GoogleDrive: fd ${fd} is not open for "${filePath}"`)
    }
    pending.chunks.push(Buffer.from(buffer))
    return { length }
  }

  async commitFileData(filePath: string, fd: number): Promise<void> {
    const pending = this._pendingWrites.get(fd)
    if (!pending || pending.path !== filePath) return
    if (pending.chunks.length === 0) { this._pendingWrites.delete(fd); return }

    const data   = Buffer.concat(pending.chunks)
    const fileId = this._idCache.get(filePath)

    if (fileId) {
      // File was pre-created by createEmptyFile — overwrite with accumulated data.
      await gdriveUploadUpdate(this._token, fileId, data)
    } else {
      // Fallback: create fresh (e.g. if the provider was restarted mid-write).
      const parentPath = path.posix.dirname(filePath)
      const fileName   = path.posix.basename(filePath)
      const parentId   = await this._resolveId(parentPath) ?? ROOT_ID
      const result     = await gdriveUploadCreate(this._token, parentId, fileName, data)
      this._idCache.set(filePath, result.id)
      this._typeCache.set(filePath, 'file')
    }

    this._invalidateCache()
    this._pendingWrites.delete(fd)
  }

  async deleteFile(filePath: string): Promise<void> {
    const fileId = await this._resolveId(filePath)
    if (fileId === null) return
    await gdriveDelete(this._token, fileId)
    this._invalidateCache()
  }

  async deleteFolder(filePath: string): Promise<void> {
    const folderId = await this._resolveId(filePath)
    if (folderId === null) return
    await gdriveDelete(this._token, folderId)
    this._invalidateCache()
  }

  async createFolder(filePath: string): Promise<void> {
    const parentPath = path.posix.dirname(filePath)
    const folderName = path.posix.basename(filePath)
    const parentId   = await this._resolveId(parentPath) ?? ROOT_ID

    const result = await gdriveJsonRequest<GDriveFile>(
      'POST', this._token,
      `/drive/v3/files?fields=${encodeURIComponent(FILE_FIELDS)}`,
      { name: folderName, mimeType: FOLDER_MIME, parents: [parentId] }
    )
    this._idCache.set(filePath, result.id)
    this._typeCache.set(filePath, 'folder')
    this._invalidateCache()
  }

  async move(src: string, dst: string): Promise<void> {
    const srcId = await this._resolveId(src)
    if (srcId === null) throw new Error(`GoogleDrive: source not found: ${src}`)

    // Resolve the source's current parent before any mutation.
    const srcParentId = await this._resolveId(path.posix.dirname(src))

    const dstParent   = path.posix.dirname(dst)
    const dstName     = path.posix.basename(dst)
    const dstParentId = await this._resolveId(dstParent)
    if (dstParentId === null) throw new Error(`GoogleDrive: target parent not found: ${dstParent}`)

    // Build the PATCH URL — include parent change params when folders differ.
    let urlPath = `/drive/v3/files/${srcId}?fields=${encodeURIComponent(FILE_FIELDS)}`
    if (srcParentId !== null && dstParentId !== srcParentId) {
      urlPath += `&addParents=${encodeURIComponent(dstParentId)}`
      urlPath += `&removeParents=${encodeURIComponent(srcParentId)}`
    }

    await gdriveJsonRequest('PATCH', this._token, urlPath, { name: dstName })
    this._invalidateCache()
  }

  // ---- Private helpers ----------------------------------------------------

  private _toFileEntry(item: GDriveFile, filePath: string): FileEntry {
    return {
      isdir: item.mimeType === FOLDER_MIME ? 1 : 0,
      path:  filePath,
      size:  item.size ? Number(item.size) : 0,
      mtime: item.modifiedTime ? new Date(item.modifiedTime).getTime() : Date.now(),
      ctime: item.createdTime  ? new Date(item.createdTime).getTime()  : Date.now(),
    }
  }
}
