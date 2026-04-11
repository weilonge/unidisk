/**
 * TeraBox FUSE integration test — Vitest wrapper.
 *
 * Skipped automatically when TERABOX_NDUS is not set so CI stays green.
 * To run against a real account:
 *
 *   TERABOX_NDUS=<token> npx vitest run test/terabox-integration.test.ts
 *
 * Or run the runner directly (useful during development):
 *
 *   npx tsx test/terabox-integration-runner.ts --ndus <token>
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

const NDUS = process.env.TERABOX_NDUS

describe('FUSE integration — TeraBox provider (subprocess)', () => {
  it.skipIf(!NDUS)('mounts, exercises filesystem ops, and unmounts cleanly', () => {
    const result = spawnSync(
      'npx',
      ['tsx', path.resolve(__dirname, 'terabox-integration-runner.ts'), '--ndus', NDUS!],
      {
        cwd:      path.resolve(__dirname, '..'),
        timeout:  60_000,
        encoding: 'utf-8',
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    expect(result.status, 'TeraBox FUSE runner exited with non-zero status').toBe(0)
  }, 65_000)
})
