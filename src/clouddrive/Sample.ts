import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type {
  StorageProvider,
  FileEntry,
  FileMetaData,
  DownloadResponse,
  ProviderProfile,
} from '../types'

type SampleNode = { [key: string]: SampleNode | string }

interface PendingWrite {
  path: string
  flags: string
  blocks: Array<{ offset: number; length: number; buffer: string }>
}

interface SampleProfile extends ProviderProfile {
  JSONPath: string
}

export class Sample extends EventEmitter implements StorageProvider {
  private _testData: SampleNode = {}
  private _jsonFileName: string = ''
  private _writePendingData: Record<number, PendingWrite | null> = {}

  init(options: SampleProfile): void {
    this._writePendingData = {}
    if (!options.JSONPath) return   // allow empty filesystem (useful for tests / demos)
    this._jsonFileName = options.JSONPath
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this._testData = require(this._jsonFileName) as SampleNode
  }

  isIllegalFileName(filePath: string): boolean {
    return filePath.includes('/._')
  }

  registerChange(): void {
    fs.watchFile(this._jsonFileName, () => {
      this.emit('fileChange', { path: '/', recursive: true })
      delete require.cache[require.resolve(this._jsonFileName)]
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this._testData = require(this._jsonFileName) as SampleNode
    })
  }

  // ---- Internal helpers --------------------------------------------------

  private _findNode(filePath: string): SampleNode | string | null {
    if (filePath === '/') return this._testData
    const parts = filePath.split('/').filter(Boolean)
    let current: SampleNode | string = this._testData
    for (const part of parts) {
      if (typeof current === 'string') return null
      current = current[part]
      if (current === undefined) return null
    }
    return current ?? null
  }

  private _getMeta(filePath: string): FileEntry | null {
    const node = this._findNode(filePath)
    if (node === null) return null
    if (typeof node === 'string') {
      return {
        isdir: 0,
        path: filePath,
        size: node.length,
        mtime: Date.now(),
        ctime: Date.now(),
      }
    }
    return {
      isdir: 1,
      path: filePath,
      size: 0,
      mtime: Date.now(),
      ctime: Date.now(),
    }
  }

  // ---- StorageProvider ---------------------------------------------------

  async quota(): Promise<{ data: { quota: number; used: number } }> {
    return { data: { quota: 2_313_913_630_720, used: 58_410_672_308 } }
  }

  async getFileMeta(filePath: string): Promise<{ data: FileMetaData | null }> {
    const meta = this._getMeta(filePath)
    return { data: meta ? { list: [meta] } : null }
  }

  async getFileList(filePath: string): Promise<{ data: FileMetaData | null }> {
    const meta = this._getMeta(filePath)
    if (!meta || meta.isdir !== 1) return { data: null }

    const dir = this._findNode(filePath) as SampleNode
    const list = Object.keys(dir).map((key) => {
      const childPath = filePath === '/' ? `/${key}` : `${filePath}/${key}`
      return this._getMeta(childPath)!
    })
    return { data: { list } }
  }

  async getFileDownload(
    filePath: string,
    offset: number,
    size: number
  ): Promise<DownloadResponse> {
    const node = this._findNode(filePath)
    if (!node || typeof node !== 'string') {
      throw new Error(`Sample: file not found: ${filePath}`)
    }
    const slice = node.slice(offset, offset + size)
    const data = Buffer.from(slice)
    return { data, length: data.length }
  }

  async openFile(filePath: string, flags: string, fd: number): Promise<void> {
    if (this._writePendingData[fd]) {
      throw new Error(`Sample: fd ${fd} is already open`)
    }
    this._writePendingData[fd] = { path: filePath, flags, blocks: [] }
  }

  async closeFile(_filePath: string, fd: number): Promise<void> {
    this._writePendingData[fd] = null
  }

  async createEmptyFile(filePath: string): Promise<void> {
    if (this._findNode(filePath) !== null) {
      throw new Error(`Sample: file already exists: ${filePath}`)
    }
    const parts = filePath.split('/').filter(Boolean)
    let current = this._testData
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]] as SampleNode
    }
    current[parts[parts.length - 1]] = ''
  }

  async writeFileData(
    filePath: string,
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number
  ): Promise<{ length: number }> {
    const pending = this._writePendingData[fd]
    if (!pending || pending.path !== filePath) {
      throw new Error(`Sample: fd ${fd} is not open for ${filePath}`)
    }
    if (pending.blocks.length > 0) {
      const last = pending.blocks[pending.blocks.length - 1]
      if (last.offset + last.length !== offset) {
        throw new Error('Sample: non-sequential write')
      }
    } else if (offset !== 0) {
      throw new Error('Sample: write must start at offset 0')
    }
    pending.blocks.push({ offset, length, buffer: buffer.toString('binary') })
    return { length }
  }

  async commitFileData(filePath: string, fd: number): Promise<void> {
    const pending = this._writePendingData[fd]
    if (!pending || pending.path !== filePath) {
      throw new Error(`Sample: fd ${fd} is not open for ${filePath}`)
    }
    const baseName = path.basename(filePath)
    const dir = this._findNode(path.dirname(filePath)) as SampleNode
    for (const block of pending.blocks) {
      dir[baseName] = ((dir[baseName] as string) ?? '') + block.buffer
    }
    this._writePendingData[fd] = null
  }

  async deleteFile(filePath: string): Promise<void> {
    const parts = filePath.split('/').filter(Boolean)
    let current = this._testData
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]] as SampleNode
    }
    delete current[parts[parts.length - 1]]
  }

  async deleteFolder(filePath: string): Promise<void> {
    return this.deleteFile(filePath)
  }

  async createFolder(filePath: string): Promise<void> {
    const parts = filePath.split('/').filter(Boolean)
    let current = this._testData
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]] as SampleNode
    }
    current[parts[parts.length - 1]] = {}
  }

  async move(src: string, dst: string): Promise<void> {
    const srcNode = this._findNode(src)
    if (srcNode === null) throw new Error(`Sample: source not found: ${src}`)
    await this.deleteFile(src)
    const dstParts = dst.split('/').filter(Boolean)
    let current = this._testData
    for (let i = 0; i < dstParts.length - 1; i++) {
      current = current[dstParts[i]] as SampleNode
    }
    current[dstParts[dstParts.length - 1]] = srcNode as string
  }
}
