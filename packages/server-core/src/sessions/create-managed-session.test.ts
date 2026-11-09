import { describe, expect, it } from 'bun:test'
import { buildAgentSessionConfig, createManagedSession, getIndependentSessionIsolationViolations, selectSessionRecoveryMessages } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })

  it('preserves explicit memory snapshots and legacy absence on restore', () => {
    const isolated = createManagedSession({
      id: 'session_isolated',
      sharedProjectMemoryEnabled: false,
    }, workspace as any)
    const legacy = createManagedSession({ id: 'session_legacy_memory' }, workspace as any)

    expect(isolated.sharedProjectMemoryEnabled).toBe(false)
    expect(legacy.sharedProjectMemoryEnabled).toBeUndefined()
  })

  it('keeps a fresh independent session free of another session SDK and recovery context', () => {
    const sessionA = createManagedSession({
      id: 'session_a',
      sdkSessionId: 'sdk-session-a',
      branchFromMessageId: 'message-a',
      branchFromSdkSessionId: 'sdk-parent-a',
      branchFromSessionPath: '/tmp/session-a',
      branchFromSdkCwd: '/tmp/sdk-a',
      branchFromSdkTurnId: 'turn-a',
      transferredSessionSummary: 'CANARY_FROM_SESSION_A',
    }, workspace as any, {
      messages: [{
        id: 'message-a',
        role: 'user',
        content: 'CANARY_FROM_SESSION_A',
        timestamp: 1,
      } as any],
    })

    const sessionB = createManagedSession({ id: 'session_b' }, workspace as any)
    const configB = buildAgentSessionConfig(sessionB)

    expect(buildAgentSessionConfig(sessionA).sdkSessionId).toBe('sdk-session-a')
    expect(selectSessionRecoveryMessages(sessionA.messages)[0]?.content).toBe('CANARY_FROM_SESSION_A')
    expect(configB.sdkSessionId).toBeUndefined()
    expect(configB.branchFromMessageId).toBeUndefined()
    expect(configB.branchFromSdkSessionId).toBeUndefined()
    expect(configB.branchFromSessionPath).toBeUndefined()
    expect(configB.branchFromSdkCwd).toBeUndefined()
    expect(configB.branchFromSdkTurnId).toBeUndefined()
    expect(sessionB.transferredSessionSummary).toBeUndefined()
    expect(sessionB.messages).toEqual([])
    expect(selectSessionRecoveryMessages(sessionB.messages)).toEqual([])
  })

  it('detects every forbidden context source before an independent session is registered', () => {
    const clean = {
      id: 'session-clean',
      workspaceRootPath: '/tmp/test-workspace',
      createdAt: 1,
      lastUsedAt: 1,
      messages: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    } as any
    expect(getIndependentSessionIsolationViolations(clean)).toEqual([])

    expect(getIndependentSessionIsolationViolations({
      ...clean,
      sdkSessionId: 'sdk-a',
      branchFromMessageId: 'message-a',
      branchFromSdkSessionId: 'sdk-parent-a',
      branchFromSessionPath: '/session-a',
      branchFromSdkCwd: '/sdk-a',
      branchFromSdkTurnId: 'turn-a',
      transferredSessionSummary: 'CANARY_FROM_SESSION_A',
      transferredSessionSummaryApplied: true,
      messages: [{ id: 'message-a', type: 'user', content: 'CANARY_FROM_SESSION_A', timestamp: 1 }],
    })).toEqual([
      'sdkSessionId',
      'branchFromMessageId',
      'branchFromSdkSessionId',
      'branchFromSessionPath',
      'branchFromSdkCwd',
      'branchFromSdkTurnId',
      'transferredSessionSummary',
      'transferredSessionSummaryApplied',
      'messages',
    ])
  })
})
