import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('search settings over the Electron RPC transport', () => {
  it('persists reorder and keys through the real client and reports stale servers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-search-rpc-'))
    try {
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null }))
      const result = Bun.spawnSync(['bun', join(import.meta.dir, 'search-settings-rpc.isolated.ts')], {
        env: { ...process.env, CRAFT_CONFIG_DIR: dir },
        stdout: 'pipe', stderr: 'pipe',
      })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString())
      expect(result.exitCode).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 30000)
})
