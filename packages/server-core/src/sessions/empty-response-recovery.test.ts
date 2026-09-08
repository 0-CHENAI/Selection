import { getSessionPath } from '@craft-agent/shared/sessions'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type Managed = ReturnType<typeof createManagedSession>

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

describe('empty response recovery (#182)', () => {
  let rootPath: string
  let manager: SessionManager
  let managed: Managed
  let events: any[]

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), 'selection-empty-response-'))
    manager = new SessionManager()
    managed = createManagedSession(
      { id: 'empty-response', name: 'Existing session' },
      { id: 'workspace', name: 'Workspace', rootPath, createdAt: Date.now() } as never,
      { messagesLoaded: true },
    )
    ;(manager as any).sessions.set(managed.id, managed)
    ;(manager as any).persistSession = () => {}
    ;(manager as any).flushSession = async () => {}
    events = []
    manager.setEventSink((_channel, _target, event) => events.push(event))
  })

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('surfaces a classified error without replaying the user prompt', async () => {
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        return (async function* () {
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => agent

    await manager.sendMessage(managed.id, '继续')

    expect(managed.messages.at(-1)).toMatchObject({
      role: 'error',
      errorCode: 'no_response',
      errorCanRetry: false,
      errorActions: [],
    })
    expect(events.find(event => event.type === 'typed_error')).toMatchObject({
      error: { code: 'no_response', canRetry: false },
    })
    expect(managed.isProcessing).toBe(false)
  })

  it('treats a whitespace-only assistant message as no response', async () => {
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        return (async function* () {
          yield { type: 'text_complete' as const, text: '   ' }
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => agent

    await manager.sendMessage(managed.id, '继续')

    expect(managed.messages.some(message =>
      message.role === 'assistant' && message.content === '   '
    )).toBe(true)
    expect(managed.messages.at(-1)).toMatchObject({
      role: 'error',
      errorCode: 'no_response',
      errorCanRetry: false,
    })
  })

  it('does not report an empty response while a managed Swarm waits for workers', async () => {
    managed.orchestrationId = 'swarm-1'
    managed.orchestrationStatus = 'running'
    managed.orchestrationAggregation = {
      orchestrationId: 'swarm-1',
      finalAggregation: 'Synthesize the worker results.',
      phase: 'waiting-workers',
      repairAttempts: 0,
    }
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        return (async function* () {
          yield {
            type: 'text_complete' as const,
            text: 'Workers started.',
            isIntermediate: false,
          }
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => agent

    await manager.sendMessage(managed.id, '并行调研')

    expect(managed.messages.some(message =>
      message.role === 'assistant'
      && message.content === 'Workers started.'
      && message.isIntermediate === true
    )).toBe(true)
    expect(managed.messages.some(message => message.role === 'error')).toBe(false)
    expect(events.some(event => event.type === 'typed_error')).toBe(false)
    expect(events.find(event => event.type === 'complete')).toMatchObject({
      orchestrationPending: true,
    })
  })

  it.each([false, true])('keeps tool results and prevents replay after tools (providerError=%s)', async providerError => {
    let calls = 0
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        calls++
        return (async function* () {
          yield { type: 'tool_start', toolUseId: 'write-1', toolName: 'Write', input: { path: '/tmp/result.txt', content: 'result' } }
          yield { type: 'tool_result', toolUseId: 'write-1', toolName: 'Write', result: 'File written', isError: false }
          if (providerError) yield { type: 'typed_error', error: { code: 'service_error', title: 'Service error', message: 'Unavailable', canRetry: true, actions: [{ key: 'r', label: 'Retry', action: 'retry' }] } }
          yield { type: 'complete' }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => agent
    await manager.sendMessage(managed.id, 'Write the result')
    expect(calls).toBe(1)
    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.messages.find(message => message.toolUseId === 'write-1')?.toolResult).toBe('File written')
    expect(managed.messages.at(-1)).toMatchObject({ errorCode: providerError ? 'service_error' : 'tool_only_response', errorCanRetry: false, errorActions: [] })
  })

  it.each([
    ['Pi subprocess exited unexpectedly (code 1)', 'agent_process_exited'],
    ['Response stream closed unexpectedly', 'stream_interrupted'],
    ['Maximum context length exceeded', 'context_limit'],
  ])('preserves terminal classification for %s', async (message, code) => {
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() { return (async function* () {
        yield { type: 'error', message }
        yield { type: 'complete' }
      })() },
    }
    ;(manager as any).getOrCreateAgent = async () => agent
    await manager.sendMessage(managed.id, 'Continue')
    expect(managed.messages.filter(message => message.role === 'error')).toHaveLength(1)
    expect(managed.messages.at(-1)?.errorCode).toBe(code)
  })

  it.each([true, false])('does not let cached HTTP errors override current diagnostics (stale=%s)', async stale => {
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() { return (async function* () {
        const path = getSessionPath(rootPath, managed.id)
        mkdirSync(path, { recursive: true })
        writeFileSync(join(path, 'api-error.json'), JSON.stringify({ status: 400, message: 'old request', timestamp: stale ? Date.now() - 60000 : Date.now() }))
        if (!stale) yield { type: 'error', message: 'Pi subprocess exited unexpectedly (code 1)' }
        yield { type: 'complete' }
      })() },
    }
    ;(manager as any).getOrCreateAgent = async () => agent
    await manager.sendMessage(managed.id, 'Continue')
    expect(managed.messages.filter(message => message.role === 'error')).toHaveLength(1)
    expect(managed.messages.at(-1)?.errorCode).toBe(stale ? 'no_response' : 'agent_process_exited')
  })

  it('does not duplicate an error already emitted by the current turn', async () => {
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        return (async function* () {
          yield { type: 'error' as const, message: 'Provider request failed' }
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => agent

    await manager.sendMessage(managed.id, '继续')

    expect(managed.messages.filter(message => message.role === 'error')).toHaveLength(1)
    expect(managed.messages.at(-1)).toMatchObject({
      role: 'error',
      content: 'Provider request failed',
    })
    expect(events.some(event =>
      event.type === 'typed_error' && event.error?.code === 'unknown_error'
    )).toBe(false)
  })

  it('treats a trailing complete after Stop as interrupted and replaces the runtime', async () => {
    const releaseComplete = Promise.withResolvers<void>()
    const disposeForRestart = mock(async () => {})
    let chatStarted = false
    const agent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      forceAbort() { releaseComplete.resolve() },
      disposeForRestart,
      chat() {
        chatStarted = true
        return (async function* () {
          await releaseComplete.promise
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => {
      managed.agent = agent as never
      return agent
    }

    const sending = manager.sendMessage(managed.id, '执行并行任务')
    await waitUntil(() => chatStarted, 'chat start')
    await manager.cancelProcessing(managed.id)
    await sending

    expect(disposeForRestart).toHaveBeenCalledTimes(1)
    expect(managed.agent).toBeNull()
    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.filter(message => message.errorCode === 'unknown_error')).toHaveLength(0)
    expect(events.some(event => event.type === 'interrupted')).toBe(true)
  })

  it('replays a message sent immediately after Stop on a fresh runtime', async () => {
    const releaseOldComplete = Promise.withResolvers<void>()
    const disposeOldRuntime = mock(async () => {})
    let oldChatStarted = false
    let runtimeCount = 0

    const oldRuntime = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      forceAbort() {},
      disposeForRestart: disposeOldRuntime,
      chat() {
        oldChatStarted = true
        return (async function* () {
          await releaseOldComplete.promise
          yield { type: 'complete' as const }
        })()
      },
    }
    const freshRuntime = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return 'sdk-session' },
      chat() {
        return (async function* () {
          yield { type: 'text_complete' as const, text: '已恢复响应' }
          yield { type: 'complete' as const }
        })()
      },
    }
    ;(manager as any).getOrCreateAgent = async () => {
      if (managed.agent) return managed.agent
      const runtime = runtimeCount++ === 0 ? oldRuntime : freshRuntime
      managed.agent = runtime as never
      return runtime
    }

    const firstTurn = manager.sendMessage(managed.id, '执行并行任务')
    await waitUntil(() => oldChatStarted, 'old chat start')
    await manager.cancelProcessing(managed.id)
    await manager.sendMessage(managed.id, '继续')
    releaseOldComplete.resolve()
    await firstTurn
    await waitUntil(
      () => managed.messages.some(message => message.role === 'assistant' && message.content === '已恢复响应'),
      'fresh runtime response',
    )
    await waitUntil(() => !managed.isProcessing, 'idle state')

    expect(disposeOldRuntime).toHaveBeenCalledTimes(1)
    expect(runtimeCount).toBe(2)
    expect(managed.messageQueue).toHaveLength(0)
    expect(managed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '已恢复响应',
    })
  })
})
