/**
 * Dropbox integration test runner — executed as a standalone Node.js process.
 *
 * Usage:
 *   npx tsx test/dropbox-integration-runner.ts --token <token>
 *   DROPBOX_TOKEN=<token> npx tsx test/dropbox-integration-runner.ts
 *
 * The runner exits 0 (skip) when no credential is supplied so CI stays green.
 * It exits 1 on any assertion failure or unexpected error.
 *
 * Setup / teardown:
 *   A uniquely-named test folder is created in the Dropbox root before the
 *   FUSE mount and deleted after unmount, regardless of test outcome.  No
 *   other account data is modified.
 *
 * Because real Dropbox account contents are unknown, file tests are adaptive:
 *   - Root listing must succeed (empty is fine).
 *   - If at least one file is found, we download its first 128 bytes.
 *   - If at least one subdirectory is found, we list it.
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import Fuse from 'fuse-native'
import { UdManager } from '../src/helper/udManager'
import { Dropbox } from '../src/clouddrive/Dropbox'
import { buildHandlers } from '../src/udFuse'

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

function resolveToken(): string | null {
  const flagIdx = process.argv.indexOf('--token')
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return process.argv[flagIdx + 1]
  }
  return process.env.DROPBOX_TOKEN ?? null
}

// ---------------------------------------------------------------------------
// Minimal assertion helpers
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

async function assertNoThrow(fn: () => Promise<unknown>, message: string): Promise<unknown> {
  try {
    const result = await fn()
    console.log(`  ✓ ${message}`)
    passed++
    return result
  } catch (err) {
    console.error(`  ✗ ${message}`)
    console.error(`    error: ${(err as Error).message}`)
    failed++
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Mount / unmount helpers
// ---------------------------------------------------------------------------

function mount(mountPoint: string, handlers: ConstructorParameters<typeof Fuse>[1]): Promise<Fuse> {
  return new Promise((resolve, reject) => {
    const fuse = new Fuse(mountPoint, handlers, { force: true, debug: false })
    fuse.mount((err: Error | null) => (err ? reject(err) : resolve(fuse)))
  })
}

function unmount(fuse: Fuse): Promise<void> {
  return new Promise((resolve, reject) => {
    fuse.unmount((err: Error | null) => (err ? reject(err) : resolve()))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests(mountPoint: string, testFolderName: string): Promise<void> {
  console.log('\nDropbox FUSE Integration Tests')
  console.log('================================')

  // --- Root listing ---
  console.log('\nreaddir(/)')
  let rootEntries: string[] = []
  const readdirResult = await assertNoThrow(async () => {
    rootEntries = await fs.readdir(mountPoint)
    return rootEntries
  }, 'root listing succeeds')

  if (readdirResult !== undefined) {
    assert(Array.isArray(rootEntries), 'root listing returns an array')
    console.log(`  (found ${rootEntries.length} entries: ${rootEntries.slice(0, 5).join(', ')}${rootEntries.length > 5 ? '…' : ''})`)
  }

  // --- stat root ---
  console.log('\nstat(/)')
  await assertNoThrow(async () => {
    const st = await fs.stat(mountPoint)
    assert(st.isDirectory(), 'mount point is a directory')
  }, 'stat on mount root succeeds')

  // --- Test folder: visible in listing, stat, readdir ---
  console.log(`\ntest folder ("${testFolderName}")`)
  assert(
    rootEntries.includes(testFolderName),
    'test folder appears in root listing'
  )

  const testFolderPath = path.join(mountPoint, testFolderName)
  await assertNoThrow(async () => {
    const st = await fs.stat(testFolderPath)
    assert(st.isDirectory(), 'test folder is reported as a directory')
  }, 'stat on test folder succeeds')

  await assertNoThrow(async () => {
    const entries = await fs.readdir(testFolderPath)
    assert(entries.length === 0, 'test folder is empty')
  }, 'readdir on test folder succeeds')

  // --- Adaptive: stat & read first non-hidden entry in root ---
  const firstEntry = rootEntries.find(e => !e.startsWith('.') && e !== testFolderName)
  if (firstEntry) {
    const entryPath = path.join(mountPoint, firstEntry)

    let isFile = false
    let isDir  = false
    const stResult = await assertNoThrow(async () => {
      const st = await fs.stat(entryPath)
      isFile = st.isFile()
      isDir  = st.isDirectory()
      return st
    }, `stat("${firstEntry}") succeeds`)

    if (stResult !== undefined) {
      assert(isFile || isDir, `"${firstEntry}" is a file or directory`)
    }

    if (isFile) {
      console.log(`\nreadFile("${firstEntry}", first 128 bytes)`)
      await assertNoThrow(async () => {
        const fd = await fs.open(entryPath, 'r')
        try {
          const buf = Buffer.alloc(128)
          const { bytesRead } = await fd.read(buf, 0, 128, 0)
          assert(bytesRead >= 0, `read returned ${bytesRead} bytes (>= 0)`)
        } finally {
          await fd.close()
        }
      }, `partial read of "${firstEntry}" succeeds`)
    }

    if (isDir) {
      console.log(`\nreaddir("${firstEntry}")`)
      await assertNoThrow(async () => {
        const subEntries = await fs.readdir(entryPath)
        console.log(`  (found ${subEntries.length} entries in "${firstEntry}")`)
        assert(Array.isArray(subEntries), `listing of "${firstEntry}" returns an array`)
      }, `readdir("${firstEntry}") succeeds`)
    }
  } else {
    console.log('\n  (no other entries in root — skipping adaptive file/dir tests)')
  }

  // --- ENOENT for a path that cannot exist ---
  console.log('\nErrno behaviour')
  try {
    await fs.readFile(path.join(mountPoint, '__dropbox_integration_nonexistent_file_xyz__.txt'))
    assert(false, 'reading a non-existent file should throw')
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    assert(code === 'ENOENT', `non-existent file returns ENOENT (got ${code})`)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const token = resolveToken()
  if (!token) {
    console.log('Dropbox integration test skipped — no --token provided.')
    console.log('Supply one via: --token <token>  or  DROPBOX_TOKEN=<token>')
    process.exit(0)
  }

  const MOUNT_POINT      = path.join(os.tmpdir(), 'ud-dropbox-fuse-test-mnt')
  const TEST_FOLDER      = `/__ud_test_${Date.now()}`
  const TEST_FOLDER_NAME = path.basename(TEST_FOLDER)

  const provider = new Dropbox()
  provider.init({ token, cacheStore: 'memory' })

  const udm = new UdManager()
  udm.init({
    provider,
    profile:             { token, cacheStore: 'memory' },
    blockSize:           4 * 1024 * 1024,
    blockWritingSize:    8 * 1024 * 1024,
    fuseIoSize:          65536,
    queueConcurrency:    2,
    prefetchBlocks:      3,
    maxDataCacheEntries: 20,
  })

  // Create the test folder before mounting so we have something deterministic
  // to assert on (verifies createFolder + that it shows up in the listing).
  console.log(`Creating test folder ${TEST_FOLDER} …`)
  await udm.createFolder(TEST_FOLDER)

  await fs.mkdir(MOUNT_POINT, { recursive: true })
  console.log(`Mounting Dropbox at ${MOUNT_POINT} …`)

  const fuse = await mount(MOUNT_POINT, buildHandlers(udm, false))
  await new Promise(r => setTimeout(r, 500))  // let the kernel settle

  try {
    await runTests(MOUNT_POINT, TEST_FOLDER_NAME)
  } finally {
    console.log('\nUnmounting …')
    await unmount(fuse)

    // Always clean up, even when tests failed.
    console.log(`Deleting test folder ${TEST_FOLDER} …`)
    try {
      await udm.deleteFolder(TEST_FOLDER)
      console.log('  ✓ test folder deleted')
    } catch (err) {
      console.error(`  ✗ cleanup failed: ${(err as Error).message}`)
    }
  }

  console.log('\n================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
