import { expect, test } from 'bun:test'
import { SessionManager, createManagedSession, buildAgentSessionConfig } from './SessionManager'
import { runPreToolUseChecks, type PreToolUseInput } from '@craft-agent/shared/agent/core/pre-tool-use'
import { getSessionToolProxyDefs } from '@craft-agent/shared/agent/backend/pi/session-tool-defs'
import { buildPiExecutionScope } from '@craft-agent/shared/agent/pi-agent'

test('provider projection preserves node identity even when legacy orchestration role is absent', () => {
  const workspace = { id: 'ws', slug: 'ws', name: 'Workspace', rootPath: '/tmp/selection-mode-test', createdAt: 0 }
  const managed = createManagedSession({ id: 'child', workMode: 'PRO', parentSessionId: 'root', taskSlug: 'plan',
    taskRunId: 'run', taskNodeId: 'review', taskAttempt: 2, taskRevision: 3, taskActor: { id: 'reviewer' }, taskWorkerId: 'worker' }, workspace)
  const session = buildAgentSessionConfig(managed)
  expect(session).toMatchObject({ parentSessionId: 'root', taskSlug: 'plan', taskRunId: 'run', taskNodeId: 'review',
    taskAttempt: 2, taskRevision: 3, taskActor: { id: 'reviewer' }, taskWorkerId: 'worker' })
  expect(buildPiExecutionScope(session, session.id)).toContain('role: worker')
  expect(getSessionToolProxyDefs({ executionSession: session }).map(tool => tool.name)).not.toContain('mcp__session__create_task')
})

test('NORM rejects automatic/explicit spawn, direct DAG runs and native delegation before effects', async () => {
  const manager = new SessionManager()
  const workspace = { id: 'ws', slug: 'ws', name: 'Workspace', rootPath: '/tmp/selection-mode-test', createdAt: 0 }
  const managed = createManagedSession({ id: 'norm', workMode: 'NORM', permissionMode: 'allow-all', swarmEnabled: true }, workspace, { messagesLoaded: true })
  const internal = manager as unknown as { sessions: Map<string, typeof managed>; spawnSessionFromTool: (session: typeof managed, request: unknown) => Promise<unknown>; prepareSpawnQualificationCredentials: (session: typeof managed, explicit: boolean) => void; spawnQualificationCredentials: Map<string, unknown> }
  internal.sessions.set(managed.id, managed)
  for (const spawnReason of ['automatic', 'user-requested']) await expect(internal.spawnSessionFromTool(managed, { name: 'worker', prompt: 'Read assigned data', spawnReason })).rejects.toThrow('NORM')
  internal.prepareSpawnQualificationCredentials(managed, true)
  expect(internal.spawnQualificationCredentials.has(managed.id)).toBe(false)
  expect(() => manager.assertTaskRunAllowed(workspace.id, managed.id)).toThrow('NORM')
  expect(internal.sessions.size).toBe(1)
  const session = buildAgentSessionConfig(managed)
  expect(session.workMode).toBe('NORM')
  expect(session.permissionMode).toBe('allow-all')
  for (const toolName of ['Task', 'Agent', 'spawn_session', 'run_task', 'mcp__session__run_task']) {
    const result = runPreToolUseChecks({ toolName, executionSession: session } as unknown as PreToolUseInput)
    expect(result).toMatchObject({ type: 'block' })
    if (result.type === 'block') expect(result.reason).toContain('NORM')
  }
  manager.cleanup()
})

test('started sessions cannot change mode, permissions or actor ownership', async () => {
  const manager = new SessionManager()
  const workspace = { id: 'ws', slug: 'ws', name: 'Workspace', rootPath: '/tmp/selection-mode-test', createdAt: 0 }
  const managed = createManagedSession({ id: 'started', workMode: 'NORM', permissionMode: 'safe' }, workspace,
    { messagesLoaded: true, messages: [{ id: 'u', role: 'user', content: 'work', timestamp: 1 }] })
  ;(manager as unknown as { sessions: Map<string, typeof managed> }).sessions.set(managed.id, managed)
  await expect(manager.setSessionWorkMode(managed.id, 'PRO')).rejects.toThrow('fixed')
  expect(managed.workMode).toBe('NORM')
  expect(managed.permissionMode).toBe('safe')
  manager.cleanup()
})

test('cold startup persists migration twice without losing history or elevating permissions', async () => {
  const { mkdtempSync, mkdirSync, rmSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, dirname } = await import('node:path')
  const { spyOn } = await import('bun:test')
  const config = await import('@craft-agent/shared/config')
  const { getSessionFilePath, writeSessionJsonl, loadSession } = await import('@craft-agent/shared/sessions')
  const root = mkdtempSync(join(tmpdir(), 'selection-mode-migration-'))
  const workspace = { id: 'migration', slug: 'migration', name: 'Migration', rootPath: root, createdAt: 1 }
  const samples = [
    { id: 'explicit', workMode: 'PRO' as const }, { id: 'task', taskSlug: 'costs' },
    { id: 'swarm' }, { id: 'worker', parentSessionId: 'swarm', orchestrationRootSessionId: 'swarm', orchestrationId: 'active', orchestrationRole: 'worker' as const },
    { id: 'toggle', swarmEnabled: true }, { id: 'plain' },
    { id: 'orphan', parentSessionId: 'missing', orchestrationRootSessionId: 'missing', orchestrationStatus: 'running' as const, orchestrationId: 'orphaned' },
    { id: 'contradiction', workMode: 'NORM' as const, taskSlug: 'active' },
  ]
  const lookup = spyOn(config, 'getWorkspaces').mockReturnValue([workspace])
  const headers: string[] = []
  try {
    for (const sample of samples) {
      const file = getSessionFilePath(root, sample.id); mkdirSync(dirname(file), { recursive: true })
      writeSessionJsonl(file, { ...sample, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1,
        permissionMode: 'safe', tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }, messages: [{ id: `${sample.id}-user`, type: 'user', content: 'Saved history', timestamp: 1 }] })
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const manager = new SessionManager()
      ;(manager as unknown as { loadSessionsFromDisk: () => void }).loadSessionsFromDisk()
      await manager.flushAllSessions()
      for (const sample of samples) {
        const saved = loadSession(root, sample.id)!
        expect(saved.permissionMode).toBe('safe')
        expect(saved.messages.map(message => message.id)).toEqual([`${sample.id}-user`])
        expect(saved.parentSessionId).toBe('parentSessionId' in sample ? sample.parentSessionId : undefined)
        expect(saved.workMode).toBe(['explicit', 'task', 'swarm', 'worker'].includes(sample.id) ? 'PRO' : 'NORM')
        if (sample.id === 'orphan' || sample.id === 'contradiction') expect(saved.workModeNeedsReview).toBe(true)
      }
      const snapshot = samples.map(sample => readFileSync(getSessionFilePath(root, sample.id), 'utf8').split('\n')[0]).join('\n')
      if (attempt === 0) headers.push(snapshot)
      else expect(snapshot).toBe(headers[0])
      manager.cleanup()
    }
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('interrupted inline feedback restores its directory and blocks automatic replay', async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, dirname } = await import('node:path')
  const { spyOn } = await import('bun:test')
  const config = await import('@craft-agent/shared/config')
  const { getSessionFilePath, writeSessionJsonl, loadSession } = await import('@craft-agent/shared/sessions')
  const { writeExecutionCheckpoint, readExecutionCheckpoint } = await import('../reliability/execution-checkpoint')
  const root = mkdtempSync(join(tmpdir(), 'selection-feedback-recovery-'))
  const workspace = { id: 'feedback-recovery', slug: 'feedback-recovery', name: 'Recovery', rootPath: root, createdAt: 1 }
  const lookup = spyOn(config, 'getWorkspaces').mockReturnValue([workspace])
  const manager = new SessionManager()
  try {
    for (const id of ['valid', 'invalid']) {
      const file = getSessionFilePath(root, id), data = join(dirname(file), 'data')
      mkdirSync(data, { recursive: true })
      writeSessionJsonl(file, { id, workspaceRootPath: root, workMode: 'NORM', workingDirectory: join(root, 'candidate'), createdAt: 1, lastUsedAt: 1, permissionMode: 'safe',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }, messages: [{ id: `${id}-user`, type: 'user', content: 'Saved history', timestamp: 1 }] })
      writeExecutionCheckpoint(dirname(file), { version: 1, sessionId: id, userMessageId: `${id}-user`, generation: 1, status: 'running', pendingTools: {}, completedTools: [], updatedAt: Date.now() })
      writeFileSync(join(data, 'isolated-workspace.json'), JSON.stringify({ version: 1, directory: join(root, 'candidate'), sourceRoot: root }))
      writeFileSync(join(data, 'feedback-origin.json'), JSON.stringify({ version: 1, workingDirectory: root, ...(id === 'invalid' ? { isolatedWorkspace: { version: 999 } } : {}) }))
    }
    const internal = manager as unknown as { loadSessionsFromDisk: () => void; sessions: Map<string, ReturnType<typeof createManagedSession>> }
    internal.loadSessionsFromDisk()
    await manager.flushAllSessions()
    // Origin removal happens only after the restored header is durable.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(readExecutionCheckpoint(dirname(getSessionFilePath(root, 'valid')))).toMatchObject({ kind: 'ok', checkpoint: { status: 'blocked', reason: 'feedback-interrupted' } })
    expect(loadSession(root, 'valid')?.workingDirectory).toBe(root)
    expect(internal.sessions.get('valid')?.isolatedWorkspace).toBeUndefined()
    expect(loadSession(root, 'invalid')?.workingDirectory).toBe(join(root, 'candidate'))
    for (const id of ['valid', 'invalid']) {
      expect(internal.sessions.get(id)?.runtimeRecovery).toMatchObject({ phase: 'blocked', canResume: false })
      expect(loadSession(root, id)?.messages.map(message => message.id)).toEqual([`${id}-user`])
      expect(loadSession(root, id)?.permissionMode).toBe('safe')
      expect(existsSync(join(dirname(getSessionFilePath(root, id)), 'data', 'feedback-origin.json'))).toBe(id === 'invalid')
    }
    const next = new SessionManager()
    ;(next as unknown as { loadSessionsFromDisk: () => void }).loadSessionsFromDisk()
    expect((next as unknown as { sessions: Map<string, ReturnType<typeof createManagedSession>> }).sessions.get('valid')?.runtimeRecovery).toMatchObject({ phase: 'blocked', canResume: false })
    next.cleanup()
  } finally { manager.cleanup(); lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
