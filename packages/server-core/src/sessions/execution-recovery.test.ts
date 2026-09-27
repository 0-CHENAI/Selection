import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SessionManager, createManagedSession } from './SessionManager'
import { writeExecutionCheckpoint, readExecutionCheckpoint, sdkStateHash } from '../reliability/execution-checkpoint'
import { getSessionPath } from '@craft-agent/shared/sessions'

test('runtime checkpoints retain coordinator identity, compaction position and the persisted SDK anchor', async () => {
  const root = mkdtempSync(`${tmpdir()}/selection-checkpoint-link-`)
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'linked', sdkSessionId: 'sdk', permissionMode: 'safe',
      taskSlug: 'task', taskRunId: 'run', taskNodeId: 'node' }, { id: 'w', name: 'w', rootPath: root } as never, { messagesLoaded: true })
    managed.messages = [{ id: 'u', role: 'user', content: 'task', timestamp: 1 },
      { id: 'compacted', role: 'info', content: 'Compacted', statusType: 'compaction_complete', timestamp: 2 },
      { id: 'a', role: 'assistant', content: 'working', timestamp: 3 }]
    const sessionPath = getSessionPath(root, managed.id)
    mkdirSync(`${sessionPath}/.pi-sessions`, { recursive: true })
    writeFileSync(`${sessionPath}/.pi-sessions/test_sdk.jsonl`, '{"type":"session","id":"sdk"}\n{"type":"message","id":"sdk-a","parentId":null,"message":{"role":"assistant"}}\n')
    managed.executionCheckpoint = { version: 1, sessionId: managed.id, userMessageId: 'u', generation: 0,
      taskIdentity: { taskSlug: 'task', taskRunId: 'run', taskNodeId: 'node' }, status: 'running',
      pendingTools: { read: { name: 'Read', recovery: 'read-only' } }, completedTools: ['done'], updatedAt: 1 }
    managed.piSdkMessageToCraftMessage = new Map([['sdk-message', 'a']])
    ;(manager as any).sessions.set(managed.id, managed)
    await (manager as any).processEvent(managed, { type: 'pi_turn_anchor', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-a' })
    ;(manager as any).checkpointExecution(managed)
    const saved = readExecutionCheckpoint(sessionPath)
    expect(saved.kind).toBe('ok')
    if (saved.kind !== 'ok') throw new Error('checkpoint missing')
    expect(saved.checkpoint).toMatchObject({ taskIdentity: { taskSlug: 'task', taskRunId: 'run', taskNodeId: 'node' },
      sdkTurnAnchor: 'sdk-a', compactionMessageId: 'compacted', waitingFor: 'tool', completedTools: ['done'] })
    managed.pendingAuthRequestId = 'auth'
    ;(manager as any).checkpointExecution(managed)
    expect(managed.executionCheckpoint.waitingFor).toBe('user')
    let dispatched = false
    manager.sendMessage = async () => { dispatched = true }
    managed.taskRunId = 'other-run'
    await expect(manager.resumeExecution(managed.id)).rejects.toThrow('turn-changed')
    expect(dispatched).toBe(false)
    expect(readExecutionCheckpoint(sessionPath).kind).toBe('ok')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('recovery is claimed durably once before dispatch and retains task identity', async () => {
  const root = mkdtempSync(`${tmpdir()}/selection-recovery-`)
  try {
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'recover', sdkSessionId: 'sdk', permissionMode: 'safe' }, { id: 'w', name: 'w', rootPath: root } as never, { messagesLoaded: true })
    managed.messages = [{ id: 'u', role: 'user', content: 'original', timestamp: 1 }]
    const sdkDirectory = `${getSessionPath(root, managed.id)}/.pi-sessions`
    mkdirSync(sdkDirectory, { recursive: true })
    writeFileSync(`${sdkDirectory}/test_sdk.jsonl`, '{"type":"session","id":"sdk"}\n')
    managed.executionCheckpoint = { version: 1, sessionId: managed.id, userMessageId: 'u', generation: 0, sdkSessionId: 'sdk', sdkStateHash: sdkStateHash(getSessionPath(root, managed.id), 'sdk'), transcriptTailId: 'u', status: 'running', pendingTools: {}, completedTools: ['done'], updatedAt: 1 }
    ;(manager as any).sessions.set(managed.id, managed)
    writeExecutionCheckpoint(getSessionPath(root, managed.id), managed.executionCheckpoint)
    let dispatches = 0
    let release!: () => void
    manager.sendMessage = async () => {
      dispatches++
      const disk = readExecutionCheckpoint(getSessionPath(root, managed.id))
      expect(disk.kind === 'ok' && disk.checkpoint.status).toBe('claimed')
      await new Promise<void>(resolve => { release = resolve })
    }
    // Even matching transcript and SDK bytes cannot authorize an obsolete execution epoch.
    managed.processingGeneration = 1
    await expect(manager.resumeExecution(managed.id)).rejects.toThrow('turn-changed')
    expect(dispatches).toBe(0)
    managed.processingGeneration = 0
    const pending = manager.resumeExecution(managed.id)
    await Promise.resolve(); await Promise.resolve()
    await expect(manager.resumeExecution(managed.id)).rejects.toThrow()
    release(); await pending
    expect(dispatches).toBe(1)
    await expect(manager.resumeExecution(managed.id)).rejects.toThrow()
    expect(dispatches).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('live execution ownership blocks another manager and process before accepting or claiming work', async () => {
  const root = mkdtempSync(`${tmpdir()}/selection-execution-owner-`)
  const sessionId = 'owned'
  const first = new SessionManager(), second = new SessionManager()
  const workspace = { id: 'w', name: 'w', rootPath: root }
  const active = createManagedSession({ id: sessionId }, workspace as never, { messagesLoaded: true })
  const standby = createManagedSession({ id: sessionId }, workspace as never, { messagesLoaded: true })
  active.isProcessing = true; standby.isProcessing = true
  ;(first as any).sessions.set(sessionId, active)
  ;(second as any).sessions.set(sessionId, standby)
  const flush = first.flushSession.bind(first)
  let unlock!: () => void, ready!: () => void
  const reachedFlush = new Promise<void>(resolve => { ready = resolve })
  const pendingFlush = new Promise<void>(resolve => { unlock = resolve })
  first.flushSession = async id => { ready(); await pendingFlush; await flush(id) }
  let accepted = false
  const running = first.sendMessage(sessionId, 'original', undefined, undefined, undefined, undefined, undefined, () => { accepted = true })
  try {
    await reachedFlush
    expect(accepted).toBe(false)
    await expect(second.sendMessage(sessionId, 'other')).rejects.toThrow('another application instance')
    expect(standby.messages).toHaveLength(0)
    expect(standby.messageQueue).toHaveLength(0)
    standby.isProcessing = false
    const checkpoint = { version: 1 as const, sessionId, userMessageId: 'original', generation: 0, status: 'running' as const, pendingTools: {}, completedTools: [], updatedAt: 1 }
    standby.executionCheckpoint = checkpoint
    writeExecutionCheckpoint(getSessionPath(root, sessionId), checkpoint)
    await expect(second.resumeExecution(sessionId)).rejects.toThrow('another application instance')
    expect(readExecutionCheckpoint(getSessionPath(root, sessionId))).toEqual({ kind: 'ok', checkpoint: { ...checkpoint, reason: undefined } })
    expect(standby.runtimeRecovery).toMatchObject({ phase: 'blocked', reason: 'execution-active-elsewhere', canResume: true })
    const ownerPath = `${getSessionPath(root, sessionId)}/data/execution-owner`
    const script = `import { acquireProjectLock } from ${JSON.stringify(new URL('../reliability/project-lock.ts', import.meta.url).pathname)};
      try { acquireProjectLock(${JSON.stringify(ownerPath)}); process.exit(1) } catch { process.exit(0) }`
    const processCheck = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
    expect(await processCheck.exited).toBe(0)
    unlock(); await running
    expect(accepted).toBe(true)
    standby.isProcessing = true
    await second.sendMessage(sessionId, 'after release')
    expect(standby.messageQueue).toHaveLength(1)
  } finally { unlock(); await running.catch(() => {}); rmSync(root, { recursive: true, force: true }) }
})

test('failed acceptance releases execution ownership without granting a recovery claim', async () => {
  const root = mkdtempSync(`${tmpdir()}/selection-owner-failure-`)
  try {
    const workspace = { id: 'w', name: 'w', rootPath: root }
    const first = new SessionManager(), second = new SessionManager()
    for (const manager of [first, second]) {
      const managed = createManagedSession({ id: 's' }, workspace as never, { messagesLoaded: true })
      managed.isProcessing = true
      ;(manager as any).sessions.set('s', managed)
    }
    first.flushSession = async () => { throw new Error('disk failed') }
    await expect(first.sendMessage('s', 'not accepted')).rejects.toThrow('disk failed')
    await second.sendMessage('s', 'retry')
    expect((second as any).sessions.get('s').messageQueue).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('startup reclaims a crashed recovery owner once without repeating tools or changing the user task', async () => {
  const root = mkdtempSync(`${tmpdir()}/selection-crashed-claim-`)
  try {
    const sessionId = 'crashed-claim'
    const sessionPath = getSessionPath(root, sessionId)
    const sdkDirectory = `${sessionPath}/.pi-sessions`
    mkdirSync(sdkDirectory, { recursive: true })
    writeFileSync(`${sdkDirectory}/test_sdk.jsonl`, '{"type":"session","id":"sdk"}\n')
    const checkpoint = { version: 1 as const, sessionId, userMessageId: 'original', generation: 3,
      sdkSessionId: 'sdk', sdkStateHash: sdkStateHash(sessionPath, 'sdk'), transcriptTailId: 'original',
      status: 'running' as const, pendingTools: {}, completedTools: ['completed-tool'], updatedAt: 1 }
    writeExecutionCheckpoint(sessionPath, checkpoint)
    const script = `import { acquireProjectLock } from ${JSON.stringify(new URL('../reliability/project-lock.ts', import.meta.url).pathname)};
      import { claimExecutionCheckpoint } from ${JSON.stringify(new URL('../reliability/execution-checkpoint.ts', import.meta.url).pathname)};
      acquireProjectLock(${JSON.stringify(`${sessionPath}/data/execution-owner`)});
      claimExecutionCheckpoint(${JSON.stringify(sessionPath)}, ${JSON.stringify(checkpoint)});
      process.kill(process.pid, 'SIGKILL');`
    const crashed = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
    expect(await crashed.exited).not.toBe(0)
    const saved = readExecutionCheckpoint(sessionPath)
    expect(saved.kind === 'ok' && saved.checkpoint.status).toBe('claimed')
    const manager = new SessionManager()
    const managed = createManagedSession({ id: sessionId, sdkSessionId: 'sdk', permissionMode: 'safe' },
      { id: 'w', name: 'w', rootPath: root } as never, { messagesLoaded: true })
    managed.messages = [{ id: 'original', role: 'user', content: 'original task', timestamp: 1 }]
    ;(manager as any).sessions.set(sessionId, managed)
    let dispatched!: () => void, dispatches = 0
    const dispatch = new Promise<void>(resolve => { dispatched = resolve })
    manager.sendMessage = async (_sessionId, _message, _attachments, _stored, options) => {
      dispatches++
      expect(options?.hidden).toBe(true)
      expect(managed.processingGeneration).toBe(3)
      expect(managed.executionCheckpoint?.userMessageId).toBe('original')
      expect(managed.executionCheckpoint?.completedTools).toEqual(['completed-tool'])
      expect(readExecutionCheckpoint(sessionPath).kind).toBe('ok')
      dispatched()
    }
    ;(manager as any).restoreExecutionCheckpoint(managed)
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([dispatch, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Startup recovery did not dispatch')), 2000) })])
    } finally { clearTimeout(timeout) }
    // Allow the scheduled recovery's finally to release its local claim.
    await Promise.resolve(); await Promise.resolve()
    expect(dispatches).toBe(1)
    expect(managed.messages).toHaveLength(1)
    await expect(manager.resumeExecution(sessionId)).rejects.toThrow()
    expect(dispatches).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const scenario of ['success', 'checkpoint-crash', 'cancelled', 'file-changed', 'save-failed', 'save-unconfirmed']) test(`native write recovery persists SDK pairs and UI results before continuation (${scenario})`, async () => {
  const crashAfterRows = scenario === 'checkpoint-crash'
  const { SessionManager: PiSessions } = await import('@earendil-works/pi-coding-agent')
  const { restoreToolResults } = await import('../../../pi-agent-server/src/tool-file-operations')
  const { writeFileWithReceipt } = await import('../../../shared/src/agent/backend/pi/file-operation-receipts')
  const { sdkStateSnapshot } = await import('../reliability/execution-checkpoint')
  const { loadSession } = await import('@craft-agent/shared/sessions')
  const root = mkdtempSync(`${tmpdir()}/selection-native-recovery-`)
  try {
    const workspace = { id: 'w', name: 'w', rootPath: root }
    const sessionId = 'native-recovery', sessionPath = getSessionPath(root, sessionId)
    const pi = PiSessions.create(root, `${sessionPath}/.pi-sessions`)
    pi.appendMessage({ role: 'user', content: 'write file', timestamp: 1 })
    pi.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write', arguments: { path: 'result.txt', content: 'done' } }],
      api: 'openai-responses', provider: 'openai', model: 'fixture', stopReason: 'toolUse', timestamp: 2,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
    const sdk = sdkStateSnapshot(sessionPath, pi.getSessionId())!
    const checkpoint = { version: 1 as const, sessionId, userMessageId: 'u', generation: 0, answerRunId: 'run',
      sdkSessionId: pi.getSessionId(), sdkStateHash: sdk.hash, sdkStateSize: sdk.size, transcriptTailId: 'u', status: 'running' as const,
      pendingTools: { write: { name: 'Write', recovery: 'file-verifiable' as const } }, completedTools: [], updatedAt: 1 }
    await writeFileWithReceipt(sessionPath, { sessionId, sdkSessionId: pi.getSessionId(), answerRunId: 'run', toolCallId: 'write', toolName: 'Write' }, `${root}/result.txt`, 'done')
    writeExecutionCheckpoint(sessionPath, checkpoint)
    const manager = new SessionManager()
    const managed = createManagedSession({ id: sessionId, sdkSessionId: pi.getSessionId(), permissionMode: 'safe' }, workspace as never, { messagesLoaded: true })
    managed.messages = [{ id: 'u', role: 'user', content: 'write file', timestamp: 1 }]
    managed.executionCheckpoint = checkpoint
    ;(manager as any).sessions.set(sessionId, managed)
    ;(manager as any).persistSession(managed); await manager.flushSession(sessionId)
    ;(manager as any).getOrCreateAgent = async () => ({ prepareExecutionRecovery: async () => {
      restoreToolResults(PiSessions.open(pi.getSessionFile()!), sessionPath, managed.toolResultRecovery!)
      if (scenario === 'cancelled') managed.stopRequested = true
      if (scenario === 'file-changed') writeFileSync(`${root}/result.txt`, 'external edit')
    } })
    let continuations = 0, publications = 0
    manager.setEventSink((_channel, _target, event: any) => {
      if (event.type !== 'tool_result') return
      publications++
      expect(loadSession(root, sessionId)?.messages.find(message => message.toolUseId === 'write')?.toolStatus).toBe('completed')
    })
    manager.sendMessage = async () => {
      continuations++
      expect(PiSessions.open(pi.getSessionFile()!).buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(1)
      expect(loadSession(root, sessionId)?.messages.filter(message => message.toolUseId === 'write')).toHaveLength(1)
      expect(managed.executionCheckpoint?.pendingTools).toEqual({})
      expect(managed.executionCheckpoint?.completedTools).toEqual(['write'])
    }
    if (scenario === 'cancelled' || scenario === 'file-changed' || scenario === 'save-failed' || scenario === 'save-unconfirmed') {
      if (scenario === 'save-failed') {
        ;(manager as any).persistSession = () => {}
        manager.flushSession = async () => { throw new Error('recovery disk failure') }
      }
      if (scenario === 'save-unconfirmed') {
        ;(manager as any).persistSession = () => {}
        manager.flushSession = async () => {}
      }
      const expected = scenario === 'cancelled' ? 'interrupted' : scenario === 'file-changed' ? 'changed before recovery publication' : scenario === 'save-unconfirmed' ? 'could not be persisted' : 'recovery disk failure'
      await expect(manager.resumeExecution(sessionId)).rejects.toThrow(expected)
      expect(continuations).toBe(0); expect(publications).toBe(0)
      expect(managed.messages.filter(message => message.toolUseId === 'write')).toHaveLength(0)
      expect(readExecutionCheckpoint(sessionPath).kind).toBe('ok')
      expect(managed.toolResultRecovery).toBeUndefined()
      if (scenario !== 'cancelled') expect(managed.runtimeRecovery).toMatchObject({ phase: 'blocked', reason: 'recovery-failed', canResume: false })
      return
    }
    if (crashAfterRows) {
      const checkpointExecution = (manager as any).checkpointExecution
      ;(manager as any).checkpointExecution = () => { throw new Error('crash before checkpoint publication') }
      await expect(manager.resumeExecution(sessionId)).rejects.toThrow('crash before checkpoint publication')
      expect(continuations).toBe(0); expect(publications).toBe(0)
      // New process reads already-saved rows, the original claimed checkpoint,
      // and the appended SDK result. It must neither replay nor duplicate them.
      const next = new SessionManager()
      const recovered = createManagedSession({ id: sessionId, sdkSessionId: pi.getSessionId(), permissionMode: 'safe' }, workspace as never, { messagesLoaded: true })
      const { storedToMessage } = await import('@craft-agent/core/types')
      recovered.messages = loadSession(root, sessionId)!.messages.map(storedToMessage)
      const disk = readExecutionCheckpoint(sessionPath)
      expect(disk.kind).toBe('ok')
      if (disk.kind !== 'ok') throw new Error('missing checkpoint')
      recovered.executionCheckpoint = disk.checkpoint
      ;(next as any).sessions.set(sessionId, recovered)
      ;(next as any).startupRecoveryClaims.add(sessionId)
      ;(next as any).getOrCreateAgent = async () => ({ prepareExecutionRecovery: async () => restoreToolResults(PiSessions.open(pi.getSessionFile()!), sessionPath, recovered.toolResultRecovery!) })
      next.sendMessage = async () => {
        continuations++
        expect(recovered.messages.filter(message => message.toolUseId === 'write')).toHaveLength(1)
        expect(recovered.executionCheckpoint?.pendingTools).toEqual({})
      }
      await next.resumeExecution(sessionId)
      ;(manager as any).checkpointExecution = checkpointExecution
    } else await manager.resumeExecution(sessionId)
    expect(continuations).toBe(1)
    expect(PiSessions.open(pi.getSessionFile()!).buildSessionContext().messages.filter(message => message.role === 'toolResult')).toHaveLength(1)
    expect(loadSession(root, sessionId)?.messages.filter(message => message.toolUseId === 'write')).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
