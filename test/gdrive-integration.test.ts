/**
 * Google Drive FUSE integration test — Vitest wrapper.
 *
 * Skipped automatically when GDRIVE_TOKEN is not set so CI stays green.
 * To run against a real account:
 *
 *   GDRIVE_TOKEN=<token> npx vitest run test/gdrive-integration.test.ts
 *
 * Or run the runner directly:
 *
 *   npx tsx test/gdrive-integration-runner.ts --token <token>
 *
 * Obtain a token via https://developers.google.com/oauthplayground
 * (select Drive API v3 → https://www.googleapis.com/auth/drive).
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

const TOKEN = process.env.GDRIVE_TOKEN

describe('FUSE integration — GoogleDrive provider (subprocess)', () => {
  it.skipIf(!TOKEN)('mounts, exercises filesystem ops, and unmounts cleanly', () => {
    const result = spawnSync(
      'npx',
      ['tsx', path.resolve(__dirname, 'gdrive-integration-runner.ts'), '--token', TOKEN!],
      {
        cwd:      path.resolve(__dirname, '..'),
        timeout:  60_000,
        encoding: 'utf-8',
        env:      { ...process.env as Record<string, string> },
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    expect(result.status, 'GoogleDrive FUSE runner exited with non-zero status').toBe(0)
  }, 65_000)
})
