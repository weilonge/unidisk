import { describe, it, expect, beforeEach } from 'vitest'
import { DataCache } from '../src/helper/DataCache'
import type { CacheTask } from '../src/types'

const BLOCK_SIZE = 1048576 // 1 MB
const MAX_ENTRIES = 5

function makeTask(index: number, overrides: Partial<CacheTask> = {}): CacheTask {
  return {
    path: `/test${index}`,
    totalSize: (index + 1) * BLOCK_SIZE,
    mtime: 1000000,
    status: 'INIT',
    priority: 'HIGH',
    md5sum: '',
    offset: 0,
    size: BLOCK_SIZE,
    ...overrides,
  }
}

describe('DataCache', () => {
  let cache: DataCache

  beforeEach(() => {
    cache = new DataCache()
    cache.init({ cacheStore: 'memory' }, BLOCK_SIZE, MAX_ENTRIES)
  })

  describe('init()', () => {
    it('starts empty', () => {
      expect(cache.get('unknown')).toBeNull()
    })
  })

  describe('generateKey()', () => {
    it('produces a stable key for the same path + offset', () => {
      const a = cache.generateKey({ path: '/file.bin', offset: 0 })
      const b = cache.generateKey({ path: '/file.bin', offset: 0 })
      expect(a).toBe(b)
    })

    it('produces different keys for different offsets', () => {
      const a = cache.generateKey({ path: '/file.bin', offset: 0 })
      const b = cache.generateKey({ path: '/file.bin', offset: BLOCK_SIZE })
      expect(a).not.toBe(b)
    })
  })

  describe('update() / get()', () => {
    it('stores and retrieves a task', () => {
      const task = makeTask(0)
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      expect(cache.get(task.md5sum)).toEqual(task)
    })

    it('evicts the oldest entry when pool is full', async () => {
      const tasks: CacheTask[] = []
      for (let i = 0; i < MAX_ENTRIES + 2; i++) {
        const task = makeTask(i)
        task.md5sum = cache.generateKey(task)
        cache.update(task.md5sum, task)
        await cache.writeCache(task, Buffer.alloc(BLOCK_SIZE))
        tasks.push(task)
      }
      // First two entries should have been evicted
      expect(cache.get(tasks[0].md5sum)).toBeNull()
      expect(cache.get(tasks[1].md5sum)).toBeNull()
      // Latest entries are still present
      expect(cache.get(tasks[MAX_ENTRIES + 1].md5sum)).not.toBeNull()
    })
  })

  describe('writeCache() / readCache()', () => {
    it('marks block as DONE after write', async () => {
      const task = makeTask(0)
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, Buffer.alloc(BLOCK_SIZE, 0x41)) // 'A'
      expect(cache.get(task.md5sum)?.status).toBe('DONE')
    })

    it('reads back the correct bytes', async () => {
      const content = 'hello, unidisk!'
      const data = Buffer.alloc(BLOCK_SIZE)
      Buffer.from(content).copy(data)

      const task = makeTask(0)
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, data)

      const buf = Buffer.alloc(content.length)
      cache.readCache(task.path, buf, 0, content.length, [task])
      expect(buf.toString('ascii')).toBe(content)
    })

    it('reads from a non-zero offset within a block', async () => {
      const data = Buffer.alloc(BLOCK_SIZE)
      Buffer.from('ABCDEFGHIJ').copy(data)

      const task = makeTask(0)
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, data)

      const buf = Buffer.alloc(5)
      cache.readCache(task.path, buf, 5, 5, [task]) // read bytes 5-9 = 'FGHIJ'
      expect(buf.toString('ascii')).toBe('FGHIJ')
    })

    it('skips PREFETCH tasks during readCache', async () => {
      const task = makeTask(0, { priority: 'PREFETCH' })
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, Buffer.alloc(BLOCK_SIZE))

      // readCache should silently skip PREFETCH blocks
      const buf = Buffer.alloc(10)
      expect(() => cache.readCache(task.path, buf, 0, 10, [task])).not.toThrow()
    })

    it('throws if a HIGH block is not DONE', () => {
      const task = makeTask(0) // status stays 'INIT'
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)

      expect(() =>
        cache.readCache(task.path, Buffer.alloc(10), 0, 10, [task])
      ).toThrow(/block not ready/)
    })
  })

  describe('clear()', () => {
    it('removes entries for a specific path', async () => {
      const task = makeTask(0)
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, Buffer.alloc(BLOCK_SIZE))

      cache.clear(task.path, false)
      expect(cache.get(task.md5sum)).toBeNull()
    })

    it('removes child paths when recursive=true', async () => {
      const parent = makeTask(0, { path: '/data' })
      parent.md5sum = cache.generateKey(parent)
      cache.update(parent.md5sum, parent)
      await cache.writeCache(parent, Buffer.alloc(BLOCK_SIZE))

      const child = makeTask(1, { path: '/data/file.bin' })
      child.md5sum = cache.generateKey(child)
      cache.update(child.md5sum, child)
      await cache.writeCache(child, Buffer.alloc(BLOCK_SIZE))

      cache.clear('/data', true)
      expect(cache.get(parent.md5sum)).toBeNull()
      expect(cache.get(child.md5sum)).toBeNull()
    })

    it('does not remove unrelated paths', async () => {
      const task = makeTask(0, { path: '/other/file.bin' })
      task.md5sum = cache.generateKey(task)
      cache.update(task.md5sum, task)
      await cache.writeCache(task, Buffer.alloc(BLOCK_SIZE))

      cache.clear('/data', true)
      expect(cache.get(task.md5sum)).not.toBeNull()
    })
  })
})
