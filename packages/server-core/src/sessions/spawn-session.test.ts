import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SpawnSessionRequest, SpawnSessionResult } from '@craft-agent/shared/agent'
import { SessionManager, createManagedSession, type SessionCompletionEvent } from './SessionManager.ts'

type SpawnInternals = {
  sessions: Map<string, ReturnType<typeof createManagedSession>>
  spawnSessionFromTool: (
    managed: ReturnType<typeof createManagedSession>,
    request: SpawnSessionRequest,
  ) => Promise<SpawnSessionResult>
  emitSessionComplete: (evt: SessionCompletionEvent) => void
  surfaceSpawnedSessionCompletion: (evt: SessionCompletionEvent) => void
  flushDeferredSpawnWakes: (managed: ReturnType<typeof createManagedSession>) => void
  markOrphanedBackgroundTasks: (sessionId: string) => void
  listBackgroundTasks: (sessionId: string) => Array<{
    taskId: string
    status: string
    source?: string
    intent?: string
  }>
  createSession: SessionManager['createSession']
  sendMessage: SessionManager['sendMessage']
  keepBackgroundTasksAlive: boolean
  onSessionComplete: SessionManager['onSessionComplete']
}

function internals(sm: SessionManager): SpawnInternals {
  return sm as unknown as SpawnInternals
}

describe('SessionManager spawn_session wait/background', () => {
  let tmpRoot: string
  let sm: SessionManager
  let sendCalls: Array<{ id: string; msg: string; hidden?: boolean }>

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-spawn-'))
    sm = new SessionManager()
    sendCalls = []
    const api = internals(sm)
    api.sendMessage = async (id, msg, _a, _s, opts) => {
      sendCalls.push({ id, msg, hidden: opts?.hidden })
    }
    api.onSessionComplete((evt) => api.surfaceSpawnedSessionCompletion(evt))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildParent(id = 'parent') {
    const workspace = { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession(
      { id, name: 'parent', llmConnection: 'openai', model: 'gpt-4.1' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    internals(sm).sessions.set(id, managed)
    internals(sm).keepBackgroundTasksAlive = false
    return managed
  }

  function stubCreateChild(childId = 'child') {
    internals(sm).createSession = async () => {
      const parent = internals(sm).sessions.get('parent')!
      const child = createManagedSession(
        { id: childId, name: 'Research auth', parentSessionId: parent.id },
        parent.workspace,
        { messagesLoaded: true },
      )
      child.isProcessing = true
      internals(sm).sessions.set(childId, child)
      return {
        id: childId,
        name: child.name ?? childId,
        llmConnection: parent.llmConnection,
        model: parent.model,
      } as Awaited<ReturnType<SessionManager['createSession']>>
    }
  }

  function emitChild(reason: SessionCompletionEvent['reason'], finalText?: string, childId = 'child') {
    internals(sm).emitSessionComplete({
      sessionId: childId,
      workspaceId: 'ws_test',
      reason,
      finalText,
    })
  }

  async function flush(ms = 20) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  it('wait returns completed + finalText without registering a background chip', async () => {
    const parent = buildParent()
    stubCreateChild()
    const pending = internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      name: 'Research auth',
      mode: 'wait',
      timeoutMs: 2_000,
    })
    await flush()
    emitChild('complete', 'Found login.ts')
    await expect(pending).resolves.toMatchObject({
      sessionId: 'child',
      status: 'completed',
      finalText: 'Found login.ts',
    })
    expect(internals(sm).listBackgroundTasks(parent.id)).toEqual([])
  })

  it('wait maps child error to failed and leaves the child running', async () => {
    const parent = buildParent()
    stubCreateChild()
    const pending = internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      mode: 'wait',
      timeoutMs: 2_000,
    })
    await flush()
    emitChild('error')
    await expect(pending).resolves.toMatchObject({ sessionId: 'child', status: 'failed' })
    expect(internals(sm).sessions.get('child')?.isProcessing).toBe(true)
  })

  it('wait timeout returns timeout and does not stop the child', async () => {
    const parent = buildParent()
    stubCreateChild()
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      mode: 'wait',
      timeoutMs: 30,
    })
    expect(result.status).toBe('timeout')
    expect(result.sessionId).toBe('child')
    expect(internals(sm).sessions.get('child')?.isProcessing).toBe(true)
  })

  it('parent abort returns interrupted and does not stop the child', async () => {
    const parent = buildParent()
    stubCreateChild()
    const pending = internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      mode: 'wait',
      timeoutMs: 5_000,
    })
    await flush()
    parent.stopRequested = true
    await expect(pending).resolves.toMatchObject({ sessionId: 'child', status: 'interrupted' })
    expect(internals(sm).sessions.get('child')?.isProcessing).toBe(true)
  })

  it('background registers the child, lists it, and does not orphan it', async () => {
    const parent = buildParent()
    stubCreateChild()
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      name: 'Research auth',
      mode: 'background',
    })
    expect(result).toMatchObject({ sessionId: 'child', status: 'started' })

    const listed = internals(sm).listBackgroundTasks(parent.id)
    expect(listed).toEqual([
      expect.objectContaining({
        taskId: 'child',
        status: 'running',
        source: 'spawn_session',
        intent: 'Research auth',
      }),
    ])

    parent.backgroundTaskRegistry.set('legacy-task', {
      taskId: 'legacy-task',
      startTime: Date.now(),
      status: 'running',
    })
    internals(sm).markOrphanedBackgroundTasks(parent.id)
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('running')
    expect(parent.backgroundTaskRegistry.get('legacy-task')?.status).toBe('orphaned')
  })

  it('background child completion wakes an idle parent even when keep-alive is off', async () => {
    const parent = buildParent()
    parent.isProcessing = false
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      name: 'Research auth',
      mode: 'background',
    })
    sendCalls.length = 0
    emitChild('complete', 'Found login.ts')
    await flush()

    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('completed')
    expect(sendCalls).toEqual([
      expect.objectContaining({
        id: parent.id,
        hidden: true,
        msg: expect.stringContaining('Session ID: child'),
      }),
    ])
    expect(sendCalls[0]?.msg).toContain('Found login.ts')
  })

  it('does not wake the parent while its own turn is still running', async () => {
    const parent = buildParent()
    parent.isProcessing = true
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      mode: 'background',
    })
    sendCalls.length = 0
    emitChild('complete', 'Found login.ts')
    await flush()

    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('completed')
    expect(parent.backgroundTaskRegistry.get('child')?.needsIdleWake).toBe(true)
    expect(sendCalls).toEqual([])
  })

  it('wakes the parent after its turn ends if the child finished mid-turn', async () => {
    const parent = buildParent()
    parent.isProcessing = true
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      name: 'Research auth',
      mode: 'background',
    })
    sendCalls.length = 0
    emitChild('complete', 'Found login.ts')
    await flush()
    expect(sendCalls).toEqual([])

    parent.isProcessing = false
    internals(sm).flushDeferredSpawnWakes(parent)
    expect(sendCalls).toEqual([
      expect.objectContaining({
        id: parent.id,
        hidden: true,
        msg: expect.stringContaining('Session ID: child'),
      }),
    ])
    expect(parent.backgroundTaskRegistry.get('child')?.needsIdleWake).toBe(false)
  })

  it('wait fails immediately when the child prompt cannot be sent', async () => {
    const parent = buildParent()
    stubCreateChild()
    internals(sm).sendMessage = async () => {
      throw new Error('child prompt rejected')
    }
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      mode: 'wait',
      timeoutMs: 5_000,
    })
    expect(result.status).toBe('failed')
    expect(result.finalText).toContain('child prompt rejected')
  })

  it('background marks the chip failed when the child prompt cannot be sent', async () => {
    const parent = buildParent()
    stubCreateChild()
    internals(sm).sendMessage = async () => {
      throw new Error('child prompt rejected')
    }
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth',
      mode: 'background',
    })
    expect(result.status).toBe('started')
    await flush()
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('failed')
  })

  it('stop reports running spawn children and does not cancel them', async () => {
    const events: Array<{ type: string; runningChildCount?: number }> = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event as { type: string; runningChildCount?: number })
    })
    const parent = buildParent()
    parent.agent = { forceAbort() {} } as never
    const child = createManagedSession(
      { id: 'child', name: 'Research auth', parentSessionId: parent.id },
      parent.workspace,
      { messagesLoaded: true },
    )
    child.isProcessing = true
    internals(sm).sessions.set('child', child)
    parent.backgroundTaskRegistry.set('child', {
      taskId: 'child',
      startTime: Date.now(),
      status: 'running',
      source: 'spawn_session',
    })
    parent.backgroundTaskRegistry.set('legacy-task', {
      taskId: 'legacy-task',
      startTime: Date.now(),
      status: 'running',
    })

    await sm.cancelProcessing(parent.id)

    const interrupted = events.find((event) => event.type === 'interrupted')
    expect(interrupted?.runningChildCount).toBe(1)
    expect(child.isProcessing).toBe(true)
    expect(child.stopRequested).toBeFalsy()
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('running')
  })

  it('stop reports a wait-mode child that is not in the background registry', async () => {
    const events: Array<{ type: string; runningChildCount?: number }> = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event as { type: string; runningChildCount?: number })
    })
    const parent = buildParent()
    parent.agent = { forceAbort() {} } as never
    const child = createManagedSession(
      { id: 'wait-child', name: 'Research auth', parentSessionId: parent.id },
      parent.workspace,
      { messagesLoaded: true },
    )
    child.isProcessing = true
    internals(sm).sessions.set('wait-child', child)

    await sm.cancelProcessing(parent.id)

    const interrupted = events.find((event) => event.type === 'interrupted')
    expect(interrupted?.runningChildCount).toBe(1)
    expect(child.isProcessing).toBe(true)
    expect(child.stopRequested).toBeFalsy()
    expect(parent.backgroundTaskRegistry.size).toBe(0)
  })

  it('stop omits the child hint when no spawn children are running', async () => {
    const events: Array<{ type: string; runningChildCount?: number }> = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event as { type: string; runningChildCount?: number })
    })
    const parent = buildParent()
    parent.agent = { forceAbort() {} } as never
    parent.backgroundTaskRegistry.set('done-child', {
      taskId: 'done-child',
      startTime: Date.now(),
      status: 'completed',
      source: 'spawn_session',
    })

    await sm.cancelProcessing(parent.id)

    const interrupted = events.find((event) => event.type === 'interrupted')
    expect(interrupted).toBeDefined()
    expect(interrupted?.runningChildCount).toBeUndefined()
  })
})
