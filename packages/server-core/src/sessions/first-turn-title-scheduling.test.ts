import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import type { PendingFirstTurnAiTitle } from './first-turn-title.ts'

type Managed = ReturnType<typeof createManagedSession>

const FIRST_PROMPT = 'Write a report about oak trees'

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

describe('first-turn title scheduling (#46)', () => {
  let tmpRoot: string
  let sm: SessionManager
  let events: Array<{ type?: string; title?: string }>
  let rejectAgentCreate: ((error: Error) => void) | undefined
  let hungSend: Promise<void> | undefined

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-title-46-'))
    sm = new SessionManager()
    events = []
    rejectAgentCreate = undefined
    hungSend = undefined
    ;(sm as unknown as { persistSession: (managed: Managed) => void }).persistSession = () => {}
    ;(sm as unknown as { flushSession: (id: string) => Promise<void> }).flushSession = async () => {}
    sm.setEventSink((_channel, _target, event) => events.push(event as { type?: string; title?: string }))
  })

  afterEach(async () => {
    rejectAgentCreate?.(new Error('test teardown'))
    if (hungSend) await hungSend.catch(() => undefined)
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string, extra: Partial<Managed> = {}) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, ...extra },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, Managed> }).sessions.set(id, managed)
    return managed
  }

  function hangAgentCreate() {
    ;(sm as unknown as { getOrCreateAgent: (managed: Managed) => Promise<unknown> }).getOrCreateAgent = () =>
      new Promise((_, reject) => {
        rejectAgentCreate = reject
      })
  }

  function stubGenerateTitle(onCall?: (pending: PendingFirstTurnAiTitle) => Promise<void> | void) {
    const titleCalls: PendingFirstTurnAiTitle[] = []
    ;(sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle = async (_managed, pending) => {
      titleCalls.push(pending)
      await onCall?.(pending)
    }
    return titleCalls
  }

  it('shows a placeholder immediately and does not start AI title before the first prompt', async () => {
    const sessionId = 'title-first-prompt'
    const managed = buildSession(sessionId)
    const titleCalls = stubGenerateTitle()
    hangAgentCreate()

    hungSend = sm.sendMessage(sessionId, FIRST_PROMPT).catch(() => undefined)
    await waitUntil(() => managed.pendingAiTitle?.prompt === FIRST_PROMPT, 'pending title')

    expect(managed.name).toBe(FIRST_PROMPT)
    expect(managed.pendingAiTitle).toEqual({ prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })
    expect(titleCalls).toEqual([])
    expect(events.some(event => event.type === 'title_generated' && event.title === FIRST_PROMPT)).toBe(true)
  })

  it('does not start AI title while the first prompt is in flight', async () => {
    const sessionId = 'title-in-flight'
    const managed = buildSession(sessionId)
    const titleCalls = stubGenerateTitle()

    let chatStarted = false
    const chatHang = Promise.withResolvers<void>()
    const mockAgent = {
      setAllSources() {},
      getModel() { return 'test-model' },
      getSessionId() { return undefined },
      chat() {
        chatStarted = true
        return (async function* () {
          yield { type: 'text_delta', text: 'Hello', turnId: 'turn-1' }
          await chatHang.promise
        })()
      },
      forceAbort() {},
    }
    ;(sm as unknown as { getOrCreateAgent: (managed: Managed) => Promise<unknown> }).getOrCreateAgent = async () => mockAgent

    hungSend = sm.sendMessage(sessionId, FIRST_PROMPT).catch(() => undefined)
    await waitUntil(() => chatStarted, 'chat started')
    await Bun.sleep(20)

    expect(titleCalls).toEqual([])
    expect(managed.pendingAiTitle?.prompt).toBe(FIRST_PROMPT)
    chatHang.resolve()
  })

  it('skips AI title for automation sessions', async () => {
    hangAgentCreate()
    const automation = buildSession('title-automation', {
      name: 'Daily digest',
      triggeredBy: { automationName: 'digest', timestamp: Date.now() },
    })
    hungSend = sm.sendMessage('title-automation', 'run digest').catch(() => undefined)
    await waitUntil(() => automation.messages.some(message => message.role === 'user'), 'automation user message')
    expect(automation.pendingAiTitle).toBeUndefined()
    expect(automation.name).toBe('Daily digest')
  })

  it('skips AI title when the session already has a name', async () => {
    hangAgentCreate()
    const named = buildSession('title-named', { name: 'Already named' })
    hungSend = sm.sendMessage('title-named', 'hello').catch(() => undefined)
    await waitUntil(() => named.messages.some(message => message.role === 'user'), 'named user message')
    expect(named.pendingAiTitle).toBeUndefined()
    expect(named.name).toBe('Already named')
  })

  it('skips AI title for hidden nudges', async () => {
    hangAgentCreate()
    const hidden = buildSession('title-hidden')
    hungSend = sm.sendMessage('title-hidden', 'background nudge', undefined, undefined, { hidden: true }).catch(() => undefined)
    await waitUntil(() => hidden.messages.some(message => message.hidden), 'hidden user message')
    expect(hidden.pendingAiTitle).toBeUndefined()
    expect(hidden.name).toBeUndefined()
  })

  it('starts AI title only after the session is idle, and a slow title does not block completion', async () => {
    const sessionId = 'title-idle'
    const managed = buildSession(sessionId)
    managed.pendingAiTitle = { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT }
    managed.name = FIRST_PROMPT
    managed.isProcessing = true
    managed.messageQueue = []

    let released = false
    const titleStarted = Promise.withResolvers<void>()
    const titleFinished = Promise.withResolvers<void>()
    stubGenerateTitle(async () => {
      titleStarted.resolve()
      await titleFinished.promise
      released = true
    })

    const started = Date.now()
    await (sm as unknown as {
      onProcessingStopped: (id: string, reason: string) => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')
    expect(Date.now() - started).toBeLessThan(250)
    await titleStarted.promise
    expect(released).toBe(false)
    expect(managed.pendingAiTitle).toBeUndefined()

    titleFinished.resolve()
    await Bun.sleep(10)
    expect(released).toBe(true)
  })

  it('defers AI title when a new turn starts before generation', async () => {
    const sessionId = 'title-defer'
    const managed = buildSession(sessionId)
    const pending = { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT }
    managed.name = FIRST_PROMPT
    managed.isProcessing = true
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => 'Oak Report',
    } as unknown as Managed['agent']

    await (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, pending)

    expect(managed.pendingAiTitle).toEqual(pending)
    expect(managed.name).toBe(FIRST_PROMPT)
    expect(events.filter(event => event.type === 'title_generated')).toEqual([])
  })

  it('does not overwrite a rename that happened while the title was pending', async () => {
    const sessionId = 'title-renamed'
    const managed = buildSession(sessionId)
    managed.name = 'Oak bid'
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => 'Oak Report',
    } as unknown as Managed['agent']

    await (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })

    expect(managed.name).toBe('Oak bid')
    expect(managed.pendingAiTitle).toBeUndefined()
    expect(events.filter(event => event.type === 'title_generated')).toEqual([])
  })

  it('does not overwrite a rename that lands during generation', async () => {
    const sessionId = 'title-rename-during'
    const managed = buildSession(sessionId)
    managed.name = FIRST_PROMPT
    managed.agentReady = Promise.resolve()
    const titleResult = Promise.withResolvers<string>()
    managed.agent = {
      generateTitle: async () => titleResult.promise,
    } as unknown as Managed['agent']

    const generating = (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })

    await Bun.sleep(10)
    managed.name = 'Oak bid'
    titleResult.resolve('Oak Report')
    await generating

    expect(managed.name).toBe('Oak bid')
    expect(events.filter(event => event.type === 'title_generated')).toEqual([])
  })

  it('does not persist a title onto a deleted session', async () => {
    const sessionId = 'title-deleted'
    const managed = buildSession(sessionId)
    managed.name = FIRST_PROMPT
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => 'Oak Report',
    } as unknown as Managed['agent']
    ;(sm as unknown as { sessions: Map<string, Managed> }).sessions.delete(sessionId)

    await (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })

    expect(managed.name).toBe(FIRST_PROMPT)
    expect(events.filter(event => event.type === 'title_generated')).toEqual([])
  })

  it('replaces the placeholder once generation succeeds', async () => {
    const sessionId = 'title-success'
    const managed = buildSession(sessionId)
    managed.name = FIRST_PROMPT
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => 'Oak Report',
    } as unknown as Managed['agent']

    await (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })

    expect(managed.name).toBe('Oak Report')
    expect(events.some(event => event.type === 'title_generated' && event.title === 'Oak Report')).toBe(true)
  })

  it('keeps the placeholder and does not emit a provider error when title generation fails', async () => {
    const sessionId = 'title-failure'
    const managed = buildSession(sessionId)
    managed.name = FIRST_PROMPT
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => {
        throw new Error('429 rate limited')
      },
    } as unknown as Managed['agent']

    await (sm as unknown as {
      generateTitle: (managed: Managed, pending: PendingFirstTurnAiTitle) => Promise<void>
    }).generateTitle(managed, { prompt: FIRST_PROMPT, placeholder: FIRST_PROMPT })

    expect(managed.name).toBe(FIRST_PROMPT)
    expect(events.filter(event => event.type === 'typed_error')).toEqual([])
  })
})
