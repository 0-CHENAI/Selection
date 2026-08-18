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
})
