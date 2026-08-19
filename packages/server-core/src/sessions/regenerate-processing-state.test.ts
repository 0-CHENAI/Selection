import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

async function flushImmediate(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

describe('regenerate processing state (#17)', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-regenerate-'))
    sm = new SessionManager()
  })

  afterEach(async () => {
    await flushImmediate()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'regenerate test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('claims running state and drops the last assistant turn immediately', async () => {
    const sessionId = 'regen-claim'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    await sm.regenerateLastResponse(sessionId)

    expect(managed.isProcessing).toBe(true)
    expect(managed.messages.map(m => m.id)).toEqual(['u1'])
  })

  it('rejects a second regenerate while the first is still running', async () => {
    const sessionId = 'regen-double'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    await sm.regenerateLastResponse(sessionId)
    await expect(sm.regenerateLastResponse(sessionId)).rejects.toThrow(
      'Cannot regenerate while a response is still generating',
    )
    expect(managed.isProcessing).toBe(true)
  })

  it('waits for an in-flight source update before rebuilding the response', async () => {
    const sessionId = 'regen-source-refresh'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'search the knowledge base', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    let releaseSourceUpdate!: () => void
    const sourceUpdate = new Promise<void>(resolve => {
      releaseSourceUpdate = () => {
        managed.enabledSourceSlugs = ['new-knowledge-base']
        resolve()
      }
    })
    const smInternal = sm as unknown as {
      sessionSourceUpdateLocks: Map<string, Promise<void>>
      sendMessage: SessionManager['sendMessage']
    }
    smInternal.sessionSourceUpdateLocks.set(sessionId, sourceUpdate)

    let sourcesAtReplay: string[] | undefined
    smInternal.sendMessage = (async () => {
      sourcesAtReplay = [...(managed.enabledSourceSlugs ?? [])]
      managed.isProcessing = false
    }) as SessionManager['sendMessage']

    const regenerate = sm.regenerateLastResponse(sessionId)
    await flushImmediate(1)

    // The old response remains visible until the source mutation is committed.
    expect(managed.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    expect(sourcesAtReplay).toBeUndefined()

    releaseSourceUpdate()
    await regenerate
    await flushImmediate(1)

    expect(managed.messages.map(message => message.id)).toEqual(['u1'])
    expect(sourcesAtReplay).toEqual(['new-knowledge-base'])
  })

  it('applies rapid source selections in request order', async () => {
    const sessionId = 'source-update-order'
    buildSession(sessionId)

    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const applied: string[][] = []
    const smInternal = sm as unknown as {
      applySessionSources: (id: string, sourceSlugs: string[]) => Promise<void>
    }
    smInternal.applySessionSources = async (_id, sourceSlugs) => {
      applied.push(sourceSlugs)
      if (sourceSlugs[0] === 'first') await firstBlocked
    }

    const first = sm.setSessionSources(sessionId, ['first'])
    const second = sm.setSessionSources(sessionId, ['second'])
    await flushImmediate(1)

    expect(applied).toEqual([['first']])

    releaseFirst()
    await Promise.all([first, second])

    expect(applied).toEqual([['first'], ['second']])
  })

  it('clears running state when validation fails before truncate', async () => {
    const sessionId = 'regen-nothing'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
    ]

    await expect(sm.regenerateLastResponse(sessionId)).rejects.toThrow('Nothing to regenerate')
    expect(managed.isProcessing).toBe(false)
  })

  it('replays the existing user turn instead of mid-stream queueing', async () => {
    const sessionId = 'regen-not-midstream'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
    ]
    managed.isProcessing = true
    managed.processingGeneration = 3

    await sm.sendMessage(
      sessionId,
      'hi',
      undefined,
      undefined,
      undefined,
      'u1',
    ).catch(() => { /* agent init is expected to fail in this harness */ })

    expect(managed.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(managed.messageQueue).toHaveLength(0)
    expect(managed.processingGeneration).toBe(4)
  })

  it('Stop during regenerate (no agent) leaves the session idle after sendMessage runs', async () => {
    const sessionId = 'regen-stop'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    await sm.regenerateLastResponse(sessionId)
    expect(managed.isProcessing).toBe(true)
    expect(managed.agent).toBeNull()

    await sm.cancelProcessing(sessionId)
    const generationAfterStop = managed.processingGeneration
    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.some(m => m.role === 'info' && m.content === 'Response interrupted')).toBe(true)

    await flushImmediate()
    expect(managed.isProcessing).toBe(false)
    expect(managed.processingGeneration).toBe(generationAfterStop)
  })

  it('does not let an in-flight regenerate send re-claim after Stop', async () => {
    const sessionId = 'regen-inflight-stop'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
    ]
    managed.isProcessing = true
    managed.processingGeneration = 3

    const sendP = sm.sendMessage(
      sessionId,
      'hi',
      undefined,
      undefined,
      undefined,
      'u1',
    ).catch(() => { /* agent init is expected to fail in this harness */ })
    await sm.cancelProcessing(sessionId)
    const generationAfterStop = managed.processingGeneration

    await sendP
    await flushImmediate()

    expect(managed.isProcessing).toBe(false)
    expect(managed.processingGeneration).toBe(generationAfterStop)
    expect(managed.messages.filter(m => m.role === 'user')).toHaveLength(1)
  })

  it('does not emit truncate after Stop wins during message load', async () => {
    const sessionId = 'regen-stop-before-truncate'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      ensureMessagesLoaded: (session: typeof managed) => Promise<void>
    }
    const originalLoad = smInternal.ensureMessagesLoaded.bind(sm)
    smInternal.ensureMessagesLoaded = async (session) => {
      await originalLoad(session)
      await sm.cancelProcessing(sessionId)
    }

    await expect(sm.regenerateLastResponse(sessionId)).resolves.toEqual({ success: true })
    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.some(m => m.id === 'a1')).toBe(true)
    expect(managed.messages.some(m => m.role === 'info' && m.content === 'Response interrupted')).toBe(true)
  })
})
