import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession, saveSession } from '../storage.ts'

describe('independent Craft Session isolation', () => {
  it('never copies SDK, branch, transfer, or message state into a fresh sibling session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-independent-sessions-'))
    const sharedWorkingDirectory = join(workspaceRoot, 'project')

    try {
      const createdA = await createSession(workspaceRoot, {
        workingDirectory: sharedWorkingDirectory,
        sharedProjectMemoryEnabled: false,
      })
      const sessionA = loadSession(workspaceRoot, createdA.id)!
      sessionA.sdkSessionId = 'sdk-session-a'
      sessionA.branchFromMessageId = 'message-a'
      sessionA.branchFromSdkSessionId = 'sdk-parent-a'
      sessionA.branchFromSessionPath = '/sessions/parent-a'
      sessionA.branchFromSdkCwd = '/sdk/parent-a'
      sessionA.branchFromSdkTurnId = 'turn-a'
      sessionA.transferredSessionSummary = 'CANARY_FROM_SESSION_A'
      sessionA.messages = [{
        id: 'message-a',
        type: 'user',
        content: 'CANARY_FROM_SESSION_A',
        timestamp: 1,
      }]
      await saveSession(sessionA)

      const createdB = await createSession(workspaceRoot, {
        workingDirectory: sharedWorkingDirectory,
        sharedProjectMemoryEnabled: false,
      })
      const sessionB = loadSession(workspaceRoot, createdB.id)!

      // Sharing a repository cwd must not imply sharing provider history.
      expect(sessionB.sdkCwd).toBe(sessionA.sdkCwd)
      expect(sessionB.id).not.toBe(sessionA.id)
      expect(sessionB.sdkSessionId).toBeUndefined()
      expect(sessionB.branchFromMessageId).toBeUndefined()
      expect(sessionB.branchFromSdkSessionId).toBeUndefined()
      expect(sessionB.branchFromSessionPath).toBeUndefined()
      expect(sessionB.branchFromSdkCwd).toBeUndefined()
      expect(sessionB.branchFromSdkTurnId).toBeUndefined()
      expect(sessionB.transferredSessionSummary).toBeUndefined()
      expect(sessionB.transferredSessionSummaryApplied).toBeUndefined()
      expect(sessionB.messages).toEqual([])
      expect(JSON.stringify(sessionB)).not.toContain('CANARY_FROM_SESSION_A')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
