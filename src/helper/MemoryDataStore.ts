import type { DataStore } from '../types'

export class MemoryDataStore implements DataStore {
  private _data: Record<string, Buffer> = {}

  init(): void {
    this._data = {}
  }

  readEntry(
    key: string,
    targetBuffer: Buffer,
    targetOffset: number,
    sourceOffset: number,
    length: number
  ): void {
    this._data[key].copy(targetBuffer, targetOffset, sourceOffset, sourceOffset + length)
  }

  async writeEntry(key: string, data: Buffer): Promise<void> {
    this._data[key] = Buffer.from(data)
  }

  deleteEntry(key: string): void {
    delete this._data[key]
  }
}
