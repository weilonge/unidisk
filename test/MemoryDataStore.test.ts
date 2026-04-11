import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryDataStore } from '../src/helper/MemoryDataStore'

describe('MemoryDataStore', () => {
  let store: MemoryDataStore

  beforeEach(() => {
    store = new MemoryDataStore()
    store.init()
  })

  it('writes and reads back data from offset 0', async () => {
    await store.writeEntry('k1', Buffer.from('hello world'))
    const buf = Buffer.alloc(5)
    store.readEntry('k1', buf, 0, 0, 5)
    expect(buf.toString()).toBe('hello')
  })

  it('reads from a non-zero source offset', async () => {
    await store.writeEntry('k1', Buffer.from('hello world'))
    const buf = Buffer.alloc(5)
    store.readEntry('k1', buf, 0, 6, 5)
    expect(buf.toString()).toBe('world')
  })

  it('writes into a non-zero target offset', async () => {
    await store.writeEntry('k1', Buffer.from('hello world'))
    const buf = Buffer.alloc(8, 0x2e) // '..........'
    store.readEntry('k1', buf, 3, 0, 5) // copy 'hello' starting at buf[3]
    expect(buf.toString()).toBe('...hello')
  })

  it('overwrites an existing entry', async () => {
    await store.writeEntry('k1', Buffer.from('first'))
    await store.writeEntry('k1', Buffer.from('second'))
    const buf = Buffer.alloc(6)
    store.readEntry('k1', buf, 0, 0, 6)
    expect(buf.toString()).toBe('second')
  })

  it('deletes an entry without error', async () => {
    await store.writeEntry('k1', Buffer.from('data'))
    expect(() => store.deleteEntry('k1')).not.toThrow()
  })

  it('reinitialises cleanly', async () => {
    await store.writeEntry('k1', Buffer.from('data'))
    store.init()
    // Attempting to read after re-init should throw (key gone)
    expect(() => store.readEntry('k1', Buffer.alloc(4), 0, 0, 4)).toThrow()
  })
})
