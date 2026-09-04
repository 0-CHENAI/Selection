import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSharedProjectMemoryEnabled, SESSION_PERSISTENT_FIELDS } from '../types.ts'
import { pickSessionFields } from '../utils.ts'
import { createSession, loadSession } from '../storage.ts'

describe('session persistence: shared project memory', () => {
  it('persists an explicit creation snapshot', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('sharedProjectMemoryEnabled')

    const picked = pickSessionFields({
      id: 's1',
      workspaceRootPath: '/tmp/ws',
      createdAt: 1,
      lastUsedAt: 2,
      sharedProjectMemoryEnabled: false,
    })

    expect(picked.sharedProjectMemoryEnabled).toBe(false)
  })

  it('isolates every session, including an explicit stored true', () => {
    expect(isSharedProjectMemoryEnabled(undefined)).toBe(false)
    expect(isSharedProjectMemoryEnabled({})).toBe(false)
    expect(isSharedProjectMemoryEnabled({ sharedProjectMemoryEnabled: true })).toBe(false)
    expect(isSharedProjectMemoryEnabled({ sharedProjectMemoryEnabled: false })).toBe(false)
  })

  it('writes a privacy-safe default and preserves explicit shared snapshots', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-memory-session-'))
    try {
      const isolated = await createSession(workspaceRoot)
      const shared = await createSession(workspaceRoot, { sharedProjectMemoryEnabled: true })

      expect(loadSession(workspaceRoot, isolated.id)?.sharedProjectMemoryEnabled).toBe(false)
      expect(loadSession(workspaceRoot, shared.id)?.sharedProjectMemoryEnabled).toBe(true)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
