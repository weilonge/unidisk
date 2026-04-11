import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UdManager } from '../src/helper/udManager'
import type { StorageProvider, ProviderProfile, FileMetaData, DownloadResponse } from '../src/types'

const BLOCK_SIZE = 1024 * 1024 // 1 MB
const FILE_SIZE = 5 * BLOCK_SIZE // 5 MB test file

// Build a fake provider backed by a deterministic in-memory buffer.
// Each byte at position i contains (i % 251) so we can verify content.
function makeProvider(fileSize: number = FILE_SIZE): StorageProvider {
  const fileData = Buffer.allocUnsafe(fileSize)
  for (let i = 0; i < fileSize; i++) fileData[i] = i % 251

  const fileMetaData: FileMetaData = {
    list: [{ isdir: 0, path: '/test.bin', size: fileSize, mtime: 0, ctime: 0 }],
  }

  return {
    init: vi.fn(),
    isIllegalFileName: (p: string) => p.includes('/._'),
    getFileMeta: vi.fn(async (path: string) => ({
      data: path === '/test.bin' ? fileMetaData : null,
    })),
    getFileList: vi.fn(async () => ({ data: fileMetaData })),
    getFileDownload: vi.fn(async (_path: string, offset: number, size: number): Promise<DownloadResponse> => {
      const slice = fileData.slice(offset, offset + size)
      return { data: Buffer.from(slice), length: slice.length }
    }),
    quota: vi.fn(async () => ({ data: { quota: 1_000_000, used: 100 } })),
    openFile: vi.fn(async () => {}),
    closeFile: vi.fn(async () => {}),
    createEmptyFile: vi.fn(async () => {}),
    writeFileData: vi.fn(async () => ({ length: 0 })),
    commitFileData: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
  }
}

function makeManager(provider: StorageProvider): UdManager {
  const manager = new UdManager()
  const profile: ProviderProfile = { cacheStore: 'memory' }
  manager.init({
    provider,
    profile,
    blockSize: BLOCK_SIZE,
    blockWritingSize: 8 * BLOCK_SIZE,
    fuseIoSize: 65536,
    queueConcurrency: 3,
    prefetchBlocks: 2,
    maxDataCacheEntries: 20,
  })
  return manager
}

describe('UdManager', () => {
  let provider: StorageProvider
  let manager: UdManager

  beforeEach(() => {
    provider = makeProvider()
    manager = makeManager(provider)
  })

  describe('getFileMeta()', () => {
    it('returns metadata for a known file', async () => {
      const meta = await manager.getFileMeta('/test.bin')
      expect(meta?.size).toBe(FILE_SIZE)
      expect(meta?.isdir).toBe(0)
    })

    it('returns null for an unknown path', async () => {
      const meta = await manager.getFileMeta('/unknown.bin')
      expect(meta).toBeNull()
    })

    it('returns null for an illegal filename', async () => {
      const meta = await manager.getFileMeta('/._hidden')
      expect(meta).toBeNull()
      expect(provider.getFileMeta).not.toHaveBeenCalled()
    })

    it('caches the result — provider called only once', async () => {
      await manager.getFileMeta('/test.bin')
      await manager.getFileMeta('/test.bin')
      expect(provider.getFileMeta).toHaveBeenCalledTimes(1)
    })
  })

  describe('getFileList()', () => {
    it('returns the file list', async () => {
      const list = await manager.getFileList('/')
      expect(list.length).toBeGreaterThan(0)
    })

    it('caches the result — provider called only once', async () => {
      await manager.getFileList('/')
      await manager.getFileList('/')
      expect(provider.getFileList).toHaveBeenCalledTimes(1)
    })
  })

  describe('downloadFileInRangeByCache()', () => {
    it('reads the first block correctly', async () => {
      const buf = Buffer.alloc(BLOCK_SIZE)
      await manager.downloadFileInRangeByCache('/test.bin', buf, 0, BLOCK_SIZE)
      // Verify content: byte i should equal i % 251
      for (let i = 0; i < BLOCK_SIZE; i++) {
        expect(buf[i]).toBe(i % 251)
      }
    })

    it('reads a sub-range within a block', async () => {
      const size = 512
      const offset = 100
      const buf = Buffer.alloc(size)
      await manager.downloadFileInRangeByCache('/test.bin', buf, offset, size)
      for (let i = 0; i < size; i++) {
        expect(buf[i]).toBe((offset + i) % 251)
      }
    })

    it('reads across a block boundary', async () => {
      // Request 512 bytes straddling the block boundary at BLOCK_SIZE
      const offset = BLOCK_SIZE - 256
      const size = 512
      const buf = Buffer.alloc(size)
      await manager.downloadFileInRangeByCache('/test.bin', buf, offset, size)
      for (let i = 0; i < size; i++) {
        expect(buf[i]).toBe((offset + i) % 251)
      }
    })

    it('serves cached blocks without re-fetching', async () => {
      const buf = Buffer.alloc(BLOCK_SIZE)
      await manager.downloadFileInRangeByCache('/test.bin', buf, 0, BLOCK_SIZE)
      const callsAfterFirst = (provider.getFileDownload as ReturnType<typeof vi.fn>).mock.calls.length

      await manager.downloadFileInRangeByCache('/test.bin', buf, 0, BLOCK_SIZE)
      expect((provider.getFileDownload as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst)
    })

    it('prefetches blocks beyond the requested range', async () => {
      const buf = Buffer.alloc(BLOCK_SIZE)
      await manager.downloadFileInRangeByCache('/test.bin', buf, 0, BLOCK_SIZE)

      // Wait briefly for background prefetch to complete
      await new Promise(r => setTimeout(r, 100))

      const calls = (provider.getFileDownload as ReturnType<typeof vi.fn>).mock.calls
      // Should have fetched block 0 + at least 1 prefetch block
      expect(calls.length).toBeGreaterThan(1)
    })
  })

  describe('openFile() / closeFile()', () => {
    it('returns a valid fd', async () => {
      const fd = await manager.openFile('/test.bin', 'r')
      expect(fd).toBeGreaterThanOrEqual(0)
    })

    it('opens multiple files with different fds', async () => {
      const fd1 = await manager.openFile('/a.bin', 'r')
      const fd2 = await manager.openFile('/b.bin', 'r')
      expect(fd1).not.toBe(fd2)
    })

    it('closes a file and calls provider.commitFileData', async () => {
      const fd = await manager.openFile('/test.bin', 'r')
      await manager.closeFile('/test.bin', fd)
      expect(provider.commitFileData).toHaveBeenCalledWith('/test.bin', fd)
    })

    it('throws when closing an fd that is not open', async () => {
      await expect(manager.closeFile('/test.bin', 999)).rejects.toThrow()
    })
  })

  describe('filesystem mutations', () => {
    it('createEmptyFile delegates to provider and clears cache', async () => {
      await manager.createEmptyFile('/new.txt')
      expect(provider.createEmptyFile).toHaveBeenCalledWith('/new.txt')
    })

    it('deleteFile delegates to provider', async () => {
      await manager.deleteFile('/test.bin')
      expect(provider.deleteFile).toHaveBeenCalledWith('/test.bin')
    })

    it('createFolder delegates to provider', async () => {
      await manager.createFolder('/newdir')
      expect(provider.createFolder).toHaveBeenCalledWith('/newdir')
    })

    it('move delegates to provider', async () => {
      await manager.move('/a.txt', '/b.txt')
      expect(provider.move).toHaveBeenCalledWith('/a.txt', '/b.txt')
    })
  })

  describe('showStat()', () => {
    it('returns quota info', async () => {
      const stat = await manager.showStat()
      expect(stat.data.quota).toBe(1_000_000)
    })

    it('caches quota — provider called only once', async () => {
      await manager.showStat()
      await manager.showStat()
      expect(provider.quota).toHaveBeenCalledTimes(1)
    })
  })
})
