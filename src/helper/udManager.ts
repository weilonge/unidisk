import { EventEmitter } from 'events'
import PQueue from 'p-queue'
import { logger } from './logger'
import { MetaCache } from './MetaCache'
import { DataCache } from './DataCache'
import { RetryableError } from './RetryableError'
import type {
  StorageProvider,
  ProviderProfile,
  CacheTask,
  FileEntry,
} from '../types'

const MAX_FILE_OPEN_NUM = 1024
const RETRY_DELAY_MS = 800

interface OpenFileEntry {
  path: string
  flags: string
  uploadedChunk: number
  writingBlocks: Array<{ buffer: Buffer; offset: number; length: number }>
}

export interface UdManagerOptions {
  provider: StorageProvider
  profile: ProviderProfile
  blockSize: number
  blockWritingSize: number
  fuseIoSize: number
  queueConcurrency: number
  prefetchBlocks: number
  maxDataCacheEntries: number
}

export class UdManager extends EventEmitter {
  private _provider!: StorageProvider
  private _metaCache!: MetaCache
  private _dataCache!: DataCache
  private _downloadQueue!: PQueue
  private _openedFiles: Map<number, OpenFileEntry> = new Map()
  private _quotaCache: { data: { quota: number; used: number } } | null = null

  private _blockSize: number = 0
  private _prefetchSize: number = 0
  private _blockWritingSize: number = 0
  private _fuseIoSize: number = 0
  private _writingBlockNum: number = 0

  init(options: UdManagerOptions): void {
    this._blockSize = options.blockSize
    this._prefetchSize = options.prefetchBlocks * options.blockSize
    this._blockWritingSize = options.blockWritingSize
    this._fuseIoSize = options.fuseIoSize
    this._writingBlockNum = options.blockWritingSize / options.fuseIoSize

    this._provider = options.provider
    this._provider.init(options.profile)

    this._metaCache = new MetaCache()
    this._metaCache.init()

    this._dataCache = new DataCache()
    this._dataCache.init(options.profile, options.blockSize, options.maxDataCacheEntries)

    this._downloadQueue = new PQueue({ concurrency: options.queueConcurrency })

    // Invalidate caches when the provider signals a remote change.
    if (this._provider instanceof EventEmitter) {
      this._provider.on('fileChange', (evt: { path: string; recursive: boolean }) => {
        logger.info(`File change detected at ${evt.path}`)
        this._metaCache.clear(evt.path, evt.recursive)
        this._dataCache.clear(evt.path, evt.recursive)
      })
    }

    if (this._provider.registerChange) {
      this._provider.registerChange()
    }
  }

  // ---- Quota -------------------------------------------------------------

  async showStat(): Promise<{ data: { quota: number; used: number } }> {
    if (this._quotaCache) return this._quotaCache
    this._quotaCache = await this._provider.quota()
    return this._quotaCache
  }

  // ---- Metadata ----------------------------------------------------------

  async getFileMeta(filePath: string): Promise<FileEntry | null> {
    if (this._provider.isIllegalFileName(filePath)) return null

    const cached = this._metaCache.get(filePath)
    if (cached) return cached.list[0] ?? null

    const res = await this._fetchWithRetry(() => this._provider.getFileMeta(filePath))
    if (res.data) {
      this._metaCache.update(filePath, res.data)
      return res.data.list[0] ?? null
    }
    return null
  }

  async getFileList(filePath: string): Promise<FileEntry[]> {
    if (this._provider.isIllegalFileName(filePath)) return []

    const cachedList = this._metaCache.getList(filePath)
    if (cachedList) return cachedList.list

    const res = await this._fetchWithRetry(() => this._provider.getFileList(filePath))
    if (res.data) {
      this._metaCache.updateList(filePath, res.data)
      return res.data.list
    }
    return []
  }

  // ---- Read path ---------------------------------------------------------

  // Main read entry point — used by the FUSE read() handler.
  // Splits the request into aligned blocks, downloads missing ones (with
  // prefetch), then assembles the result into buffer.
  async downloadFileInRangeByCache(
    filePath: string,
    buffer: Buffer,
    offset: number,
    size: number
  ): Promise<void> {
    logger.verbose(`{{ read ${filePath} offset=${offset} size=${size}`)

    const meta = await this.getFileMeta(filePath)
    if (!meta) throw new Error(`udManager: file not found: ${filePath}`)

    const requestList = this._generateRequestList(meta, offset, size)
    await this._downloadMissingBlocks(requestList)
    this._dataCache.readCache(filePath, buffer, offset, size, requestList)

    logger.verbose(`}} read ${filePath} done`)
  }

  // ---- Block download internals ------------------------------------------

  private _generateRequestList(
    meta: FileEntry,
    offset: number,
    size: number
  ): CacheTask[] {
    const fileSize = meta.size
    const endPos = offset + size
    const prefetchEnd = endPos + this._prefetchSize
    const tasks: CacheTask[] = []

    let alignedOffset = Math.floor(offset / this._blockSize) * this._blockSize

    // HIGH priority: blocks needed to satisfy this read
    for (; alignedOffset < endPos && alignedOffset < fileSize; alignedOffset += this._blockSize) {
      const blockSize = Math.min(this._blockSize, fileSize - alignedOffset)
      const task: CacheTask = {
        path: meta.path,
        totalSize: meta.size,
        mtime: meta.mtime,
        status: 'INIT',
        priority: 'HIGH',
        md5sum: '',
        offset: alignedOffset,
        size: blockSize,
      }
      task.md5sum = this._dataCache.generateKey(task)
      tasks.push(task)
    }

    // PREFETCH priority: blocks likely needed next
    for (; alignedOffset < prefetchEnd && alignedOffset < fileSize; alignedOffset += this._blockSize) {
      const blockSize = Math.min(this._blockSize, fileSize - alignedOffset)
      const task: CacheTask = {
        path: meta.path,
        totalSize: meta.size,
        mtime: meta.mtime,
        status: 'INIT',
        priority: 'PREFETCH',
        md5sum: '',
        offset: alignedOffset,
        size: blockSize,
      }
      task.md5sum = this._dataCache.generateKey(task)
      tasks.push(task)
    }

    return tasks
  }

  // Enqueues missing blocks for download. Returns when all HIGH-priority
  // blocks are done; PREFETCH blocks download in the background.
  private async _downloadMissingBlocks(requestList: CacheTask[]): Promise<void> {
    const highPriorityTasks = requestList.filter(t => t.priority === 'HIGH')
    const prefetchTasks = requestList.filter(t => t.priority === 'PREFETCH')

    // Download HIGH blocks and wait
    await Promise.all(highPriorityTasks.map(task => this._ensureBlock(task, 0)))

    // Fire-and-forget PREFETCH blocks
    for (const task of prefetchTasks) {
      this._ensureBlock(task, 1).catch(err =>
        logger.verbose(`Prefetch failed for ${task.path}@${task.offset}: ${err}`)
      )
    }
  }

  // Ensures a single block is downloaded and cached.
  // If already cached (any status), returns immediately.
  private async _ensureBlock(task: CacheTask, priority: number): Promise<void> {
    const existing = this._dataCache.get(task.md5sum)
    if (existing?.status === 'DONE') return
    if (existing?.status === 'DOWNLOADING') {
      // Another queue item is already fetching this block — wait for it.
      return this._waitForBlock(task.md5sum)
    }

    // Register the block as downloading before enqueuing so concurrent
    // callers hitting the same key don't double-enqueue.
    this._dataCache.update(task.md5sum, { ...task, status: 'DOWNLOADING' })

    return this._downloadQueue.add(
      async () => {
        logger.verbose(`  [DL] ${task.path}@${task.offset} size=${task.size}`)
        const response = await this._fetchBlockWithRetry(task)
        await this._dataCache.writeCache(task, response)
        logger.verbose(`  [OK] ${task.path}@${task.offset}`)
      },
      { priority }
    ) as Promise<void>
  }

  // Polls until a block transitions to DONE. Used when another queue worker
  // is already downloading the same block.
  private _waitForBlock(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const entry = this._dataCache.get(key)
        if (entry?.status === 'DONE') return resolve()
        if (!entry) return reject(new Error(`Block ${key} disappeared while waiting`))
        setTimeout(check, 50)
      }
      check()
    })
  }

  // Downloads a single block range from the provider, retrying on error.
  private async _fetchBlockWithRetry(task: CacheTask): Promise<Buffer> {
    return this._fetchWithRetry(async () => {
      const res = await this._provider.getFileDownload(task.path, task.offset, task.size)
      if (!res?.data || res.length !== task.size) {
        throw new Error(
          `Block size mismatch: expected=${task.size} got=${res?.length}`
        )
      }
      return res.data
    })
  }

  // Generic retry wrapper.
  // If the provider throws a RetryableError it can specify how long to wait;
  // otherwise the default fixed delay is used.
  private async _fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fn()
      } catch (err) {
        const delay = err instanceof RetryableError ? err.retryAfter : RETRY_DELAY_MS
        logger.error(`Retrying after error: ${err}`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  // ---- File handle management --------------------------------------------

  async openFile(filePath: string, flags: string): Promise<number> {
    for (let i = 0; i < MAX_FILE_OPEN_NUM; i++) {
      if (!this._openedFiles.has(i)) {
        this._openedFiles.set(i, {
          path: filePath,
          flags,
          uploadedChunk: 0,
          writingBlocks: [],
        })
        await this._provider.openFile(filePath, flags, i)
        return i
      }
    }
    throw new Error('udManager: max open file limit reached')
  }

  async closeFile(filePath: string, fd: number): Promise<void> {
    const entry = this._openedFiles.get(fd)
    if (!entry || entry.path !== filePath) {
      throw new Error(`udManager: no open fd ${fd} for ${filePath}`)
    }

    if (entry.writingBlocks.length > 0) {
      await this._flushWriteBuffer(filePath, fd)
    }

    await this._provider.commitFileData(filePath, fd)

    if (entry.flags !== 'r' && entry.flags !== 'r+') {
      this._metaCache.clear('/', true)
      this._dataCache.clear('/', true)
    }

    this._openedFiles.delete(fd)
  }

  // ---- Write path --------------------------------------------------------

  async write(
    filePath: string,
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number
  ): Promise<number> {
    const entry = this._openedFiles.get(fd)
    if (!entry || entry.path !== filePath) {
      throw new Error(`udManager: fd ${fd} is not open for ${filePath}`)
    }

    const expectedOffset =
      entry.uploadedChunk * this._blockWritingSize +
      entry.writingBlocks.length * this._fuseIoSize

    if (expectedOffset !== offset) {
      logger.error(`udManager: unexpected write offset expected=${expectedOffset} got=${offset}`)
      return length
    }

    entry.writingBlocks.push({ buffer: Buffer.from(buffer), offset, length })

    if (entry.writingBlocks.length >= this._writingBlockNum) {
      await this._flushWriteBuffer(filePath, fd)
      entry.writingBlocks = []
      entry.uploadedChunk++
    }

    return length
  }

  private async _flushWriteBuffer(filePath: string, fd: number): Promise<void> {
    const entry = this._openedFiles.get(fd)!
    const totalLength = entry.writingBlocks.reduce((acc, b) => acc + b.length, 0)
    const startOffset = entry.writingBlocks[0].offset
    const combined = Buffer.concat(entry.writingBlocks.map(b => b.buffer))
    await this._provider.writeFileData(filePath, fd, combined, startOffset, totalLength)
  }

  // ---- Filesystem mutations ----------------------------------------------

  async createEmptyFile(filePath: string): Promise<void> {
    await this._provider.createEmptyFile(filePath)
    this._metaCache.clear('/', true)
    this._dataCache.clear('/', true)
  }

  async deleteFile(filePath: string): Promise<void> {
    await this._provider.deleteFile(filePath)
    this._metaCache.clear('/', true)
    this._dataCache.clear('/', true)
  }

  async createFolder(filePath: string): Promise<void> {
    await this._provider.createFolder(filePath)
    this._metaCache.clear('/', true)
    this._dataCache.clear('/', true)
  }

  async deleteFolder(filePath: string): Promise<void> {
    await this._provider.deleteFolder(filePath)
    this._metaCache.clear('/', true)
    this._dataCache.clear('/', true)
  }

  async move(src: string, dst: string): Promise<void> {
    await this._provider.move(src, dst)
    this._metaCache.clear('/', true)
    this._dataCache.clear('/', true)
  }
}
