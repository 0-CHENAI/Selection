import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Regression test for the High-severity finding in eb81086e:
//
//   sendMessage's `{ accepted, messageId }` ack contract was returning before
//   the user message hit disk because `persistSession` only enqueues with a
//   500ms debounce. A crash inside the debounce window after ack would lose
//   the message.
//
// The fix added `await this.flushSession(managed.id)` between persistSession
// and onAck. This test locks that ordering by reading the session file from
// inside the onAck callback and asserting the user message is already there.

describe('sendMessage durability', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-durability-'))
    sm = new SessionManager()
  })

  afterEach(() => {
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
      { id, name: 'durability test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function readPersistedMessageIds(sessionId: string): string[] {
    const path = getSessionFilePath(tmpRoot, sessionId)
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf-8').trim().split('\n')
    // First line is the header, remaining lines are messages.
    return lines.slice(1).map(l => JSON.parse(l)).map(m => m.id as string)
  }

  it('user message is on disk before onAck fires (normal branch)', async () => {
    const sessionId = 'durability-normal'
    buildSession(sessionId)

    let ackedMessageId: string | null = null
    let onDiskAtAck = false

    // sendMessage continues past the ack into agent-init, which would throw
    // because we haven't called `setSessionPlatform()` in this minimal test
    // harness. That's fine — we only care about the persist+flush+ack ordering
    // that happens before agent-init. Catch the post-ack rejection.
    await sm
      .sendMessage(
        sessionId,
        'hello',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (messageId) => {
          ackedMessageId = messageId
          onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
        },
      )
      .catch(() => { /* expected post-ack agent-init failure */ })

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
  })

  it('user message is on disk before onAck fires (mid-stream / queued branch)', async () => {
    const sessionId = 'durability-midstream'
    const managed = buildSession(sessionId)
    // Force the mid-stream branch. Agent is null, so redirect() falls back to
    // false and the queue path runs.
    managed.isProcessing = true

    let ackedMessageId: string | null = null
    let onDiskAtAck = false

    await sm.sendMessage(
      sessionId,
      'queued message',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (messageId) => {
        ackedMessageId = messageId
        onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
      },
    )

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
  })

  it('rejects explicit delegation instead of queueing its turn capability', async () => {
    const sessionId = 'delegate-midstream'
    const managed = buildSession(sessionId)
    managed.isProcessing = true

    await expect(sm.sendMessage(
      sessionId,
      'delegate this task',
      undefined,
      undefined,
      { userAuthorizedSpawn: true },
    )).rejects.toThrow('cannot be queued')
    expect(managed.messageQueue).toHaveLength(0)
    expect(managed.messages).toHaveLength(0)
  })

  it('deduplicates a replayed normal send by its persisted client message id', async () => {
    const sessionId = 'idempotent-normal'
    const managed = buildSession(sessionId)
    const ackedIds: string[] = []
    const options = { optimisticMessageId: 'client-message-1' }

    await sm.sendMessage(
      sessionId,
      'send once',
      undefined,
      undefined,
      options,
      undefined,
      undefined,
      messageId => ackedIds.push(messageId),
    ).catch(() => { /* expected post-ack agent-init failure */ })

    await sm.sendMessage(
      sessionId,
      'send once',
      undefined,
      undefined,
      options,
      undefined,
      undefined,
      messageId => ackedIds.push(messageId),
    )

    const userMessages = managed.messages.filter(message => message.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]?.clientMessageId).toBe('client-message-1')
    expect(ackedIds).toHaveLength(2)
    expect(ackedIds[1]).toBe(ackedIds[0])

    const path = getSessionFilePath(tmpRoot, sessionId)
    const storedMessages = readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .slice(1)
      .map(line => JSON.parse(line) as { clientMessageId?: string })
    expect(storedMessages[0]?.clientMessageId).toBe('client-message-1')
  })

  it('deduplicates a replayed mid-stream send before adding a second queue entry', async () => {
    const sessionId = 'idempotent-midstream'
    const managed = buildSession(sessionId)
    managed.isProcessing = true
    const ackedIds: string[] = []
    const options = { optimisticMessageId: 'client-message-queued' }

    for (let attempt = 0; attempt < 2; attempt++) {
      await sm.sendMessage(
        sessionId,
        'queued once',
        undefined,
        undefined,
        options,
        undefined,
        undefined,
        messageId => ackedIds.push(messageId),
      )
    }

    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.messageQueue).toHaveLength(1)
    expect(ackedIds).toHaveLength(2)
    expect(ackedIds[1]).toBe(ackedIds[0])
  })

  it('deduplicates concurrent sends before either RPC has finished', async () => {
    const sessionId = 'idempotent-concurrent'
    const managed = buildSession(sessionId)
    managed.isProcessing = true
    const ackedIds: string[] = []
    const options = { optimisticMessageId: 'client-message-concurrent' }

    await Promise.all(Array.from({ length: 2 }, () => sm.sendMessage(
      sessionId,
      'send concurrently once',
      undefined,
      undefined,
      options,
      undefined,
      undefined,
      messageId => ackedIds.push(messageId),
    )))

    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.messageQueue).toHaveLength(1)
    expect(ackedIds).toHaveLength(2)
    expect(new Set(ackedIds).size).toBe(1)
  })

  it('rejects reuse of a client message id for different content', async () => {
    const sessionId = 'idempotent-conflict'
    const managed = buildSession(sessionId)
    managed.isProcessing = true
    const options = { optimisticMessageId: 'client-message-conflict' }

    await sm.sendMessage(sessionId, 'original', undefined, undefined, options)

    await expect(sm.sendMessage(sessionId, 'different', undefined, undefined, options))
      .rejects.toThrow('was reused with different content')
    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.messageQueue).toHaveLength(1)
  })
})
