/**
 * TeraBox integration test runner — executed as a standalone Node.js process.
 *
 * Usage:
 *   npx tsx test/terabox-integration-runner.ts --ndus <token>
 *   TERABOX_NDUS=<token> npx tsx test/terabox-integration-runner.ts
 *
 * The runner exits 0 (skip) when no credential is supplied so CI stays green.
 * It exits 1 on any assertion failure or unexpected error.
 *
 * Because real TeraBox account contents are unknown, the tests are adaptive:
 *   - Root listing must succeed and return something (or be empty — both valid).
 *   - If at least one file is found, we download its first 128 bytes.
 *   - If at least one subdirectory is found, we list it too.
 * No specific paths are hard-coded.
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import Fuse from 'fuse-native'
import { UdManager } from '../src/helper/udManager'
import { TeraBox } from '../src/clouddrive/TeraBox'
import { buildHandlers } from '../src/udFuse'

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

function resolveNdus(): string | null {
  // --ndus <value>
  const flagIdx = process.argv.indexOf('--ndus')
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return process.argv[flagIdx + 1]
  }
  // TERABOX_NDUS env var
  if (process.env.TERABOX_NDUS) {
    return process.env.TERABOX_NDUS
  }
  return null
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

async function runTests(mountPoint: string): Promise<void> {
  console.log('\nTeraBox FUSE Integration Tests')
  console.log('===============================')

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

  // --- Adaptive: stat & read first file found in root ---
  const firstFile = rootEntries.find(e => !e.startsWith('.'))
  if (firstFile) {
    const filePath = path.join(mountPoint, firstFile)

    let isFile = false
    let isDir  = false
    const stResult = await assertNoThrow(async () => {
      const st = await fs.stat(filePath)
      isFile = st.isFile()
      isDir  = st.isDirectory()
      return st
    }, `stat("${firstFile}") succeeds`)

    if (stResult !== undefined) {
      assert(isFile || isDir, `"${firstFile}" is a file or directory`)
    }

    if (isFile) {
      console.log(`\nreadFile("${firstFile}", first 128 bytes)`)
      await assertNoThrow(async () => {
        const fd = await fs.open(filePath, 'r')
        try {
          const buf = Buffer.alloc(128)
          const { bytesRead } = await fd.read(buf, 0, 128, 0)
          assert(bytesRead >= 0, `read returned ${bytesRead} bytes (>= 0)`)
        } finally {
          await fd.close()
        }
      }, `partial read of "${firstFile}" succeeds`)
    }

    // --- Adaptive: list first subdirectory ---
    if (isDir) {
      console.log(`\nreaddir("${firstFile}")`)
      await assertNoThrow(async () => {
        const subEntries = await fs.readdir(filePath)
        console.log(`  (found ${subEntries.length} entries in "${firstFile}")`)
        assert(Array.isArray(subEntries), `listing of "${firstFile}" returns an array`)
      }, `readdir("${firstFile}") succeeds`)
    }
  } else {
    console.log('\n  (account root is empty — skipping file/dir tests)')
  }

  // --- ENOENT for a path that cannot exist ---
  console.log('\nErrno behaviour')
  try {
    await fs.readFile(path.join(mountPoint, '__terabox_integration_nonexistent_file_xyz__.txt'))
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
  const ndus = resolveNdus()
  if (!ndus) {
    console.log('TeraBox integration test skipped — no --ndus token provided.')
    console.log('Supply one via: --ndus <token>  or  TERABOX_NDUS=<token>')
    process.exit(0)
  }

  const MOUNT_POINT = path.join(os.tmpdir(), 'ud-terabox-fuse-test-mnt')

  const provider = new TeraBox()
  provider.init({ ndus, cacheStore: 'memory' })

  const udm = new UdManager()
  udm.init({
    provider,
    profile: { ndus, cacheStore: 'memory' },
    blockSize: 1024 * 1024,
    blockWritingSize: 8 * 1024 * 1024,
    fuseIoSize: 65536,
    queueConcurrency: 3,
    prefetchBlocks: 2,
    maxDataCacheEntries: 20,
  })

  const handlers = buildHandlers(udm, false)

  await fs.mkdir(MOUNT_POINT, { recursive: true })
  console.log(`Mounting TeraBox at ${MOUNT_POINT} …`)

  const fuse = await mount(MOUNT_POINT, handlers)
  // Give the kernel a moment to settle the mount
  await new Promise(r => setTimeout(r, 500))

  try {
    await runTests(MOUNT_POINT)
  } finally {
    console.log('\nUnmounting …')
    await unmount(fuse)
  }

  console.log('\n===============================')
  console.log(`Results: ${passed} passed, ${failed} failed`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
