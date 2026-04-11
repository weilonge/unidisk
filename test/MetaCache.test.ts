import { describe, it, expect, beforeEach } from 'vitest'
import { MetaCache } from '../src/helper/MetaCache'
import type { FileMetaData } from '../src/types'

function entry(label: string): FileMetaData {
  return {
    list: [{ isdir: 0, path: `/${label}`, size: 0, mtime: 0, ctime: 0 }],
  }
}

describe('MetaCache', () => {
  let cache: MetaCache

  beforeEach(() => {
    cache = new MetaCache()
    cache.init()
  })

  describe('init()', () => {
    it('starts with no entries', () => {
      expect(cache.get('/any')).toBeNull()
      expect(cache.getList('/any')).toBeNull()
      expect(cache.hasEntry('/any')).toBe(false)
    })
  })

  describe('get() / update()', () => {
    it('returns null for an unknown path', () => {
      expect(cache.get('/unknown')).toBeNull()
    })

    it('returns the stored value after update', () => {
      const data = entry('a')
      cache.update('/a', data)
      expect(cache.get('/a')).toEqual(data)
      expect(cache.hasEntry('/a')).toBe(true)
    })

    it('overwrites an existing entry', () => {
      cache.update('/a', entry('a'))
      const updated = entry('a-updated')
      cache.update('/a', updated)
      expect(cache.get('/a')).toEqual(updated)
    })
  })

  describe('getList() / updateList()', () => {
    it('returns null for an unknown path', () => {
      expect(cache.getList('/unknown')).toBeNull()
    })

    it('returns the stored list after updateList', () => {
      const data = entry('b')
      cache.updateList('/b', data)
      expect(cache.getList('/b')).toEqual(data)
    })
  })

  describe('clear()', () => {
    it('does nothing when called with no path', () => {
      cache.update('/data/c', entry('c'))
      cache.updateList('/data/c', entry('c'))
      cache.clear()
      expect(cache.get('/data/c')).not.toBeNull()
      expect(cache.getList('/data/c')).not.toBeNull()
    })

    it('removes the exact path when recursive=false', () => {
      cache.update('/data/e', entry('e'))
      cache.updateList('/data/e', entry('e'))
      cache.clear('/data/e', false)
      expect(cache.get('/data/e')).toBeNull()
      expect(cache.getList('/data/e')).toBeNull()
    })

    it('removes the exact path when recursive=true', () => {
      cache.update('/data/d', entry('d'))
      cache.updateList('/data/d', entry('d'))
      cache.clear('/data/d', true)
      expect(cache.get('/data/d')).toBeNull()
      expect(cache.getList('/data/d')).toBeNull()
    })

    it('does not remove a path that merely starts with the same prefix (recursive=true)', () => {
      // '/data/F__' should NOT be cleared when clearing '/data/F'
      cache.update('/data/F__', entry('F__'))
      cache.updateList('/data/F__', entry('F__'))
      cache.clear('/data/F', true)
      expect(cache.get('/data/F__')).not.toBeNull()
      expect(cache.getList('/data/F__')).not.toBeNull()
    })

    it('does not remove a path that merely starts with the same prefix (recursive=false)', () => {
      cache.update('/data/G__', entry('G__'))
      cache.updateList('/data/G__', entry('G__'))
      cache.clear('/data/G', false)
      expect(cache.get('/data/G__')).not.toBeNull()
      expect(cache.getList('/data/G__')).not.toBeNull()
    })

    it('removes children when recursive=true', () => {
      cache.update('/data', entry('data'))
      cache.update('/data/child', entry('child'))
      cache.clear('/data', true)
      expect(cache.get('/data')).toBeNull()
      expect(cache.get('/data/child')).toBeNull()
    })
  })
})
