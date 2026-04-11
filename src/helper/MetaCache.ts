import path from 'path'
import type { FileMetaData } from '../types'

export class MetaCache {
  private _fileMetaCache: Record<string, FileMetaData> = {}
  private _fileListCache: Record<string, FileMetaData> = {}

  init(): void {
    this._fileMetaCache = {}
    this._fileListCache = {}
  }

  update(filePath: string, data: FileMetaData): void {
    this._fileMetaCache[filePath] = data
  }

  hasEntry(filePath: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._fileMetaCache, filePath)
  }

  get(filePath: string): FileMetaData | null {
    return this.hasEntry(filePath) ? this._fileMetaCache[filePath] : null
  }

  updateList(filePath: string, data: FileMetaData): void {
    this._fileListCache[filePath] = data
  }

  getList(filePath: string): FileMetaData | null {
    return Object.prototype.hasOwnProperty.call(this._fileListCache, filePath)
      ? this._fileListCache[filePath]
      : null
  }

  // Clears cached entries by path.
  //
  // - No path → no-op (matches original behaviour: commented-out full wipe).
  // - recursive=true  → remove all entries whose path starts with filePath.
  // - recursive=false → remove only the exact path.
  clear(filePath?: string, recursive?: boolean): void {
    if (!filePath) return

    if (recursive) {
      for (const p of Object.keys(this._fileMetaCache)) {
        if (!path.relative(filePath, p).startsWith('..')) {
          delete this._fileMetaCache[p]
        }
      }
      for (const p of Object.keys(this._fileListCache)) {
        if (!path.relative(filePath, p).startsWith('..')) {
          delete this._fileListCache[p]
        }
      }
    } else {
      delete this._fileMetaCache[filePath]
      delete this._fileListCache[filePath]
    }
  }
}
