/**
 * pCloud FUSE integration test — Vitest wrapper.
 *
 * Skipped automatically when PCLOUD_TOKEN is not set so CI stays green.
 * To run against a real account:
 *
 *   PCLOUD_TOKEN=<token> npx vitest run test/pcloud-integration.test.ts
 *
 * EU-region accounts:
 *   PCLOUD_TOKEN=<token> PCLOUD_HOST=eapi.pcloud.com npx vitest run test/pcloud-integration.test.ts
 *
 * Or run the runner directly:
 *
 *   npx tsx test/pcloud-integration-runner.ts --token <token>
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

const TOKEN = process.env.PCLOUD_TOKEN

describe('FUSE integration — pCloud provider (subprocess)', () => {
  it.skipIf(!TOKEN)('mounts, exercises filesystem ops, and unmounts cleanly', () => {
    const env: Record<string, string> = { ...process.env as Record<string, string> }
    if (process.env.PCLOUD_HOST) env['PCLOUD_HOST'] = process.env.PCLOUD_HOST

    const result = spawnSync(
      'npx',
      ['tsx', path.resolve(__dirname, 'pcloud-integration-runner.ts'), '--token', TOKEN!],
      {
        cwd:      path.resolve(__dirname, '..'),
        timeout:  60_000,
        encoding: 'utf-8',
        env,
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    expect(result.status, 'pCloud FUSE runner exited with non-zero status').toBe(0)
  }, 65_000)
})
