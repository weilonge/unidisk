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
 * Box cloud-storage provider.
 *
 * Authentication:
 *   Obtain a developer token from the Box developer console
 *   (https://developer.box.com/console) under your app → Configuration →
 *   Developer Token.  Or use a long-lived OAuth token for production.
 *
 *   {
 *     "module": "Box",
 *     "cacheStore": "disk",
 *     "cachePath": "/tmp/box-cache",
 *     "token": "<access token>"
 *   }
 *
 * Box API notes:
 *   - Every item (file or folder) has a numeric string ID; the root folder
 *     is always "0".
 *   - Paths are resolved to IDs by walking the directory tree.  Resolved IDs
 *     are cached in memory and invalidated on any mutating operation.
 *   - File downloads follow a 302 redirect to a CDN URL; the Range header
 *     is sent to the CDN rather than the API host.
 *   - Simple (single-request) uploads are used for files up to ~50 MB.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_HOST    = 'api.box.com'
const UPLOAD_HOST = 'upload.box.com'

/** Box root folder ID. */
const ROOT_ID = '0'

/** Socket idle timeout for every HTTPS request. */
const HTTP_TIMEOUT_MS = 30_000

/** Upload timeout — larger to accommodate slow uplinks. */
const UPLOAD_TIMEOUT_MS = 120_000

/** Placeholder quota for Box accounts with unlimited storage (-1 from API). */
const UNLIMITED_QUOTA_BYTES = 1_000_000_000_000  // 1 TB display value

/** Fields requested in folder listings and item fetches. */
const ITEM_FIELDS = 'id,type,name,size,modified_at,created_at'

// ---------------------------------------------------------------------------
// Box API shape (partial)
// ---------------------------------------------------------------------------

interface BoxItem {
  type:         'file' | 'folder'
  id:           string
  name:         string
  size?:        number
  modified_at?: string   // ISO 8601
  created_at?:  string   // ISO 8601
}

interface BoxItemCollection {
  entries:     BoxItem[]
  total_count: number
  offset:      number
  limit:       number
}

interface BoxUser {
  space_used:   number
  space_amount: number   // -1 means unlimited
}

interface BoxUploadResponse {
  entries: BoxItem[]
}

interface BoxProfile extends ProviderProfile {
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

/** GET a Box API endpoint and return the parsed JSON body, or null on 404. */
function boxGet<T>(token: string, urlPath: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: 'GET', hostname: API_HOST, path: urlPath,
        headers: { 'Authorization': `Bearer ${token}` } },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 404) { resolve(null); return }
          if (res.statusCode !== 200) {
            reject(new Error(`Box GET ${urlPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          try   { resolve(JSON.parse(text) as T) }
          catch { reject(new Error(`Box GET ${urlPath}: JSON parse failed: ${text.slice(0, 200)}`)) }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/** POST JSON to a Box API endpoint and return the parsed response. */
function boxPost<T>(token: string, urlPath: string, body: unknown): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request(
      {
        method: 'POST', hostname: API_HOST, path: urlPath,
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/json',
          'Content-Length': bodyBuf.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 409) { resolve(null); return }   // conflict / already exists
          if (res.statusCode !== 200 && res.statusCode !== 201) {
            reject(new Error(`Box POST ${urlPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          if (!text) { resolve(null); return }
          try   { resolve(JSON.parse(text) as T) }
          catch { reject(new Error(`Box POST ${urlPath}: JSON parse failed: ${text.slice(0, 200)}`)) }
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

/** PUT JSON to a Box API endpoint and return the parsed response. */
function boxPut<T>(token: string, urlPath: string, body: unknown): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request(
      {
        method: 'PUT', hostname: API_HOST, path: urlPath,
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/json',
          'Content-Length': bodyBuf.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`Box PUT ${urlPath}: HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          if (!text) { resolve(null); return }
          try   { resolve(JSON.parse(text) as T) }
          catch { reject(new Error(`Box PUT ${urlPath}: JSON parse failed: ${text.slice(0, 200)}`)) }
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

/** DELETE a Box resource.  Resolves on 204 (success) or 404 (already gone). */
function boxDelete(token: string, urlPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: 'DELETE', hostname: API_HOST, path: urlPath,
        headers: { 'Authorization': `Bearer ${token}` } },
      res => {
        res.resume()
        if (res.statusCode === 204 || res.statusCode === 200 || res.statusCode === 404) {
          resolve(); return
        }
        reject(new Error(`Box DELETE ${urlPath}: HTTP ${res.statusCode}`))
      }
    )
    req.on('error', reject)
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

/**
 * Range-download a slice of a Box file.
 *
 * Box redirects GET /files/{id}/content to a CDN URL.  We follow the 302
 * and issue the Range request against the CDN (no auth header needed there).
 */
function boxDownloadRange(
  token:  string,
  fileId: string,
  offset: number,
  size:   number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function fetchFromUrl(hostname: string, urlPath: string, sendAuth: boolean): void {
      const headers: Record<string, string> = {
        'Range': `bytes=${offset}-${offset + size - 1}`,
      }
      if (sendAuth) headers['Authorization'] = `Bearer ${token}`

      const req = https.request({ method: 'GET', hostname, path: urlPath, headers }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location
          res.resume()
          if (!location) { reject(new Error('Box: redirect with no Location header')); return }
          const url = new URL(location)
          // CDN URLs are pre-signed — no auth header required.
          fetchFromUrl(url.hostname, url.pathname + url.search, false)
          return
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          reject(new Error(`Box: download HTTP ${res.statusCode} for file ${fileId}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end',  () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timed out')))
      req.end()
    }

    fetchFromUrl(API_HOST, `/2.0/files/${fileId}/content`, true)
  })
}

/**
 * Upload a new file to Box using the simple multipart upload endpoint.
 * Suitable for files up to ~50 MB.  Returns the created BoxItem on success.
 */
function boxUploadCreate(
  token:    string,
  parentId: string,
  fileName: string,
  data:     Buffer
): Promise<BoxItem | null> {
  return new Promise((resolve, reject) => {
    const boundary = `----BoxBoundary${Date.now()}`
    const attrs = JSON.stringify({ name: fileName, parent: { id: parentId } })
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="attributes"\r\n\r\n`
      ),
      Buffer.from(attrs),
      Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const req = https.request(
      {
        method: 'POST', hostname: UPLOAD_HOST, path: '/api/2.0/files/content',
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 201) {
            try {
              const parsed = JSON.parse(text) as BoxUploadResponse
              resolve(parsed.entries?.[0] ?? null)
            } catch {
              resolve(null)
            }
            return
          }
          if (res.statusCode === 409) { resolve(null); return }   // name conflict
          reject(new Error(`Box: upload create HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
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
 * Overwrite an existing Box file with new content.
 * Uses the file-version upload endpoint (POST /files/{id}/content).
 */
function boxUploadUpdate(token: string, fileId: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const boundary = `----BoxBoundary${Date.now()}`
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="file"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const req = https.request(
      {
        method: 'POST', hostname: UPLOAD_HOST, path: `/api/2.0/files/${fileId}/content`,
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        res.resume()
        if (res.statusCode === 200 || res.statusCode === 201) { resolve(); return }
        reject(new Error(`Box: upload update HTTP ${res.statusCode} for file ${fileId}`))
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

export class Box implements StorageProvider {
  private _token     = ''
  private _idCache   = new Map<string, string>()            // POSIX path → Box item ID
  private _typeCache = new Map<string, 'file' | 'folder'>() // POSIX path → item type
  private _pendingWrites = new Map<number, PendingWrite>()

  // ---- Lifecycle -----------------------------------------------------------

  init(options: ProviderProfile): void {
    const profile = options as BoxProfile
    if (!profile.token) throw new Error('Box: "token" is required in the profile')
    this._token = profile.token
  }

  // ---- StorageProvider: illegal filenames ---------------------------------

  isIllegalFileName(filePath: string): boolean {
    // Ignore macOS resource-fork and attribute files.
    return filePath.includes('/._')
  }

  // ---- Internal: ID resolution --------------------------------------------

  /**
   * Resolve a POSIX path to a Box item ID.
   *
   * Walks the path tree component by component, listing each parent folder
   * and caching all children at once.  Returns null if any component is not
   * found.
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

      // List parent and populate the cache for all siblings at once.
      const items = await this._listFolderById(parentId)
      if (items === null) return null

      for (const item of items) {
        const p = `${builtPath}/${item.name}`
        this._idCache.set(p, item.id)
        this._typeCache.set(p, item.type)
      }

      const found = this._idCache.get(childPath)
      if (found === undefined) return null

      parentId  = found
      builtPath = childPath
    }

    return parentId
  }

  /**
   * Fetch all items in a Box folder by ID, handling offset-based pagination.
   */
  private async _listFolderById(folderId: string): Promise<BoxItem[] | null> {
    const all: BoxItem[] = []
    const limit = 1000
    let offset  = 0

    for (;;) {
      const res = await boxGet<BoxItemCollection>(
        this._token,
        `/2.0/folders/${folderId}/items` +
        `?fields=${ITEM_FIELDS}&limit=${limit}&offset=${offset}`
      )
      if (res === null) return null

      all.push(...res.entries)
      if (all.length >= res.total_count || res.entries.length === 0) break
      offset += res.entries.length
    }

    return all
  }

  /** Invalidate path→ID caches after any mutation that changes the tree. */
  private _invalidateCache(): void {
    this._idCache.clear()
    this._typeCache.clear()
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
      const endpoint = cachedType === 'folder'
        ? `/2.0/folders/${cachedId}?fields=${ITEM_FIELDS}`
        : `/2.0/files/${cachedId}?fields=${ITEM_FIELDS}`
      const res = await boxGet<BoxItem>(this._token, endpoint)
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
      this._typeCache.set(itemPath, item.type)
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
    if (fileId === null) throw new Error(`Box: file not found: ${filePath}`)

    const data = await boxDownloadRange(this._token, fileId, offset, size)
    return { data: data.subarray(0, size), length: data.length }
  }

  // ---- StorageProvider: quota ---------------------------------------------

  async quota(): Promise<{ data: QuotaInfo }> {
    const res = await boxGet<BoxUser>(
      this._token, '/2.0/users/me?fields=space_used,space_amount'
    )
    if (!res) throw new Error('Box: quota API returned no data')
    // space_amount is -1 for unlimited (Box Business / Enterprise).
    const quota = res.space_amount === -1 ? UNLIMITED_QUOTA_BYTES : res.space_amount
    return { data: { quota, used: res.space_used } }
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

    const result = await boxUploadCreate(this._token, parentId, fileName, Buffer.alloc(0))
    // Cache the new file's ID so commitFileData can update it without re-listing.
    if (result) {
      this._idCache.set(filePath, result.id)
      this._typeCache.set(filePath, 'file')
    }
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
      throw new Error(`Box: fd ${fd} is not open for "${filePath}"`)
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
      // File was created by createEmptyFile — overwrite with accumulated data.
      await boxUploadUpdate(this._token, fileId, data)
    } else {
      // Fallback: create fresh (e.g. if provider was restarted mid-write).
      const parentPath = path.posix.dirname(filePath)
      const fileName   = path.posix.basename(filePath)
      const parentId   = await this._resolveId(parentPath) ?? ROOT_ID
      await boxUploadCreate(this._token, parentId, fileName, data)
    }

    this._invalidateCache()
    this._pendingWrites.delete(fd)
  }

  async deleteFile(filePath: string): Promise<void> {
    const fileId = await this._resolveId(filePath)
    if (fileId === null) return
    await boxDelete(this._token, `/2.0/files/${fileId}`)
    this._invalidateCache()
  }

  async deleteFolder(filePath: string): Promise<void> {
    const folderId = await this._resolveId(filePath)
    if (folderId === null) return
    await boxDelete(this._token, `/2.0/folders/${folderId}?recursive=true`)
    this._invalidateCache()
  }

  async createFolder(filePath: string): Promise<void> {
    const parentPath = path.posix.dirname(filePath)
    const folderName = path.posix.basename(filePath)
    const parentId   = await this._resolveId(parentPath) ?? ROOT_ID
    await boxPost(this._token, '/2.0/folders', {
      name:   folderName,
      parent: { id: parentId },
    })
    this._invalidateCache()
  }

  async move(src: string, dst: string): Promise<void> {
    const srcId   = await this._resolveId(src)
    const srcType = this._typeCache.get(src) ?? 'file'
    if (srcId === null) throw new Error(`Box: source not found: ${src}`)

    const dstParent  = path.posix.dirname(dst)
    const dstName    = path.posix.basename(dst)
    const dstParentId = await this._resolveId(dstParent)
    if (dstParentId === null) throw new Error(`Box: target parent not found: ${dstParent}`)

    const endpoint = srcType === 'folder'
      ? `/2.0/folders/${srcId}`
      : `/2.0/files/${srcId}`

    await boxPut(this._token, endpoint, {
      name:   dstName,
      parent: { id: dstParentId },
    })

    this._invalidateCache()
  }

  // ---- Private helpers ----------------------------------------------------

  private _toFileEntry(item: BoxItem, filePath: string): FileEntry {
    return {
      isdir: item.type === 'folder' ? 1 : 0,
      path:  filePath,
      size:  item.size ?? 0,
      mtime: item.modified_at ? new Date(item.modified_at).getTime() : Date.now(),
      ctime: item.created_at  ? new Date(item.created_at).getTime()  : Date.now(),
    }
  }
}
