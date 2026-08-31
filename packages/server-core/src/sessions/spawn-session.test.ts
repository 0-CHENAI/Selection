import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SpawnSessionReason, SpawnSessionRequest, SpawnSessionResult } from '@craft-agent/shared/agent'
import { SessionManager, createManagedSession, type SessionCompletionEvent } from './SessionManager.ts'
import { FIXED_SWARM_TOKEN_BUDGET } from './spawn-session-orchestration.ts'

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
  getSwarmRunDetails: SessionManager['getSwarmRunDetails']
  updateSessionSwarmEnabled: SessionManager['updateSessionSwarmEnabled']
  updateSwarmTokenBudget: SessionManager['updateSwarmTokenBudget']
  onProcessingStopped: (sessionId: string, reason: 'complete' | 'interrupted' | 'error' | 'timeout') => Promise<void>
  recoverPersistedSwarmSessions: () => void
  issueSpawnQualificationCredentials: (
    managed: ReturnType<typeof createManagedSession>,
    reason: SpawnSessionReason,
    count?: number,
  ) => void
  prepareSpawnQualificationCredentials: (
    managed: ReturnType<typeof createManagedSession>,
    userAuthorizedSpawn: boolean,
  ) => void
  resolveSpawnQualificationCredential: (
    managed: ReturnType<typeof createManagedSession>,
    reason: SpawnSessionReason,
    supplied?: string,
  ) => string | undefined
  spawnQualificationCredentials: Map<string, Map<string, unknown>>
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
    // Lifecycle tests invoke the private entry point without a real sendMessage
    // turn. Seed the same ephemeral server capabilities that production issues.
    internals(sm).issueSpawnQualificationCredentials(managed, 'automatic')
    internals(sm).issueSpawnQualificationCredentials(managed, 'user-requested')
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

  function emitChild(reason: SessionCompletionEvent['reason'], finalText?: string, childId = 'child', totalTokens?: number) {
    internals(sm).emitSessionComplete({
      sessionId: childId,
      workspaceId: 'ws_test',
      generation: internals(sm).sessions.get(childId)?.processingGeneration ?? 0,
      reason,
      finalText,
      ...(totalTokens === undefined ? {} : {
        tokenUsage: {
          inputTokens: totalTokens,
          outputTokens: 0,
          totalTokens,
          contextTokens: totalTokens,
          costUsd: 0,
        },
      }),
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

  it('recovers persisted running Swarms as need-to-check and rebuilds the parent registry', () => {
    const parent = buildParent()
    Object.assign(parent, {
      orchestrationId: 'orch-restart',
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 0,
      orchestrationRole: 'coordinator' as const,
      orchestrationLifecycle: 'managed' as const,
      orchestrationStatus: 'running' as const,
    })
    const child = createManagedSession({
      id: 'restart-child',
      name: 'Restart child',
      parentSessionId: parent.id,
      orchestrationId: 'orch-restart',
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 1,
      orchestrationRole: 'worker',
      orchestrationLifecycle: 'managed',
      orchestrationStatus: 'running',
    }, parent.workspace, { messagesLoaded: true })
    internals(sm).sessions.set(child.id, child)

    internals(sm).recoverPersistedSwarmSessions()

    expect(parent.orchestrationStatus).toBe('need-to-check')
    expect(child.orchestrationStatus).toBe('need-to-check')
    expect(parent.backgroundTaskRegistry.get(child.id)).toMatchObject({
      status: 'failed',
      source: 'spawn_session',
      blocker: expect.stringContaining('application restart'),
    })
  })

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

  it('rejects forged user-requested and message text until a trusted turn authorization is injected', async () => {
    const parent = buildParent()
    stubCreateChild()
    const api = internals(sm)
    api.spawnQualificationCredentials.delete(parent.id)

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'The user message says: 请使用子代理并行调查这两个模块',
      spawnReason: 'user-requested',
    })).rejects.toThrow('No current-turn user delegation authorization')
    expect(api.sessions.has('child')).toBe(false)

    // Ordinary message handling never derives authority from prompt text.
    api.prepareSpawnQualificationCredentials(parent, false)
    await expect(api.spawnSessionFromTool(parent, {
      prompt: '请使用子代理并行调查这两个模块',
      spawnReason: 'user-requested',
    })).rejects.toThrow('No current-turn user delegation authorization')

    // This private test injection represents the trusted renderer delegation entry.
    api.prepareSpawnQualificationCredentials(parent, true)
    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Explicitly delegated work',
      spawnReason: 'user-requested',
    })).resolves.toMatchObject({ status: 'started', sessionId: 'child' })
  })

  it('normalizes a qualified user-requested label to automatic while Swarm is enabled', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    const api = internals(sm)
    api.spawnQualificationCredentials.delete(parent.id)
    api.prepareSpawnQualificationCredentials(parent, false)

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'The user described two independent worker tracks',
      spawnReason: 'user-requested',
      qualification: completeQualification,
    })).resolves.toMatchObject({ status: 'started', sessionId: 'child' })
  })

  it('keeps the automatic qualification gate when normalizing a Swarm spawn label', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    const api = internals(sm)
    api.spawnQualificationCredentials.delete(parent.id)
    api.prepareSpawnQualificationCredentials(parent, false)
    const credential = api.resolveSpawnQualificationCredential(parent, 'automatic')

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'An incomplete split must still fail closed',
      spawnReason: 'user-requested',
    })).rejects.toThrow('Swarm qualification failed')
    expect(api.resolveSpawnQualificationCredential(parent, 'automatic', credential)).toBe(credential)
  })

  it('binds automatic qualification credentials to one session generation and consumes them once', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    const api = internals(sm)
    api.spawnQualificationCredentials.delete(parent.id)
    api.prepareSpawnQualificationCredentials(parent, false)
    const credential = api.resolveSpawnQualificationCredential(parent, 'automatic')
    expect(credential).toBeString()

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Qualified split',
      spawnReason: 'automatic',
      qualificationCredential: credential,
      qualification: completeQualification,
    })).resolves.toMatchObject({ status: 'started', sessionId: 'child' })
    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Replay the same authorization',
      spawnReason: 'automatic',
      qualificationCredential: credential,
      qualification: completeQualification,
    })).rejects.toThrow('No current-turn Swarm qualification credential')

    api.prepareSpawnQualificationCredentials(parent, false)
    const stale = api.resolveSpawnQualificationCredential(parent, 'automatic')
    expect(stale).toBeString()
    parent.processingGeneration += 1
    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Use stale generation',
      spawnReason: 'automatic',
      qualificationCredential: stale,
      qualification: completeQualification,
    })).rejects.toThrow('No current-turn Swarm qualification credential')
  })

  it('keeps a valid automatic credential unconsumed until the qualification contract is complete', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    const api = internals(sm)
    api.spawnQualificationCredentials.delete(parent.id)
    api.prepareSpawnQualificationCredentials(parent, false)
    const credential = api.resolveSpawnQualificationCredential(parent, 'automatic')

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Incomplete split',
      spawnReason: 'automatic',
      qualificationCredential: credential,
    })).rejects.toThrow('Swarm qualification failed')
    expect(api.resolveSpawnQualificationCredential(parent, 'automatic', credential)).toBe(credential)

    await expect(api.spawnSessionFromTool(parent, {
      prompt: 'Corrected split',
      spawnReason: 'automatic',
      qualificationCredential: credential,
      qualification: completeQualification,
    })).resolves.toMatchObject({ status: 'started', sessionId: 'child' })
    expect(api.resolveSpawnQualificationCredential(parent, 'automatic', credential)).toBeUndefined()
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

  it('aggregates the coordinator and every managed or detached descendant for run details', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    const result = await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Investigate code',
      spawnReason: 'automatic',
      qualification: completeQualification,
      mode: 'background',
      role: 'reviewer',
      lifecycle: 'detached',
    })
    const orchestrationId = result.orchestrationId!
    const child = internals(sm).sessions.get('child')!
    child.model = 'worker-model'
    parent.orchestrationTokensUsed = 42
    // Legacy metadata may contain an editable value; run details must ignore it.
    parent.orchestrationTokenBudget = 100
    parent.backgroundTaskOutputs.set(child.id, {
      outputFile: '',
      summary: 'child summary',
      status: 'completed',
      completedAt: Date.now(),
    })

    const grandchild = createManagedSession({
      id: 'grandchild',
      name: 'Nested worker',
      parentSessionId: child.id,
      orchestrationId,
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 2,
      orchestrationRole: 'worker',
      orchestrationLifecycle: 'managed',
      orchestrationStatus: 'completed',
      model: 'nested-model',
      hidden: true,
    }, parent.workspace, { messagesLoaded: true })
    internals(sm).sessions.set(grandchild.id, grandchild)
    child.backgroundTaskRegistry.set(grandchild.id, {
      taskId: grandchild.id,
      source: 'spawn_session',
      status: 'completed',
      startTime: Date.now() - 2_000,
      completedAt: Date.now(),
      orchestrationId,
      rootSessionId: parent.id,
      parentSessionId: child.id,
      depth: 2,
      role: 'worker',
      lifecycle: 'managed',
    })
    child.backgroundTaskOutputs.set(grandchild.id, {
      outputFile: '',
      summary: 'nested summary',
      status: 'completed',
      completedAt: Date.now(),
    })

    expect(internals(sm).getSwarmRunDetails(parent.id, parent.workspace.id)).toMatchObject({
      orchestrationId,
      rootSessionId: parent.id,
      coordinatorSessionId: parent.id,
      tokensUsed: 42,
      tokenBudget: FIXED_SWARM_TOKEN_BUDGET,
      nodes: [
        { sessionId: parent.id, role: 'coordinator', depth: 0 },
        { sessionId: child.id, role: 'reviewer', depth: 1, lifecycle: 'detached', summary: 'child summary' },
        { sessionId: grandchild.id, role: 'worker', depth: 2, lifecycle: 'managed', summary: 'nested summary' },
      ],
    })
    expect(internals(sm).getSwarmRunDetails(child.id, parent.workspace.id)).toBeNull()
    expect(internals(sm).getSwarmRunDetails(parent.id, 'other-workspace')).toBeNull()
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

  it('accounts temporary Swarm tokens once and enforces the immutable 256 Ki budget', async () => {
    const parent = buildParent()
    parent.swarmEnabled = true
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      mode: 'background',
      spawnReason: 'user-requested',
    })
    expect(parent.orchestrationTokenBudget).toBe(FIXED_SWARM_TOKEN_BUDGET)
    emitChild('complete', 'done', 'child', FIXED_SWARM_TOKEN_BUDGET)
    emitChild('complete', 'done', 'child', FIXED_SWARM_TOKEN_BUDGET)
    await flush()

    expect(parent.orchestrationTokensUsed).toBe(FIXED_SWARM_TOKEN_BUDGET)
    expect(parent.orchestrationStatus).toBe('need-to-check')
    expect(parent.orchestrationBlocker).toContain(`${FIXED_SWARM_TOKEN_BUDGET}/${FIXED_SWARM_TOKEN_BUDGET}`)
    await expect(internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Another worker',
      spawnReason: 'user-requested',
    })).rejects.toThrow('token budget reached')

    await expect(internals(sm).updateSwarmTokenBudget(parent.id, FIXED_SWARM_TOKEN_BUDGET * 2))
      .rejects.toThrow(`fixed at ${FIXED_SWARM_TOKEN_BUDGET}`)
    expect(parent.orchestrationTokenBudget).toBe(FIXED_SWARM_TOKEN_BUDGET)
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
      parent.backgroundTaskRegistry.set(id, {
        taskId: id,
        startTime: Date.now(),
        status: 'running',
        source: 'spawn_session',
        orchestrationId: 'orch',
        lifecycle: 'managed',
      })
    }

    internals(sm).emitSessionComplete({
      sessionId: parent.id,
      workspaceId: parent.workspace.id,
      generation: parent.processingGeneration,
      reason: 'complete',
      finalMessageId: 'parent-final',
    })
    expect(parent.orchestrationStatus).toBe('running')
    emitChild('complete', 'a', 'child-a')
    expect(parent.orchestrationStatus).toBe('running')
    emitChild('complete', 'b', 'child-b')
    expect(internals(sm).sessions.get(parent.id)?.orchestrationStatus).toBe('running')
    expect(parent.pendingSwarmWakeOrchestrationIds).toEqual(new Set(['orch']))

    parent.isProcessing = false
    internals(sm).flushDeferredSpawnWakes(parent)
    expect(sendCalls.filter(call => call.id === parent.id)).toHaveLength(1)
    expect(parent.orchestrationStatus).toBe('running')

    internals(sm).emitSessionComplete({
      sessionId: parent.id,
      workspaceId: parent.workspace.id,
      generation: parent.processingGeneration,
      reason: 'complete',
      finalMessageId: 'parent-aggregate-final',
      finalText: 'aggregated',
    })
    expect(internals(sm).sessions.get(parent.id)?.orchestrationStatus).toBe('completed')
  })

  it('surfaces a persisted child final message when the provider omits completion finalText', () => {
    const parent = buildParent()
    parent.isProcessing = false
    parent.orchestrationId = 'orch-fallback'
    parent.orchestrationRootSessionId = parent.id
    parent.orchestrationDepth = 0
    parent.orchestrationLifecycle = 'managed'
    parent.orchestrationStatus = 'running'
    const child = createManagedSession({
      id: 'child-fallback',
      name: 'Fallback worker',
      parentSessionId: parent.id,
      orchestrationId: 'orch-fallback',
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 1,
      orchestrationLifecycle: 'managed',
      orchestrationStatus: 'running',
    }, parent.workspace, { messagesLoaded: true })
    child.messages.push({
      id: 'child-final',
      role: 'assistant',
      content: 'persisted worker result',
      timestamp: Date.now(),
    })
    internals(sm).sessions.set(child.id, child)
    parent.backgroundTaskRegistry.set(child.id, {
      taskId: child.id,
      startTime: Date.now(),
      status: 'running',
      source: 'spawn_session',
      orchestrationId: 'orch-fallback',
      lifecycle: 'managed',
    })

    emitChild('complete', undefined, child.id)

    expect(parent.backgroundTaskOutputs.get(child.id)?.summary).toBe('persisted worker result')
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]?.msg).toContain('completed — persisted worker result')
  })

  it('waits for a nested coordinator aggregation before reporting its subtree terminal', () => {
    const root = buildParent('root')
    root.isProcessing = false
    root.orchestrationId = 'orch-nested'
    root.orchestrationRootSessionId = root.id
    root.orchestrationDepth = 0
    root.orchestrationLifecycle = 'managed'
    root.orchestrationStatus = 'running'

    const coordinator = createManagedSession({
      id: 'coordinator',
      parentSessionId: root.id,
      orchestrationId: 'orch-nested',
      orchestrationRootSessionId: root.id,
      orchestrationDepth: 1,
      orchestrationLifecycle: 'managed',
      orchestrationRole: 'coordinator',
      orchestrationStatus: 'running',
    }, root.workspace, { messagesLoaded: true })
    coordinator.isProcessing = false
    const grandchild = createManagedSession({
      id: 'grandchild',
      parentSessionId: coordinator.id,
      orchestrationId: 'orch-nested',
      orchestrationRootSessionId: root.id,
      orchestrationDepth: 2,
      orchestrationLifecycle: 'managed',
      orchestrationRole: 'worker',
      orchestrationStatus: 'running',
    }, root.workspace, { messagesLoaded: true })
    grandchild.isProcessing = false
    internals(sm).sessions.set(coordinator.id, coordinator)
    internals(sm).sessions.set(grandchild.id, grandchild)
    root.backgroundTaskRegistry.set(coordinator.id, {
      taskId: coordinator.id,
      startTime: Date.now(),
      status: 'running',
      source: 'spawn_session',
      orchestrationId: 'orch-nested',
      lifecycle: 'managed',
    })
    coordinator.backgroundTaskRegistry.set(grandchild.id, {
      taskId: grandchild.id,
      startTime: Date.now(),
      status: 'running',
      source: 'spawn_session',
      orchestrationId: 'orch-nested',
      lifecycle: 'managed',
    })

    internals(sm).emitSessionComplete({
      sessionId: coordinator.id,
      workspaceId: root.workspace.id,
      generation: coordinator.processingGeneration,
      reason: 'complete',
      finalMessageId: 'coordinator-dispatch',
      finalText: 'worker started',
    })
    expect(root.backgroundTaskRegistry.get(coordinator.id)?.status).toBe('running')

    emitChild('complete', 'leaf result', grandchild.id)
    emitChild('complete', 'leaf result', grandchild.id)
    expect(coordinator.orchestrationStatus).toBe('running')
    expect(root.backgroundTaskRegistry.get(coordinator.id)?.status).toBe('running')
    expect(sendCalls.filter(call => call.id === coordinator.id)).toHaveLength(1)

    internals(sm).emitSessionComplete({
      sessionId: coordinator.id,
      workspaceId: root.workspace.id,
      generation: coordinator.processingGeneration,
      reason: 'complete',
      finalMessageId: 'coordinator-aggregate',
      finalText: 'nested aggregate',
    })
    expect(coordinator.orchestrationStatus).toBe('completed')
    expect(root.backgroundTaskRegistry.get(coordinator.id)?.status).toBe('completed')
    expect(root.orchestrationStatus).toBe('running')
    expect(sendCalls.filter(call => call.id === root.id)).toHaveLength(1)

    internals(sm).emitSessionComplete({
      sessionId: root.id,
      workspaceId: root.workspace.id,
      generation: root.processingGeneration,
      reason: 'complete',
      finalMessageId: 'root-aggregate',
      finalText: 'root aggregate',
    })
    expect(internals(sm).sessions.get(root.id)?.orchestrationStatus).toBe('completed')
  })

  it('wait mode does not resolve on a nested coordinator dispatch turn', async () => {
    const parent = buildParent()
    stubCreateChild('coordinator')
    const pending = internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Coordinate nested work',
      mode: 'wait',
      spawnReason: 'user-requested',
      timeoutMs: 2_000,
      role: 'coordinator',
    })
    await flush()
    sendCalls.length = 0
    const coordinator = internals(sm).sessions.get('coordinator')!
    coordinator.isProcessing = false
    const grandchild = createManagedSession({
      id: 'wait-grandchild',
      parentSessionId: coordinator.id,
      orchestrationId: coordinator.orchestrationId,
      orchestrationRootSessionId: parent.id,
      orchestrationDepth: 2,
      orchestrationLifecycle: 'managed',
      orchestrationRole: 'worker',
      orchestrationStatus: 'running',
    }, parent.workspace, { messagesLoaded: true })
    internals(sm).sessions.set(grandchild.id, grandchild)
    coordinator.backgroundTaskRegistry.set(grandchild.id, {
      taskId: grandchild.id,
      startTime: Date.now(),
      status: 'running',
      source: 'spawn_session',
      orchestrationId: coordinator.orchestrationId,
      lifecycle: 'managed',
    })

    let settled = false
    void pending.then(() => { settled = true })
    internals(sm).emitSessionComplete({
      sessionId: coordinator.id,
      workspaceId: parent.workspace.id,
      generation: coordinator.processingGeneration,
      reason: 'complete',
      finalMessageId: 'dispatch-turn',
      finalText: 'worker launched',
    })
    await flush()
    expect(settled).toBe(false)

    emitChild('complete', 'leaf result', grandchild.id)
    await flush()
    expect(settled).toBe(false)
    expect(sendCalls.filter(call => call.id === coordinator.id)).toHaveLength(1)

    internals(sm).emitSessionComplete({
      sessionId: coordinator.id,
      workspaceId: parent.workspace.id,
      generation: coordinator.processingGeneration,
      reason: 'complete',
      finalMessageId: 'aggregate-turn',
      finalText: 'nested aggregate',
    })
    await expect(pending).resolves.toMatchObject({
      sessionId: coordinator.id,
      status: 'completed',
      finalText: 'nested aggregate',
    })
  })

  it('keeps a blocked child and its parent need-to-check without sending an aggregation wake', async () => {
    const parent = buildParent()
    parent.isProcessing = false
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      mode: 'background',
      spawnReason: 'user-requested',
    })

    emitChild('error', 'worker failed')
    emitChild('error', 'worker failed')

    expect(internals(sm).sessions.get('child')?.orchestrationStatus).toBe('need-to-check')
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('failed')
    expect(parent.orchestrationStatus).toBe('need-to-check')
    expect(parent.orchestrationBlocker).toContain('worker failed')
    expect(sendCalls.filter(call => call.id === parent.id)).toHaveLength(0)
  })

  it('moves the coordinator to need-to-check when the aggregation nudge cannot be sent', async () => {
    const parent = buildParent()
    parent.isProcessing = false
    stubCreateChild()
    await internals(sm).spawnSessionFromTool(parent, {
      prompt: 'Find auth flows',
      mode: 'background',
      spawnReason: 'user-requested',
    })
    internals(sm).sendMessage = async (id) => {
      if (id === parent.id) throw new Error('aggregation rejected')
    }

    emitChild('complete', 'worker result')
    await flush()

    expect(parent.orchestrationStatus).toBe('need-to-check')
    expect(parent.orchestrationBlocker).toContain('aggregation rejected')
  })

  it('prevents a child from enabling Swarm while its parent is disabled', async () => {
    const parent = buildParent()
    const child = createManagedSession({ id: 'child', parentSessionId: parent.id }, parent.workspace, { messagesLoaded: true })
    internals(sm).sessions.set(child.id, child)
    await expect(internals(sm).updateSessionSwarmEnabled(child.id, true)).rejects.toThrow('parent has Swarm disabled')
  })

  it('refreshes a runtime after an in-flight Swarm toggle before the next turn', async () => {
    const parent = buildParent()
    let runtimeProcessing = true
    let disposeCalls = 0
    parent.agent = {
      isProcessing: () => runtimeProcessing,
      disposeForRestart: async () => { disposeCalls += 1 },
    } as never

    await internals(sm).updateSessionSwarmEnabled(parent.id, true)
    expect(parent.swarmEnabled).toBe(true)
    expect(parent.agent).not.toBeNull()
    expect(disposeCalls).toBe(0)

    runtimeProcessing = false
    await internals(sm).onProcessingStopped(parent.id, 'complete')
    expect(disposeCalls).toBe(1)
    expect(parent.agent).toBeNull()
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
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('running')
    emitChild('complete', 'late result')
    await flush()
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('completed')
    expect(parent.pendingSwarmWakeOrchestrationIds.size).toBe(1)
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
    expect(parent.backgroundTaskRegistry.get('child')?.status).toBe('running')
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
