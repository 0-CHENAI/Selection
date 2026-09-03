import { describe, expect, it } from 'bun:test'
import {
  assessSpawnQualification,
  assessSwarmSpawnLimits,
  formatSpawnQualificationFailure,
  extractParallelTrackNames,
  readCurrentTurnSpawnContext,
  synthesizeAutomaticQualification,
  synthesizeFanOutQualification,
  buildBackgroundTaskNudge,
  countLiveSwarmChildren,
  countLiveSwarmNodes,
  countRunningSpawnChildren,
  FIXED_SWARM_TOKEN_BUDGET,
  recoverPersistedSwarmStatus,
  mapCompletionReasonToSpawnStatus,
  mapCompletionReasonToTaskStatus,
  resolveInheritedSwarmEnabled,
  shouldDeferSpawnWake,
  shouldOrphanBackgroundTask,
  shouldWakeOnTaskCompleted,
  waitForChildSessionCompletion,
} from './spawn-session-orchestration.ts'

describe('spawn-session orchestration helpers', () => {
  it('uses an immutable 256 Ki token ceiling for each spawned Swarm agent', () => {
    expect(FIXED_SWARM_TOKEN_BUDGET).toBe(262_144)
  })

  it('marks persisted running Swarms as interrupted instead of restoring ghost workers', () => {
    expect(recoverPersistedSwarmStatus('completed')).toBeUndefined()
    expect(recoverPersistedSwarmStatus('running')).toEqual({
      status: 'need-to-check',
      blocker: expect.stringContaining('application restart'),
    })
  })

  it('inherits the Swarm switch for children and branches while preserving explicit overrides', () => {
    expect(resolveInheritedSwarmEnabled({})).toBe(false)
    expect(resolveInheritedSwarmEnabled({ parent: true })).toBe(true)
    expect(resolveInheritedSwarmEnabled({ branchSource: true })).toBe(true)
    expect(resolveInheritedSwarmEnabled({ requested: false, parent: true, branchSource: true })).toBe(false)
  })

  it('fails closed unless automatic spawning has a complete structured qualification', () => {
    expect(assessSpawnQualification(undefined)).toEqual({
      eligible: false,
      reasons: ['missing qualification contract'],
    })
    expect(formatSpawnQualificationFailure(['missing qualification contract'])).toContain('qualification')
    expect(formatSpawnQualificationFailure(['missing qualification contract'])).toContain('parallelBenefit')
    expect(formatSpawnQualificationFailure(['missing qualification contract'])).not.toContain('spawn_session failed')
    expect(formatSpawnQualificationFailure(['missing qualification contract'], () => 'localized')).toBe('localized')
    expect(assessSpawnQualification({
      tracks: [{
        name: 'code',
        input: 'repo',
        expectedOutput: 'findings',
        evidence: 'tests',
        toolKinds: ['shell'],
      }],
      parallelBenefit: '',
      finalAggregation: '',
    }).eligible).toBe(false)
    expect(assessSpawnQualification({
      tracks: [
        { name: 'code', input: 'repo', expectedOutput: 'findings', evidence: 'tests', toolKinds: ['shell'] },
        { name: 'docs', input: 'spec', expectedOutput: 'gaps', evidence: 'citations', toolKinds: ['browser'] },
      ],
      parallelBenefit: 'The tracks do not depend on each other.',
      finalAggregation: 'The coordinator merges findings and verifies conflicts.',
    })).toEqual({ eligible: true, reasons: [] })
  })

  it('synthesizes a qualification contract from distinct parallel fan-out tracks', () => {
    expect(synthesizeFanOutQualification([
      { name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' },
    ])).toBeUndefined()
    expect(synthesizeFanOutQualification([
      { name: '调研 Hy4-preview 带任务契约', prompt: 'Research Hy4-preview.' },
      { name: '调研 Hy4-preview 带任务契约', prompt: 'Research Hy4-preview again.' },
    ])).toBeUndefined()
    const synthesized = synthesizeFanOutQualification([
      { name: '调研 Hy4-preview', prompt: 'Research Hy4-preview capabilities.' },
      { name: '调研 GLM-5.3', prompt: 'Research GLM-5.3 capabilities.' },
      { name: '调研 Kimi K3', prompt: 'Research Kimi K3 capabilities.' },
    ])
    expect(assessSpawnQualification(synthesized).eligible).toBe(true)
    expect(synthesized?.tracks.map(track => track.name)).toEqual([
      '调研 Hy4-preview',
      '调研 GLM-5.3',
      '调研 Kimi K3',
    ])
  })

  it('extracts named parallel subjects from a coordinator plan', () => {
    expect(extractParallelTrackNames('同时调研三个独立模型')).toEqual([])
    expect(extractParallelTrackNames('我将分别调研 Hy4-preview、GLM-5.3、Kimi K3。然后汇总。')).toEqual([
      'Hy4-preview',
      'GLM-5.3',
      'Kimi K3',
    ])
  })

  it('recovers a sequential first worker from an explicit parallel research request', () => {
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' }],
    })).toBeUndefined()
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview 带任务契约', prompt: 'Research Hy4-preview.' }],
      userText: '帮我看看这段代码',
    })).toBeUndefined()
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: '同时帮我调研一下这个 bug',
    })).toBeUndefined()
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: '调研 auth', prompt: 'Research auth.' }],
      userText: '帮我看看这段代码',
      planningText: '我将分别调研 auth、docs。',
    })).toBeUndefined()
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: '不要同时调研多个模型',
    })).toBeUndefined()
    expect(synthesizeAutomaticQualification({
      candidates: [{ name: 'Research Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: 'Research Hy4-preview and GLM-5.3, but not in parallel',
    })).toBeUndefined()

    const fromUserIntent = synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: '同时调研三个独立模型',
    })
    expect(assessSpawnQualification(fromUserIntent).eligible).toBe(true)
    expect(fromUserIntent?.tracks.map(track => track.name)).toEqual([
      '调研 Hy4-preview',
      'Remaining independent tracks',
    ])

    const fromEnglish = synthesizeAutomaticQualification({
      candidates: [{ name: 'Research Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: 'Research Hy4-preview, GLM-5.3, and Kimi K3 in parallel',
    })
    expect(assessSpawnQualification(fromEnglish).eligible).toBe(true)

    const fromPlan = synthesizeAutomaticQualification({
      candidates: [{ name: '调研 Hy4-preview', prompt: 'Research Hy4-preview.' }],
      userText: '同时调研三个独立模型',
      planningText: '我将分别调研 Hy4-preview、GLM-5.3、Kimi K3。',
    })
    expect(fromPlan?.tracks.map(track => track.name)).toEqual([
      'Hy4-preview',
      'GLM-5.3',
      'Kimi K3',
    ])
  })

  it('reads spawn context from the live user turn, not queued follow-ups', () => {
    expect(readCurrentTurnSpawnContext([
      { role: 'user', content: '同时调研三个独立模型' },
      { role: 'assistant', content: '我将分别调研 Hy4-preview、GLM-5.3、Kimi K3。' },
      { role: 'user', content: '算了先改这句话', isQueued: true },
    ])).toEqual({
      userText: '同时调研三个独立模型',
      planningText: '我将分别调研 Hy4-preview、GLM-5.3、Kimi K3。',
    })
    expect(readCurrentTurnSpawnContext([
      { role: 'user', content: 'hidden user', hidden: true },
      { role: 'user', content: '同时调研三个独立模型' },
    ]).userText).toBe('同时调研三个独立模型')
    expect(readCurrentTurnSpawnContext([
      { role: 'user', content: '同时调研三个独立模型' },
      { role: 'user', content: '[managed-swarm-settled]', hidden: true },
      { role: 'assistant', content: '继续派发 worker' },
    ])).toEqual({ userText: '', planningText: '' })
  })

  it('enforces direct concurrency, depth, and whole-swarm live-node limits', () => {
    const sessions = [
      { id: 'root', isProcessing: true, orchestrationId: 'orch', orchestrationStatus: 'running' as const },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `child-${index}`,
        parentSessionId: 'root',
        isProcessing: true,
        orchestrationId: 'orch',
        orchestrationDepth: 1,
        orchestrationStatus: 'running' as const,
      })),
    ]
    expect(countLiveSwarmChildren(sessions, 'root')).toBe(3)
    expect(countLiveSwarmNodes(sessions, 'orch')).toBe(4)
    expect(assessSwarmSpawnLimits({
      sessions,
      parentSessionId: 'root',
      parentDepth: 0,
      orchestrationId: 'orch',
    })).toEqual(expect.objectContaining({ allowed: false, error: expect.stringContaining('concurrency') }))

    expect(assessSwarmSpawnLimits({
      sessions: [],
      parentSessionId: 'grandchild',
      parentDepth: 2,
      orchestrationId: 'orch',
    })).toEqual(expect.objectContaining({ allowed: false, error: expect.stringContaining('depth') }))

    const twelve = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      isProcessing: true,
      orchestrationId: 'orch',
      orchestrationStatus: 'running' as const,
    }))
    expect(assessSwarmSpawnLimits({
      sessions: twelve,
      parentSessionId: 'node-0',
      parentDepth: 0,
      orchestrationId: 'orch',
    })).toEqual(expect.objectContaining({ allowed: false, error: expect.stringContaining('live-node') }))
  })

  it('counts reservations so concurrent requests cannot race past a limit', () => {
    expect(assessSwarmSpawnLimits({
      sessions: [],
      parentSessionId: 'root',
      parentDepth: 0,
      orchestrationId: 'orch',
      pendingChildren: 3,
    }).allowed).toBe(false)
    expect(assessSwarmSpawnLimits({
      sessions: [],
      parentSessionId: 'root',
      parentDepth: 0,
      orchestrationId: 'orch',
      pendingNodes: 12,
    }).allowed).toBe(false)
  })

  it('maps completion reasons', () => {
    expect(mapCompletionReasonToSpawnStatus('complete')).toBe('completed')
    expect(mapCompletionReasonToSpawnStatus('interrupted')).toBe('interrupted')
    expect(mapCompletionReasonToSpawnStatus('error')).toBe('failed')
    expect(mapCompletionReasonToTaskStatus('complete')).toBe('completed')
    expect(mapCompletionReasonToTaskStatus('interrupted')).toBe('stopped')
    expect(mapCompletionReasonToTaskStatus('timeout')).toBe('failed')
  })

  it('counts only running spawn_session children', () => {
    expect(countRunningSpawnChildren({
      registry: [
        { taskId: 'a', status: 'running', source: 'spawn_session' },
        { taskId: 'b', status: 'running', source: 'spawn_session' },
        { taskId: 'c', status: 'completed', source: 'spawn_session' },
        { taskId: 'd', status: 'running' },
      ],
    })).toBe(2)
    expect(countRunningSpawnChildren({ registry: [] })).toBe(0)
  })

  it('includes wait-mode live children that are not in the registry', () => {
    expect(countRunningSpawnChildren({
      registry: [],
      parentId: 'parent',
      sessions: [
        { id: 'parent', isProcessing: true },
        { id: 'wait-child', isProcessing: true, parentSessionId: 'parent' },
      ],
    })).toBe(1)
  })

  it('does not double-count a background child that is both registered and live', () => {
    expect(countRunningSpawnChildren({
      registry: [{ taskId: 'child', status: 'running', source: 'spawn_session' }],
      parentId: 'parent',
      sessions: [
        { id: 'child', isProcessing: true, parentSessionId: 'parent' },
      ],
    })).toBe(1)
  })

  it('skips stale registry entries whose live session is idle', () => {
    expect(countRunningSpawnChildren({
      registry: [{ taskId: 'stale', status: 'running', source: 'spawn_session' }],
      parentId: 'parent',
      sessions: [
        { id: 'stale', isProcessing: false, parentSessionId: 'parent' },
      ],
    })).toBe(0)
  })

  it('does not count Conductor node sessions as spawn children', () => {
    expect(countRunningSpawnChildren({
      registry: [],
      parentId: 'orch',
      sessions: [
        { id: 'node-1', isProcessing: true, parentSessionId: 'orch', taskNodeId: 'n1' },
      ],
    })).toBe(0)
  })

  it('never orphans spawn_session children', () => {
    expect(shouldOrphanBackgroundTask({ status: 'running', source: 'spawn_session' }, false)).toBe(false)
    expect(shouldOrphanBackgroundTask({ status: 'running' }, false)).toBe(true)
    expect(shouldOrphanBackgroundTask({ status: 'running' }, true)).toBe(false)
  })

  it('wakes spawn children even when keep-alive is off', () => {
    expect(shouldWakeOnTaskCompleted({
      isProcessing: false,
      wasAlreadyTerminal: false,
      keepAlive: false,
      source: 'spawn_session',
    })).toBe(true)
    expect(shouldWakeOnTaskCompleted({
      isProcessing: false,
      wasAlreadyTerminal: false,
      keepAlive: false,
    })).toBe(false)
    expect(shouldWakeOnTaskCompleted({
      isProcessing: true,
      wasAlreadyTerminal: false,
      keepAlive: true,
      source: 'spawn_session',
    })).toBe(false)
    expect(shouldDeferSpawnWake({
      isProcessing: true,
      wasAlreadyTerminal: false,
      source: 'spawn_session',
    })).toBe(true)
    expect(shouldDeferSpawnWake({
      isProcessing: false,
      wasAlreadyTerminal: false,
      source: 'spawn_session',
    })).toBe(false)
  })

  it('builds a session-id nudge without telling the model to re-spawn', () => {
    const nudge = buildBackgroundTaskNudge({
      status: 'completed',
      taskId: 'child-1',
      intent: 'Find auth',
      summary: 'Found three files',
    })
    expect(nudge).toContain('Session ID: child-1')
    expect(nudge).toContain('Found three files')
    expect(nudge).toContain('get_session_info')
    expect(nudge).toContain('Do NOT spawn another background session')
    expect(nudge).not.toContain('Read that output file')
  })

  it('wait resolves on child completion, timeout, and parent interrupt', async () => {
    const listeners = new Set<(evt: { sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout'; finalText?: string }) => void>()
    const subscribe = (listener: (evt: { sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout'; finalText?: string }) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    const done = waitForChildSessionCompletion({
      childSessionId: 'c1',
      timeoutMs: 5_000,
      isParentInterrupted: () => false,
      subscribe,
    })
    for (const listener of listeners) listener({ sessionId: 'c1', reason: 'complete', finalText: 'ok' })
    await expect(done).resolves.toEqual({ status: 'completed', finalText: 'ok' })

    const timedOut = waitForChildSessionCompletion({
      childSessionId: 'c2',
      timeoutMs: 20,
      isParentInterrupted: () => false,
      subscribe,
    })
    await expect(timedOut).resolves.toEqual({ status: 'timeout' })

    let interrupted = false
    const aborting = waitForChildSessionCompletion({
      childSessionId: 'c3',
      timeoutMs: 5_000,
      isParentInterrupted: () => interrupted,
      subscribe,
    })
    interrupted = true
    await expect(aborting).resolves.toEqual({ status: 'interrupted' })

    let settleEarly: ((result: { status: 'failed' }) => void) | undefined
    const failed = waitForChildSessionCompletion({
      childSessionId: 'c4',
      timeoutMs: 5_000,
      isParentInterrupted: () => false,
      subscribe,
      onAttach: (settle) => { settleEarly = settle },
    })
    settleEarly?.({ status: 'failed' })
    await expect(failed).resolves.toEqual({ status: 'failed' })
  })
})
