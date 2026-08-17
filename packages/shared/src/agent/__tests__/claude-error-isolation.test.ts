import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeAgent } from '../claude-agent.ts'
import { runErrorDiagnostics } from '../diagnostics.ts'
import { getLastApiError, setStoredError, toolMetadataStore } from '../../interceptor-common.ts'
import { getSessionPath } from '../../sessions/storage.ts'

describe('Claude session-scoped error isolation', () => {
  let workspaceRoot: string
  let sessionDirA: string
  let sessionDirB: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'claude-error-isolation-'))
    sessionDirA = getSessionPath(workspaceRoot, 'session-a')
    sessionDirB = getSessionPath(workspaceRoot, 'session-b')
    mkdirSync(sessionDirA, { recursive: true })
    mkdirSync(sessionDirB, { recursive: true })
  })

  afterEach(() => {
    toolMetadataStore._clearForTesting()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('does not fall back to another active session when its own error file is absent', () => {
    toolMetadataStore.setSessionDir(sessionDirA)
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'SESSION_A_ERROR_CANARY',
      timestamp: Date.now(),
    })

    const agent = Object.create(ClaudeAgent.prototype) as any
    agent.config = {
      workspace: { rootPath: workspaceRoot },
      session: { id: 'session-b' },
    }

    expect(agent.getCapturedApiErrorForSession()).toBeNull()
    expect(getLastApiError(sessionDirA)?.message).toBe('SESSION_A_ERROR_CANARY')
  })

  it('runs diagnostics against only the failing session interceptor state', async () => {
    toolMetadataStore.setSessionDir(sessionDirA)
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'SESSION_A_ERROR_CANARY',
      timestamp: Date.now(),
    })
    toolMetadataStore.setSessionDir(sessionDirB)
    setStoredError({
      status: 429,
      statusText: 'Too Many Requests',
      message: 'SESSION_B_RATE_LIMIT',
      timestamp: Date.now(),
    })
    // Simulate another chat clobbering the singleton fallback before B diagnoses.
    toolMetadataStore.setSessionDir(sessionDirA)

    const result = await runErrorDiagnostics({
      rawError: 'process exited with code 1',
      providerType: 'pi',
      sessionDir: sessionDirB,
    })

    expect(result.code).toBe('rate_limited')
    expect(result.details.join('\n')).toContain('SESSION_B_RATE_LIMIT')
    expect(result.details.join('\n')).not.toContain('SESSION_A_ERROR_CANARY')
    expect(getLastApiError(sessionDirA)?.message).toBe('SESSION_A_ERROR_CANARY')
  })
})
