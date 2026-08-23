import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type Managed = ReturnType<typeof createManagedSession>

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
  let events: Array<{ type?: string }>
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
    sm.setEventSink((_channel, _target, event) => events.push(event as { type?: string }))
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

  it('shows a placeholder immediately and does not start AI title before the first prompt', async () => {
    const sessionId = 'title-first-prompt'
    const managed = buildSession(sessionId)
    const titleCalls: string[] = []
    ;(sm as unknown as { generateTitle: (managed: Managed, message: string) => Promise<void> }).generateTitle =
      async (_managed, message) => {
        titleCalls.push(message)
      }
    hangAgentCreate()

    hungSend = sm.sendMessage(sessionId, 'Write a report about oak trees').catch(() => undefined)
    await waitUntil(() => managed.pendingAiTitlePrompt === 'Write a report about oak trees', 'pending title')

    expect(managed.name).toBe('Write a report about oak trees')
    expect(titleCalls).toEqual([])
    expect(events.some(event => event.type === 'title_generated')).toBe(true)
  })

  it('does not start AI title while the first prompt is in flight', async () => {
    const sessionId = 'title-in-flight'
    const managed = buildSession(sessionId)
    const titleCalls: string[] = []
    ;(sm as unknown as { generateTitle: (managed: Managed, message: string) => Promise<void> }).generateTitle =
      async (_managed, message) => {
        titleCalls.push(message)
      }

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

    hungSend = sm.sendMessage(sessionId, 'Write a report about oak trees').catch(() => undefined)
    await waitUntil(() => chatStarted, 'chat started')
    await Bun.sleep(20)

    expect(titleCalls).toEqual([])
    expect(managed.pendingAiTitlePrompt).toBe('Write a report about oak trees')
    chatHang.resolve()
  })

  it('skips AI title for automation sessions, named sessions, and hidden nudges', async () => {
    hangAgentCreate()

    const automation = buildSession('title-automation', {
      name: 'Daily digest',
      triggeredBy: { automationName: 'digest', timestamp: Date.now() },
    })
    hungSend = sm.sendMessage('title-automation', 'run digest').catch(() => undefined)
    await waitUntil(() => automation.messages.some(message => message.role === 'user'), 'automation user message')
    expect(automation.pendingAiTitlePrompt).toBeUndefined()
    expect(automation.name).toBe('Daily digest')
    rejectAgentCreate?.(new Error('next'))
    await hungSend
    hungSend = undefined

    const named = buildSession('title-named', { name: 'Already named' })
    hangAgentCreate()
    hungSend = sm.sendMessage('title-named', 'hello').catch(() => undefined)
    await waitUntil(() => named.messages.some(message => message.role === 'user'), 'named user message')
    expect(named.pendingAiTitlePrompt).toBeUndefined()
    expect(named.name).toBe('Already named')
    rejectAgentCreate?.(new Error('next'))
    await hungSend
    hungSend = undefined

    const hidden = buildSession('title-hidden')
    hangAgentCreate()
    hungSend = sm.sendMessage('title-hidden', 'background nudge', undefined, undefined, { hidden: true }).catch(() => undefined)
    await waitUntil(() => hidden.messages.some(message => message.hidden), 'hidden user message')
    expect(hidden.pendingAiTitlePrompt).toBeUndefined()
    expect(hidden.name).toBeUndefined()
  })

  it('starts AI title only after the session is idle, and a slow title does not block completion', async () => {
    const sessionId = 'title-idle'
    const managed = buildSession(sessionId)
    managed.pendingAiTitlePrompt = 'Write a report about oak trees'
    managed.name = 'Write a report about oak trees'
    managed.isProcessing = true
    managed.messageQueue = []

    let released = false
    const titleStarted = Promise.withResolvers<void>()
    const titleFinished = Promise.withResolvers<void>()
    ;(sm as unknown as { generateTitle: (managed: Managed, message: string) => Promise<void> }).generateTitle =
      async () => {
        titleStarted.resolve()
        await titleFinished.promise
        released = true
      }

    const started = Date.now()
    await (sm as unknown as {
      onProcessingStopped: (id: string, reason: string) => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')
    expect(Date.now() - started).toBeLessThan(250)
    await titleStarted.promise
    expect(released).toBe(false)
    expect(managed.pendingAiTitlePrompt).toBeUndefined()

    titleFinished.resolve()
    await Bun.sleep(10)
    expect(released).toBe(true)
  })

  it('keeps the placeholder and does not emit a provider error when title generation fails', async () => {
    const sessionId = 'title-failure'
    const managed = buildSession(sessionId)
    managed.name = 'Write a report about oak trees'
    managed.agentReady = Promise.resolve()
    managed.agent = {
      generateTitle: async () => {
        throw new Error('429 rate limited')
      },
    } as Managed['agent']

    await (sm as unknown as {
      generateTitle: (managed: Managed, message: string) => Promise<void>
    }).generateTitle(managed, 'Write a report about oak trees')

    expect(managed.name).toBe('Write a report about oak trees')
    expect(events.filter(event => event.type === 'typed_error')).toEqual([])
  })
})
