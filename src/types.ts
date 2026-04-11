// Core types shared across all UniDisk modules.

export interface FileEntry {
  isdir: 0 | 1
  path: string
  size: number
  mtime: number
  ctime: number
}

export interface FileMetaData {
  list: FileEntry[]
}

export interface DownloadResponse {
  data: Buffer
  length: number
}

export interface QuotaInfo {
  quota: number
  used: number
}

// ---- Cache types --------------------------------------------------------

export type CacheStatus = 'INIT' | 'DOWNLOADING' | 'DONE'
export type CachePriority = 'HIGH' | 'PREFETCH'

export interface CacheTask {
  path: string
  totalSize: number
  mtime: number
  status: CacheStatus
  priority: CachePriority
  md5sum: string
  offset: number
  size: number
}

// ---- DataStore interface ------------------------------------------------

export interface DataStore {
  init(cachePath?: string): void
  readEntry(
    key: string,
    targetBuffer: Buffer,
    targetOffset: number,
    sourceOffset: number,
    length: number
  ): void
  writeEntry(key: string, data: Buffer): Promise<void>
  deleteEntry(key: string): void
}

// ---- Provider config ----------------------------------------------------

export interface ProviderProfile {
  type?: 'mount' | 'unmount'
  module?: string
  writable?: boolean
  cacheStore: 'memory' | 'disk'
  cachePath?: string
  [key: string]: unknown
}

export interface UniDiskConfig {
  block_reading_size: number
  block_writing_size: number
  fuse_iosize: number
  queue_concurrency: number
  prefetch_blocks: number
  max_data_cache_entry: number
  cache_path: string
  profile: Record<string, ProviderProfile>
}

// ---- StorageProvider interface ------------------------------------------
//
// Every cloud backend (Dropbox, HuggingFace, TeraBox, …) implements this.
// All operations are async (Promise-based); no callbacks.

export interface StorageProvider {
  init(options: ProviderProfile): void
  isIllegalFileName(path: string): boolean

  // Read operations
  getFileMeta(path: string): Promise<{ data: FileMetaData | null }>
  getFileList(path: string): Promise<{ data: FileMetaData | null }>
  getFileDownload(path: string, offset: number, size: number): Promise<DownloadResponse>
  quota(): Promise<{ data: QuotaInfo }>

  // Write operations (providers that are read-only may throw)
  openFile(path: string, flags: string, fd: number): Promise<void>
  closeFile(path: string, fd: number): Promise<void>
  createEmptyFile(path: string): Promise<void>
  writeFileData(
    path: string,
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number
  ): Promise<{ length: number }>
  commitFileData(path: string, fd: number): Promise<void>
  deleteFile(path: string): Promise<void>
  deleteFolder(path: string): Promise<void>
  createFolder(path: string): Promise<void>
  move(src: string, dst: string): Promise<void>

  // Optional change-notification hook
  registerChange?(): void
}
