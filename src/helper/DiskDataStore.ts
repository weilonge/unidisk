import fs from 'fs-extra'
import path from 'path'
import type { DataStore } from '../types'

export class DiskDataStore implements DataStore {
  private _cachePath: string = ''

  init(cachePath: string = '/tmp/ud/cache'): void {
    this._cachePath = cachePath
    fs.removeSync(this._cachePath)
    fs.mkdirsSync(this._cachePath)
  }

  private filePath(key: string): string {
    return path.join(this._cachePath, key)
  }

  readEntry(
    key: string,
    targetBuffer: Buffer,
    targetOffset: number,
    sourceOffset: number,
    length: number
  ): void {
    const fd = fs.openSync(this.filePath(key), 'rs')
    fs.readSync(fd, targetBuffer, targetOffset, length, sourceOffset)
    fs.closeSync(fd)
  }

  async writeEntry(key: string, data: Buffer): Promise<void> {
    await fs.writeFile(this.filePath(key), data)
  }

  deleteEntry(key: string): void {
    fs.unlink(this.filePath(key), () => {})
  }
}
