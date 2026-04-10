/**
 * FUSE integration test runner — executed as a standalone Node.js process.
 * Vitest spawns this via child_process and checks the exit code.
 *
 * Runs independently of Vitest's worker threads to avoid the V8 locking
 * conflict that fuse-native triggers inside worker isolates.
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import Fuse from 'fuse-native'
import { UdManager } from '../src/helper/udManager'
import { Sample } from '../src/clouddrive/Sample'

const MOUNT_POINT = path.join(os.tmpdir(), 'ud-fuse-test-mnt')

const SAMPLE_FS = {
  'hello.txt': 'Hello World!\n',
  'goodbye.txt': 'Goodbye\n',
  dir1: {
    'welcome.txt': 'Welcome to UniDisk\n',
    dir2: {
      'nested.txt': 'Nested content\n',
    },
  },
}

// ---------------------------------------------------------------------------
// Minimal assertion helper
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.error(`  ✗ ${message}`)
    failed++
  }
}

async function assertEqual<T>(actual: T, expected: T, message: string): Promise<void> {
  if (actual === expected) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.error(`  ✗ ${message}`)
    console.error(`    expected: ${JSON.stringify(expected)}`)
    console.error(`    actual:   ${JSON.stringify(actual)}`)
    failed++
  }
}

// ---------------------------------------------------------------------------
// FUSE handlers (same as integration test)
// ---------------------------------------------------------------------------

function buildHandlers(udm: UdManager): ConstructorParameters<typeof Fuse>[1] {
  const ENOENT = Fuse.ENOENT
  const EPERM  = Fuse.EPERM
  const EISDIR = Fuse.EISDIR
  const EIO    = Fuse.EIO

  function toFlag(flags: number): 'r' | 'w' | 'r+' {
    const f = flags & 3
    if (f === 0) return 'r'
    if (f === 1) return 'w'
    return 'r+'
  }

  return {
    // fuse-native getattr: cb(err, stat)
    getattr(filePath: string, cb: (code: number, stat?: object) => void) {
      udm.getFileMeta(filePath).then(meta => {
        if (!meta) return cb(ENOENT)
        if (meta.isdir === 1) {
          cb(0, {
            size: 4096, mode: 0o40770, nlink: 1,
            mtime: new Date(meta.mtime), atime: new Date(meta.mtime), ctime: new Date(meta.ctime),
            uid: process.getuid!(), gid: process.getgid!(),
          })
        } else {
          cb(0, {
            size: meta.size, mode: 0o100660, nlink: 1,
            mtime: new Date(meta.mtime), atime: new Date(meta.mtime), ctime: new Date(meta.ctime),
            uid: process.getuid!(), gid: process.getgid!(),
          })
        }
      }).catch(() => cb(ENOENT))
    },

    // fuse-native readdir: cb(err, names)
    readdir(filePath: string, cb: (code: number, names?: string[]) => void) {
      udm.getFileList(filePath).then(list => {
        const names = list.map(e => path.basename(e.path))
        cb(0, names)
      }).catch(() => cb(ENOENT))
    },

    // fuse-native open: cb(err, fd)
    open(filePath: string, flags: number, cb: (code: number, fd?: number) => void) {
      const flag = toFlag(flags)
      udm.getFileMeta(filePath).then(async meta => {
        if (!meta) { cb(ENOENT); return }
        if (meta.isdir === 1) { cb(EISDIR); return }
        const fd = await udm.openFile(filePath, flag)
        cb(0, fd)
      }).catch(() => cb(EPERM))
    },

    // fuse-native read: cb(bytesRead) — first arg is the FUSE return value (bytes read or -errno)
    // NOT cb(err, bytesRead): that would pass res=0 (EOF) to the kernel regardless of len
    read(filePath: string, _fd: number, buf: Buffer, len: number, offset: number, cb: (bytesRead: number) => void) {
      udm.downloadFileInRangeByCache(filePath, buf, offset, len)
        .then(() => cb(len))
        .catch(() => cb(EIO))
    },

    // fuse-native release: cb(err)
    release(filePath: string, fd: number, cb: (code: number) => void) {
      udm.closeFile(filePath, fd).then(() => cb(0)).catch(() => cb(EPERM))
    },
    // No init handler: fuse-native calls signal(0) itself when ops.init is absent,
    // which passes a numeric 0 to fuse_native_signal_init (NAPI requires int32, not null/undefined).
  }
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

function mount(mountPoint: string, handlers: ConstructorParameters<typeof Fuse>[1]): Promise<Fuse> {
  return new Promise((resolve, reject) => {
    const fuse = new Fuse(mountPoint, handlers, { force: true, debug: false })
    fuse.mount((err: Error | null) => err ? reject(err) : resolve(fuse))
  })
}

function unmount(fuse: Fuse): Promise<void> {
  return new Promise((resolve, reject) => {
    fuse.unmount((err: Error | null) => err ? reject(err) : resolve())
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests(mountPoint: string): Promise<void> {
  console.log('\nFUSE Integration Tests — Sample Provider')
  console.log('=========================================')

  // --- readdir ---
  console.log('\nreaddir()')
  const root = await fs.readdir(mountPoint)
  assert(root.includes('hello.txt'),   'root contains hello.txt')
  assert(root.includes('goodbye.txt'), 'root contains goodbye.txt')
  assert(root.includes('dir1'),        'root contains dir1')

  const dir1 = await fs.readdir(path.join(mountPoint, 'dir1'))
  assert(dir1.includes('welcome.txt'), 'dir1 contains welcome.txt')
  assert(dir1.includes('dir2'),        'dir1 contains dir2')

  const dir2 = await fs.readdir(path.join(mountPoint, 'dir1', 'dir2'))
  assert(dir2.includes('nested.txt'),  'dir1/dir2 contains nested.txt')

  // --- readFile ---
  console.log('\nreadFile()')
  const hello = await fs.readFile(path.join(mountPoint, 'hello.txt'), 'utf-8')
  await assertEqual(hello, SAMPLE_FS['hello.txt'], 'reads root file content correctly')

  const welcome = await fs.readFile(path.join(mountPoint, 'dir1', 'welcome.txt'), 'utf-8')
  await assertEqual(welcome, SAMPLE_FS.dir1['welcome.txt'], 'reads subdir file content correctly')

  const nested = await fs.readFile(path.join(mountPoint, 'dir1', 'dir2', 'nested.txt'), 'utf-8')
  await assertEqual(nested, SAMPLE_FS.dir1.dir2['nested.txt'], 'reads deeply nested file content correctly')

  // --- stat ---
  console.log('\nstat()')
  const fileStat = await fs.stat(path.join(mountPoint, 'hello.txt'))
  assert(fileStat.isFile(),            'hello.txt is a file')
  await assertEqual(fileStat.size, SAMPLE_FS['hello.txt'].length, 'hello.txt has correct size')

  const dirStat = await fs.stat(path.join(mountPoint, 'dir1'))
  assert(dirStat.isDirectory(),        'dir1 is a directory')

  // --- ENOENT ---
  console.log('\nErrno behaviour')
  try {
    await fs.readFile(path.join(mountPoint, 'does-not-exist.txt'))
    assert(false, 'missing file should throw')
  } catch (err: unknown) {
    assert((err as NodeJS.ErrnoException).code === 'ENOENT', 'missing file returns ENOENT')
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const provider = new Sample()
  ;(provider as unknown as { _testData: typeof SAMPLE_FS })._testData =
    JSON.parse(JSON.stringify(SAMPLE_FS))
  ;(provider as unknown as { _writePendingData: Record<number, null> })._writePendingData = {}
  provider.init = () => {}

  const udm = new UdManager()
  udm.init({
    provider,
    profile: { cacheStore: 'memory' },
    blockSize: 1024 * 1024,
    blockWritingSize: 8 * 1024 * 1024,
    fuseIoSize: 65536,
    queueConcurrency: 3,
    prefetchBlocks: 2,
    maxDataCacheEntries: 20,
  })

  await fs.mkdir(MOUNT_POINT, { recursive: true })
  const fuse = await mount(MOUNT_POINT, buildHandlers(udm))
  await new Promise(r => setTimeout(r, 300))

  try {
    await runTests(MOUNT_POINT)
  } finally {
    await unmount(fuse)
  }

  console.log(`\n=========================================`)
  console.log(`Results: ${passed} passed, ${failed} failed`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
