import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import { Sample } from '../src/clouddrive/Sample'

const FIXTURE = path.resolve(__dirname, '../dist/samplefs.json')

// Inline fixture so tests don't depend on the filesystem layout
const SAMPLE_DATA = {
  'hello.txt': 'Hello World!\n',
  dir1: {
    'welcome.txt': 'Welcome to UniDisk\n',
    dir2: {
      'nested.txt': 'Nested file content\n',
    },
  },
}

function makeSample(): Sample {
  const s = new Sample()
  // Bypass file loading by injecting data directly
  ;(s as unknown as { _testData: typeof SAMPLE_DATA })._testData = JSON.parse(
    JSON.stringify(SAMPLE_DATA)
  )
  ;(s as unknown as { _writePendingData: Record<number, null> })._writePendingData = {}
  return s
}

describe('Sample provider', () => {
  let provider: Sample

  beforeEach(() => {
    provider = makeSample()
  })

  describe('getFileMeta()', () => {
    it('returns directory metadata for /', async () => {
      const res = await provider.getFileMeta('/')
      expect(res.data?.list[0].isdir).toBe(1)
      expect(res.data?.list[0].path).toBe('/')
    })

    it('returns file metadata for a known file', async () => {
      const res = await provider.getFileMeta('/hello.txt')
      expect(res.data?.list[0].isdir).toBe(0)
      expect(res.data?.list[0].size).toBe(SAMPLE_DATA['hello.txt'].length)
    })

    it('returns null for an unknown path', async () => {
      const res = await provider.getFileMeta('/does-not-exist.txt')
      expect(res.data).toBeNull()
    })
  })

  describe('getFileList()', () => {
    it('lists root directory entries', async () => {
      const res = await provider.getFileList('/')
      const names = res.data!.list.map((e) => e.path)
      expect(names).toContain('/hello.txt')
      expect(names).toContain('/dir1')
    })

    it('lists a nested directory', async () => {
      const res = await provider.getFileList('/dir1')
      const names = res.data!.list.map((e) => e.path)
      expect(names).toContain('/dir1/welcome.txt')
      expect(names).toContain('/dir1/dir2')
    })

    it('returns null for a file path', async () => {
      const res = await provider.getFileList('/hello.txt')
      expect(res.data).toBeNull()
    })
  })

  describe('getFileDownload()', () => {
    it('returns the full file content', async () => {
      const res = await provider.getFileDownload('/hello.txt', 0, 100)
      expect(res.data.toString()).toBe(SAMPLE_DATA['hello.txt'])
    })

    it('returns a slice at a given offset', async () => {
      const res = await provider.getFileDownload('/hello.txt', 6, 5)
      expect(res.data.toString()).toBe('World')
    })

    it('throws for a non-existent file', async () => {
      await expect(provider.getFileDownload('/missing.txt', 0, 10)).rejects.toThrow()
    })
  })

  describe('write operations', () => {
    it('creates an empty file', async () => {
      await provider.createEmptyFile('/new.txt')
      const meta = await provider.getFileMeta('/new.txt')
      expect(meta.data).not.toBeNull()
    })

    it('writes and commits data', async () => {
      await provider.createEmptyFile('/write.txt')
      await provider.openFile('/write.txt', 'w', 1)
      await provider.writeFileData('/write.txt', 1, Buffer.from('hello'), 0, 5)
      await provider.commitFileData('/write.txt', 1)

      const res = await provider.getFileDownload('/write.txt', 0, 5)
      expect(res.data.toString('binary')).toBe('hello')
    })

    it('deletes a file', async () => {
      await provider.deleteFile('/hello.txt')
      const meta = await provider.getFileMeta('/hello.txt')
      expect(meta.data).toBeNull()
    })

    it('creates a folder', async () => {
      await provider.createFolder('/newdir')
      const meta = await provider.getFileMeta('/newdir')
      expect(meta.data?.list[0].isdir).toBe(1)
    })

    it('moves a file', async () => {
      await provider.move('/hello.txt', '/renamed.txt')
      const old = await provider.getFileMeta('/hello.txt')
      const moved = await provider.getFileMeta('/renamed.txt')
      expect(old.data).toBeNull()
      expect(moved.data).not.toBeNull()
    })
  })

  describe('isIllegalFileName()', () => {
    it('flags paths containing /._', () => {
      expect(provider.isIllegalFileName('/._hidden')).toBe(true)
    })

    it('allows normal paths', () => {
      expect(provider.isIllegalFileName('/hello.txt')).toBe(false)
    })
  })
})
