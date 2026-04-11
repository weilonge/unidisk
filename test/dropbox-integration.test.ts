/**
 * Dropbox FUSE integration test — Vitest wrapper.
 *
 * Skipped automatically when DROPBOX_TOKEN is not set so CI stays green.
 * To run against a real account:
 *
 *   DROPBOX_TOKEN=<token> npx vitest run test/dropbox-integration.test.ts
 *
 * Or run the runner directly (useful during development):
 *
 *   npx tsx test/dropbox-integration-runner.ts --token <token>
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

const TOKEN = process.env.DROPBOX_TOKEN

describe('FUSE integration — Dropbox provider (subprocess)', () => {
  it.skipIf(!TOKEN)('mounts, exercises filesystem ops, and unmounts cleanly', () => {
    const result = spawnSync(
      'npx',
      ['tsx', path.resolve(__dirname, 'dropbox-integration-runner.ts'), '--token', TOKEN!],
      {
        cwd:      path.resolve(__dirname, '..'),
        timeout:  60_000,
        encoding: 'utf-8',
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    expect(result.status, 'Dropbox FUSE runner exited with non-zero status').toBe(0)
  }, 65_000)
})
