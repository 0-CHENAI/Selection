import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionPath as getSessionStoragePath } from '@craft-agent/shared/sessions'
import { readExecutionCheckpoint, writeExecutionCheckpoint, type ExecutionCheckpoint } from '../reliability/execution-checkpoint'
import { SessionManager } from './SessionManager'

test('a pre-fix branch discards only the checkpoint inherited from its parent', () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-inherited-checkpoint-'))
  try {
    const manager = new SessionManager()
    const branch = { id: 'branch', branchFromMessageId: 'parent-answer', workspace: { rootPath: root } }
    const path = getSessionStoragePath(root, branch.id)
    const checkpoint: ExecutionCheckpoint = { version: 1, sessionId: 'parent', userMessageId: 'parent-user',
      generation: 4, status: 'completed', pendingTools: {}, completedTools: [], updatedAt: Date.now() }
    writeExecutionCheckpoint(path, checkpoint)
    ;(manager as any).discardInheritedBranchCheckpoint(branch)
    expect(readExecutionCheckpoint(path).kind).toBe('missing')

    writeExecutionCheckpoint(path, { ...checkpoint, sessionId: branch.id, userMessageId: 'branch-user' })
    ;(manager as any).discardInheritedBranchCheckpoint(branch)
    expect(readExecutionCheckpoint(path)).toMatchObject({ kind: 'ok', checkpoint: { sessionId: branch.id } })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
