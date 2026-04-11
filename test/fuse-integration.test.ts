/**
 * FUSE Integration Test — Sample Provider
 *
 * fuse-native calls back into V8 from a FUSE worker thread, which is
 * incompatible with Vitest's worker-thread isolate locking. We therefore
 * run the actual FUSE test in a separate Node.js process (the runner) and
 * assert on its exit code here.
 *
 * To run the runner directly:
 *   npx tsx test/fuse-integration-runner.ts
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

describe('FUSE integration — Sample provider (subprocess)', () => {
  it('mounts, exercises filesystem ops, and unmounts cleanly', () => {
    const result = spawnSync(
      'npx',
      ['tsx', path.resolve(__dirname, 'fuse-integration-runner.ts')],
      {
        cwd: path.resolve(__dirname, '..'),
        timeout: 30_000,
        encoding: 'utf-8',
      }
    )

    // Print runner output so failures are visible in the Vitest report
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    expect(result.status, 'FUSE runner exited with non-zero status').toBe(0)
  }, 35_000)
})
