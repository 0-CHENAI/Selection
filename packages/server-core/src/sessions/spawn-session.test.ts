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
  stopSwarm: SessionManager['stopSwarm']
  updateSessionSwarmEnabled: SessionManager['updateSessionSwarmEnabled']
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
    internals(sm).createSession = async (_workspaceId, options) => {
      const parent = internals(sm).sessions.get('parent')!
      const child = createManagedSession(
        {
          id: childId,
          name: 'Research auth',
          hidden: options?.hidden,
          projectId: options?.projectId,
          parentSessionId: parent.id,
          swarmEnabled: options?.swarmEnabled,
          orchestrationId: options?.orchestrationId,
          orchestrationRootSessionId: options?.orchestrationRootSessionId,
          orchestrationDepth: options?.orchestrationDepth,
          orchestrationRole: options?.orchestrationRole,
          orchestrationLifecycle: options?.orchestrationLifecycle,
          orchestrationStatus: options?.orchestrationStatus,
        },
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
        hidden: child.hidden,
        projectId: child.projectId,
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

  const completeQualification = {
    tracks: [
      { name: 'code', input: 'repo', expectedOutput: 'findings', evidence: 'tests', toolKinds: ['shell'] },
      { name: 'docs', input: 'spec', expectedOutput: 'gaps', evidence: 'citations', toolKinds: ['browser'] },
    ],
    parallelBenefit: 'The tracks are independent.',
    finalAggregation: 'The coordinator reconciles both evidence sets.',
  }

  it('blocks automatic spawning while disabled and fails closed on incomplete qualification', async () => {
    const parent = buildParent()
    stubCreateChild()
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Split this task',
      spawnReason: 'automatic',
      qualification: completeQualification,
    })).rejects.toThrow('Automatic spawn_session is disabled')
    expect(internals(sm).sessions.has('child')).toBe(false)

    parent.swarmEnabled = true
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Split this task',
      spawnReason: 'automatic',
    })).rejects.toThrow('Swarm qualification failed')
    expect(internals(sm).sessions.has('child')).toBe(false)
  })

  it('persists orchestration identity, hides workers, and inherits project ownership', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    parent.projectId = 'project-1'
    stubCreateChild()
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Investigate code',
      spawnReason: 'automatic',
      qualification: completeQualification,
      mode: 'background',
      role: 'reviewer',
      lifecycle: 'detached',
    })

    expect(result).toMatchObject({
      status: 'started',
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      depth: 1,
      role: 'reviewer',
      lifecycle: 'detached',
      projectId: 'project-1',
    })
    expect(result.orchestrationId).toBeString()
    expect(internals(sm).sessions.get('child')).toMatchObject({
      hidden: true,
      projectId: 'project-1',
      swarmEnabled: true,
      orchestrationId: result.orchestrationId,
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 1,
      orchestrationRole: 'reviewer',
      orchestrationLifecycle: 'detached',
      orchestrationStatus: 'running',
    })
    expect(internals(sm).listBackgroundTasks(parent.id)[0]).toMatchObject({
      orchestrationId: result.orchestrationId,
      rootSessionId: parent.id,
      parentSessionId: parent.id,
      depth: 1,
      role: 'reviewer',
      lifecycle: 'detached',
      projectId: 'project-1',
    })
  })

  it('rejects permission escalation, project reassignment, depth overflow, and a fourth live worker', async () => {
    const parent = buildParent()
    parent.permissionMode = 'safe'
    parent.projectId = 'project-1'
    parent.orchestrationId = 'orch'
    parent.orchestrationRootSessionId = parent.id
    parent.orchestrationDepth = 0
    parent.orchestrationStatus = 'running'
    stubCreateChild()
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Escalate',
      spawnReason: 'user-requested',
      permissionMode: 'allow-all',
    })).rejects.toThrow('permission exceeds parent ceiling')
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Move project',
      spawnReason: 'user-requested',
      projectId: 'project-2',
    })).rejects.toThrow('inherit the parent projectId')

    parent.orchestrationDepth = 2
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Too deep',
      spawnReason: 'user-requested',
    })).rejects.toThrow('depth limit exceeded')
    parent.orchestrationDepth = 0
    for (let index = 0; index < 3; index++) {
      const child = createManagedSession({
        id: `live-${index}`,
        parentSessionId: parent.id,
        orchestrationId: 'orch',
        orchestrationDepth: 1,
        orchestrationLifecycle: 'managed',
        orchestrationStatus: 'running',
      }, parent.workspace, { messagesLoaded: true })
      child.isProcessing = true
      internals(sm).sessions.set(child.id, child)
    }
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Fourth',
      spawnReason: 'user-requested',
    })).rejects.toThrow('concurrency limit exceeded')
  })

  it('explicit stop cascades through managed descendants but leaves detached subtrees alive', async () => {
    const root = buildParent()
    root.orchestrationId = 'orch'
    root.orchestrationRootSessionId = root.id
    root.orchestrationDepth = 0
    root.orchestrationLifecycle = 'managed'
    root.orchestrationStatus = 'running'
    const add = (id: string, parentSessionId: string, lifecycle: 'managed' | 'detached') => {
      const session = createManagedSession({
        id,
        parentSessionId,
        orchestrationId: 'orch',
        orchestrationRootSessionId: root.id,
        orchestrationDepth: parentSessionId === root.id ? 1 : 2,
        orchestrationLifecycle: lifecycle,
        orchestrationStatus: 'running',
      }, root.workspace, { messagesLoaded: true })
      session.isProcessing = true
      internals(sm).sessions.set(id, session)
      return session
    }
    const managed = add('managed', root.id, 'managed')
    const grandchild = add('grandchild', managed.id, 'managed')
    const detached = add('detached', root.id, 'detached')
    const detachedChild = add('detached-child', detached.id, 'managed')

    const result = await internals(sm).stopSwarm(root.id)
    expect(new Set(result.stoppedSessionIds)).toEqual(new Set([root.id, managed.id, grandchild.id]))
    expect(result.detachedSessionIds).toEqual(['detached'])
    expect(managed.orchestrationStatus).toBe('stopped')
    expect(grandchild.orchestrationStatus).toBe('stopped')
    expect(detached.isProcessing).toBe(true)
    expect(detached.orchestrationStatus).toBe('running')
    expect(detachedChild.isProcessing).toBe(true)
  })

  it('stopping a DAG worker cancels its managed Swarm roots without stopping detached roots', async () => {
    const worker = buildParent()
    worker.taskNodeId = 'investigate'
    const add = (id: string, lifecycle: 'managed' | 'detached') => {
      const session = createManagedSession({
        id,
        parentSessionId: worker.id,
        orchestrationId: `orch-${id}`,
        orchestrationRootSessionId: worker.id,
        orchestrationDepth: 1,
        orchestrationLifecycle: lifecycle,
        orchestrationStatus: 'running',
      }, worker.workspace, { messagesLoaded: true })
      session.isProcessing = true
      internals(sm).sessions.set(id, session)
      return session
    }
    const managed = add('managed-root', 'managed')
    const detached = add('detached-root', 'detached')

    const result = await internals(sm).stopSwarm(worker.id)
    expect(result.stoppedSessionIds).toEqual([managed.id])
    expect(result.detachedSessionIds).toEqual([detached.id])
    expect(managed.orchestrationStatus).toBe('stopped')
    expect(detached.orchestrationStatus).toBe('running')
  })

  it('does not surface a duplicate terminal event twice', async () => {
    const parent = buildParent()
    parent.isProcessing = false
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      mode: 'background',
      spawnReason: 'user-requested',
    })
    sendCalls.length = 0
    emitChild('complete', 'Found login.ts')
    emitChild('complete', 'Found login.ts')
    await flush()
    expect(sendCalls).toHaveLength(1)
  })

  it('keeps the coordinator running until every managed child reaches a terminal state', () => {
    const parent = buildParent()
    parent.orchestrationId = 'orch'
    parent.orchestrationRootSessionId = parent.id
    parent.orchestrationDepth = 0
    parent.orchestrationLifecycle = 'managed'
    parent.orchestrationStatus = 'running'
    for (const id of ['child-a', 'child-b']) {
      const child = createManagedSession({
        id,
        parentSessionId: parent.id,
        orchestrationId: 'orch',
        orchestrationRootSessionId: parent.id,
        orchestrationDepth: 1,
        orchestrationLifecycle: 'managed',
        orchestrationStatus: 'running',
      }, parent.workspace, { messagesLoaded: true })
      internals(sm).sessions.set(id, child)
    }

    internals(sm).emitSessionComplete({
      sessionId: parent.id,
      workspaceId: parent.workspace.id,
      reason: 'complete',
      finalMessageId: 'parent-final',
    })
    expect(parent.orchestrationStatus).toBe('running')
    emitChild('complete', 'a', 'child-a')
    expect(parent.orchestrationStatus).toBe('running')
    emitChild('complete', 'b', 'child-b')
    expect(internals(sm).sessions.get(parent.id)?.orchestrationStatus).toBe('completed')
  })

  it('prevents a child from enabling Swarm while its parent is disabled', async () => {
    const parent = buildParent()
    const child = createManagedSession({ id: 'child', parentSessionId: parent.id }, parent.workspace, { messagesLoaded: true })
    internals(sm).sessions.set(child.id, child)
    await expect(internals(sm).updateSessionSwarmEnabled(child.id, true)).rejects.toThrow('parent has Swarm disabled')
  })

  it('wait returns completed + finalText without registering a background chip', async () => {
    const parent = buildParent()
    stubCreateChild()
    const pending = internals(sm).spawnSessionFromTool(parent, {
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
      prompt: 'Find auth flows',
      mode: 'background',
    })
    sendCalls.length = 0
    emitChild('complete', 'Found login.ts')
    await flush()

    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('completed')
    expect(parent.pendingSwarmWakeOrchestrationIds.size).toBe(1)
    expect(sendCalls).toEqual([])
  })

  it('wakes the parent after its turn ends if the child finished mid-turn', async () => {
    const parent = buildParent()
    parent.isProcessing = true
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      spawnReason: 'user-requested',
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
    expect(parent.pendingSwarmWakeOrchestrationIds.size).toBe(0)
  })

  it('wait fails immediately when the child prompt cannot be sent', async () => {
    const parent = buildParent()
    stubCreateChild()
    internals(sm).sendMessage = async () => {
      throw new Error('child prompt rejected')
    }
    const result = await internals(sm).spawnSessionFromTool(parent, {
      spawnReason: 'user-requested',
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
      spawnReason: 'user-requested',
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
