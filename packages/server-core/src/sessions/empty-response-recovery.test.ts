import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
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

  it('surfaces a retryable error when a turn completes without a reply', async () => {
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
      errorCode: 'unknown_error',
      errorCanRetry: true,
      errorActions: [expect.objectContaining({ action: 'retry' })],
    })
    expect(events.find(event => event.type === 'typed_error')).toMatchObject({
      error: { code: 'unknown_error', canRetry: true },
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
      errorCode: 'unknown_error',
      errorCanRetry: true,
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
