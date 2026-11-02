import { expect, test } from 'bun:test'
import { createManagedSession, SessionManager } from './SessionManager'

function fixture() {
  const manager = new SessionManager(), internal = manager as any
  const managed = createManagedSession({ id: 'long-task-review' }, { id: 'workspace', name: 'Workspace', rootPath: '/tmp/long-task-review' } as never, { messagesLoaded: true })
  managed.isProcessing = true
  managed.messages = [{ id: 't', role: 'tool', content: '', timestamp: 1, toolName: 'Bash', toolUseId: 'call', toolStatus: 'completed', toolResult: '' }]
  internal.sessions.set(managed.id, managed)
  internal.persistSession = () => {}
  const events: any[] = []
  manager.setEventSink((_channel, _target, event) => events.push(event))
  const finish = (result: string, isError = false, content?: unknown) => internal.processEvent(managed, { type: 'tool_result', toolUseId: 'call', toolName: 'Bash', result, isError, content })
  return { manager, internal, managed, events, finish }
}

test('authoritative late result replaces a synthetic completion in both host and renderer', async () => {
  const f = fixture()
  await f.finish('actual stdout')
  expect(f.events.filter(e => e.type === 'tool_result')).toHaveLength(1)
  expect(f.managed.messages[0]!.toolResult).toBe('actual stdout')
  await f.finish('actual stdout')
  expect(f.events.filter(e => e.type === 'tool_result')).toHaveLength(1)
  await f.finish('actual stdout', true)
  expect(f.events.filter(e => e.type === 'tool_result')).toHaveLength(2)
  expect(f.events.at(-1).isError).toBe(true)
})

test('a final image update with unchanged text is not swallowed by duplicate suppression', async () => {
  const f = fixture()
  f.managed.messages[0]!.toolResult = 'preview'
  await f.finish('preview', false, [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }])
  expect(f.events.filter(e => e.type === 'tool_result')).toHaveLength(1)
  expect(f.events.at(-1).content[0].type).toBe('image')
  await f.finish('preview', false)
  expect(f.events.filter(e => e.type === 'tool_result')).toHaveLength(2)
  expect(f.events.at(-1).content).toBeUndefined()
  expect(f.managed.messages[0]!.toolResultContent).toBeUndefined()
})

test('a timed-out tool followed by its result and complete blocks recovery and drains the old runtime', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { getSessionPath } = await import('@craft-agent/shared/sessions')
  const { readExecutionCheckpoint } = await import('../reliability/execution-checkpoint')
  const root = mkdtempSync(join(tmpdir(), 'tool-timeout-flow-'))
  const manager = new SessionManager(), internal = manager as any
  const managed = createManagedSession({ id: 'timeout' }, { id: 'w', name: 'W', rootPath: root } as never, { messagesLoaded: true })
  internal.sessions.set(managed.id, managed)
  const events: any[] = []
  manager.setEventSink((_channel, _target, event) => events.push(event))
  let calls = 0, drained = 0
  const agent = {
    destroy() {}, dispose() {}, getModel: () => 'local', getSessionId: () => 'sdk-timeout', setAllSources() {}, configureAnswerDelivery() {},
    async disposeForRestart() { drained++; expect(managed.isProcessing).toBe(true) },
    async *chat() {
      calls++
      yield { type: 'tool_start' as const, toolName: 'Bash', toolUseId: 'uncertain', input: {} }
      yield { type: 'error' as const, code: 'tool_wait_timeout' as const, message: '工具回包超时' }
      yield { type: 'tool_result' as const, toolName: 'Bash', toolUseId: 'uncertain', result: 'Outcome unknown', isError: true, executionOutcome: 'unknown' as const }
      yield { type: 'complete' as const }
    },
  }
  internal.getOrCreateAgent = async () => { managed.agent = agent as never; return agent }
  try {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'w', name: 'W', slug: 'w' }))
    await manager.sendMessage(managed.id, 'run one operation')
    expect(calls).toBe(1)
    expect(drained).toBe(1)
    expect(managed.isProcessing).toBe(false)
    expect(managed.agent).toBeNull()
    const record = readExecutionCheckpoint(getSessionPath(root, managed.id))
    expect(record.kind).toBe('ok')
    if (record.kind !== 'ok') throw new Error('checkpoint missing')
    expect(record.checkpoint).toMatchObject({ status: 'blocked', reason: 'timeout' })
    expect(record.checkpoint.pendingTools.uncertain).toBeDefined()
    expect(events.some(e => e.type === 'error')).toBe(true)
  } finally { await manager.flushSession(managed.id); manager.cleanup(); rmSync(root, { recursive: true, force: true }) }
})

test('an old PPT export cannot publish into a new processing generation', async () => {
  const { spyOn } = await import('bun:test')
  const ppt = await import('../services/ppt-live')
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const exporting = spyOn(ppt, 'exportIncrementalPptx').mockImplementation(() => gate.then(() => undefined))
  const checks = spyOn(ppt, 'ensurePptChecks').mockResolvedValue(undefined as never)
  const read = spyOn(ppt, 'readPptProgress').mockReturnValue({ total: 2, completed: 1, generating: true })
  try {
    const old = f.internal.syncPptProgress(f.managed, true)
    await Promise.resolve()
    expect(exporting).toHaveBeenCalledTimes(1)
    f.managed.processingGeneration++
    release(); await old
    expect(f.events.filter(e => e.type === 'session_metadata_changed')).toHaveLength(0)
    const current = f.internal.syncPptProgress(f.managed, true)
    await current
    expect(f.events.filter(e => e.type === 'session_metadata_changed')).toHaveLength(1)
  } finally { release(); exporting.mockRestore(); checks.mockRestore(); read.mockRestore() }
})
