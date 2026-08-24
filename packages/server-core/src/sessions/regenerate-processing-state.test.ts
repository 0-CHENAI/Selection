import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionPath, loadSession } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession, savePiTurnAnchor } from './SessionManager.ts'

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

  it('keeps the live transcript until the replacement run is ready to stream', async () => {
    const sessionId = 'regen-delay-truncate'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      announceRegenerateReplacement: (session: typeof managed) => void
      onProcessingStopped: (id: string, reason: 'complete') => Promise<void>
    }
    smInternal.sendMessage = (async () => {
      expect(managed.messages.map(message => message.id)).toEqual(['u1', 'a1'])
      smInternal.announceRegenerateReplacement(managed)
      expect(managed.messages.map(message => message.id)).toEqual(['u1'])
      managed.messages.push({ id: 'a2', role: 'assistant', content: 'new answer', timestamp: 3 })
      await smInternal.onProcessingStopped(sessionId, 'complete')
    }) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    expect(managed.isProcessing).toBe(true)
    expect(managed.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    expect((await sm.getSession(sessionId))?.isProcessing).toBe(true)
    expect((await sm.getSession(sessionId))?.messages.map(message => message.id)).toEqual(['u1', 'a1'])

    await flushImmediate()
    expect(managed.messages.map(message => message.id)).toEqual(['u1', 'a2'])
  })

  it('claims running state and keeps the old transcript as a rollback snapshot', async () => {
    const sessionId = 'regen-claim'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
    ]

    await sm.regenerateLastResponse(sessionId)

    expect(managed.isProcessing).toBe(true)
    expect(managed.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(managed.regenerateTransaction?.originalMessages.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('restores the old response when the regenerated execution fails', async () => {
    const sessionId = 'regen-rollback-error'
    const managed = buildSession(sessionId)
    managed.sdkSessionId = 'sdk-original'
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const events: Array<{ type?: string }> = []
    sm.setEventSink((_channel, _target, event) => events.push(event as { type?: string }))
    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async () => {
      managed.streamingText = 'partial replacement'
      managed.messages.push({
        id: 'tool-new',
        role: 'tool',
        content: 'new run tool',
        timestamp: 3,
        toolName: 'new-tool',
      })
      await smInternal.onProcessingStopped(sessionId, 'error')
    }) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate()

    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(managed.streamingText).toBe('')
    expect(managed.sdkSessionId).toBe('sdk-original')
    expect(managed.regenerateTransaction).toBeUndefined()
    expect(events.some(event => event.type === 'regenerate_started')).toBe(true)
    expect(events.some(event => event.type === 'messages_truncated')).toBe(false)
  })

  it('commits only a non-empty final assistant response', async () => {
    const sessionId = 'regen-commit-success'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'complete') => Promise<void>
      announceRegenerateReplacement: (session: typeof managed) => void
    }
    smInternal.sendMessage = (async () => {
      smInternal.announceRegenerateReplacement(managed)
      managed.messages.push({ id: 'a2', role: 'assistant', content: 'new answer', timestamp: 3 })
      await smInternal.onProcessingStopped(sessionId, 'complete')
    }) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate()

    expect(managed.isProcessing).toBe(false)
    expect(managed.messages.map(m => m.id)).toEqual(['u1', 'a2'])
    expect(managed.regenerateTransaction).toBeUndefined()
  })

  it('restores the old response when regeneration completes without content', async () => {
    const sessionId = 'regen-empty-response'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'complete') => Promise<void>
    }
    smInternal.sendMessage = (async () => {
      await smInternal.onProcessingStopped(sessionId, 'complete')
    }) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate()

    expect(managed.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(managed.regenerateTransaction).toBeUndefined()
  })

  it('keeps the old response on disk until the replacement commits', async () => {
    const sessionId = 'regen-persist-atomic'
    const managed = buildSession(sessionId)
    managed.sdkSessionId = 'sdk-original'
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async () => {}) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate(1)
    await sm.flushSession(sessionId)

    const persisted = loadSession(tmpRoot, sessionId)
    expect(persisted?.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    expect(persisted?.sdkSessionId).toBe('sdk-original')

    await smInternal.onProcessingStopped(sessionId, 'error')
  })

  it('uses a native Pi anchor before the target user in multi-turn regeneration', async () => {
    const sessionId = 'regen-pi-anchor'
    const managed = buildSession(sessionId)
    managed.sdkSessionId = 'sdk-original'
    managed.messages = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'first answer', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'second', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'old second answer', timestamp: 4 },
    ]
    await savePiTurnAnchor(getSessionPath(tmpRoot, sessionId), 'a1', 'pi-entry-a1')

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async () => {}) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate(1)

    expect(managed.branchFromSdkSessionId).toBe('sdk-original')
    expect(managed.branchFromSessionPath).toBe(getSessionPath(tmpRoot, sessionId))
    expect(managed.branchFromSdkTurnId).toBe('pi-entry-a1')
    expect(managed.forceFreshSdkSession).toBe(false)
    expect(managed.regenerateSeedPending).toBe(false)

    await smInternal.onProcessingStopped(sessionId, 'error')
  })

  it('forces a fresh native session and excludes the target user from seed context when no anchor exists', async () => {
    const sessionId = 'regen-pi-fresh'
    const managed = buildSession(sessionId)
    managed.sdkSessionId = 'sdk-original'
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async () => {}) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate(1)

    expect(managed.forceFreshSdkSession).toBe(true)
    expect(managed.regenerateSeedPending).toBe(true)
    expect(managed.branchFromSessionPath).toBeUndefined()

    await smInternal.onProcessingStopped(sessionId, 'error')
  })

  it('replays with the latest model, permission, sources, and skill options after disposing the old runtime', async () => {
    const sessionId = 'regen-latest-runtime-config'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'use the new capability', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]
    managed.model = 'new-model'
    managed.permissionMode = 'allow-all'
    managed.enabledSourceSlugs = ['new-source']
    managed.lastSentOptions = { skillSlugs: ['new-skill'] }

    let disposed = false
    managed.agent = {
      disposeForRestart: async () => { disposed = true },
    } as never

    let replaySnapshot: unknown
    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async (_id, _message, _attachments, _stored, options) => {
      replaySnapshot = {
        model: managed.model,
        permissionMode: managed.permissionMode,
        sources: managed.enabledSourceSlugs,
        skillSlugs: options?.skillSlugs,
        agent: managed.agent,
      }
    }) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    await flushImmediate(1)

    expect(disposed).toBe(true)
    expect(replaySnapshot).toEqual({
      model: 'new-model',
      permissionMode: 'allow-all',
      sources: ['new-source'],
      skillSlugs: ['new-skill'],
      agent: null,
    })

    await smInternal.onProcessingStopped(sessionId, 'error')
  })

  it('creates an independent run id for consecutive regenerations', async () => {
    const sessionId = 'regen-consecutive-runs'
    const managed = buildSession(sessionId)
    managed.messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
    ]

    const smInternal = sm as unknown as {
      sendMessage: SessionManager['sendMessage']
      onProcessingStopped: (id: string, reason: 'error') => Promise<void>
    }
    smInternal.sendMessage = (async () => {}) as SessionManager['sendMessage']

    await sm.regenerateLastResponse(sessionId)
    const firstRunId = managed.regenerateTransaction?.runId
    await smInternal.onProcessingStopped(sessionId, 'error')

    await sm.regenerateLastResponse(sessionId)
    const secondRunId = managed.regenerateTransaction?.runId

    expect(firstRunId).toBeTruthy()
    expect(secondRunId).toBeTruthy()
    expect(secondRunId).not.toBe(firstRunId)

    await smInternal.onProcessingStopped(sessionId, 'error')
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

    expect(managed.messages.map(message => message.id)).toEqual(['u1', 'a1'])
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
