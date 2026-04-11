import path from 'path'
import type { CacheTask, DataStore, ProviderProfile } from '../types'
import { MemoryDataStore } from './MemoryDataStore'
import { DiskDataStore } from './DiskDataStore'

export class DataCache {
  private _maxEntries: number = 25
  private _blockSize: number = 1048576
  private _dataStore!: DataStore
  private _fileDataCache: Record<string, CacheTask> = {}
  private _priorityQueue: string[] = []

  init(profile: ProviderProfile, blockSize: number, maxEntries: number): void {
    this._maxEntries = maxEntries
    this._blockSize = blockSize
    this._fileDataCache = {}
    this._priorityQueue = []

    if (profile.cacheStore === 'disk') {
      const store = new DiskDataStore()
      store.init(profile.cachePath)
      this._dataStore = store
    } else {
      const store = new MemoryDataStore()
      store.init()
      this._dataStore = store
    }
  }

  // Generates a stable cache key for a block, based on file path and offset.
  generateKey(task: Pick<CacheTask, 'path' | 'offset'>): string {
    const obscured = task.path.replace(/\//g, ':')
    return `${this._hashCode(task.path)}@${obscured}@${task.offset}`
  }

  private _hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0
    }
    return hash
  }

  get(key: string): CacheTask | null {
    return this._fileDataCache[key] ?? null
  }

  // Adds or updates a cache entry, evicting the oldest entry if the pool is full.
  update(key: string, task: CacheTask): void {
    if (Object.prototype.hasOwnProperty.call(this._fileDataCache, key)) {
      this._fileDataCache[key] = task
      return
    }
    if (this._priorityQueue.length >= this._maxEntries) {
      const evicted = this._priorityQueue.shift()!
      delete this._fileDataCache[evicted]
      this._dataStore.deleteEntry(evicted)
    }
    this._fileDataCache[key] = task
    this._priorityQueue.push(key)
  }

  async writeCache(task: CacheTask, data: Buffer): Promise<void> {
    await this._dataStore.writeEntry(task.md5sum, data)
    this._fileDataCache[task.md5sum].status = 'DONE'
  }

  // Assembles requested byte range from cached blocks into buffer.
  // All HIGH-priority blocks in requestList must be DONE before calling this.
  readCache(
    filePath: string,
    buffer: Buffer,
    offset: number,
    size: number,
    requestList: CacheTask[]
  ): void {
    let cursorMoved = 0

    for (const task of requestList) {
      if (task.priority === 'PREFETCH') continue

      const entry = this._fileDataCache[task.md5sum]
      if (!entry || entry.status !== 'DONE') {
        throw new Error(
          `DataCache: block not ready — path=${filePath} offset=${offset} block=${task.md5sum}`
        )
      }

      const seek = (offset + cursorMoved) % this._blockSize
      let writeSize = this._blockSize - seek
      if (writeSize + cursorMoved > size) {
        writeSize = size - cursorMoved
      }

      this._dataStore.readEntry(task.md5sum, buffer, cursorMoved, seek, writeSize)
      cursorMoved += writeSize
    }
  }

  // Removes cached blocks for a given path.
  // recursive=true removes all blocks whose path starts with filePath.
  clear(filePath: string, recursive: boolean): void {
    const toRemove: string[] = []

    for (const [key, task] of Object.entries(this._fileDataCache)) {
      const matches = recursive
        ? !path.relative(filePath, task.path).startsWith('..')
        : task.path === filePath
      if (matches) toRemove.push(key)
    }

    for (const key of toRemove) {
      delete this._fileDataCache[key]
      this._dataStore.deleteEntry(key)
      const idx = this._priorityQueue.indexOf(key)
      if (idx !== -1) this._priorityQueue.splice(idx, 1)
    }
  }
}
