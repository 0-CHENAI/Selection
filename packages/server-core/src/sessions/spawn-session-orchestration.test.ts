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
  buildManagedSwarmCoverageMarker,
  buildManagedSwarmNudge,
  buildManagedSwarmResultReference,
  buildManagedSwarmSynthesisSectionMarkers,
  buildManagedSwarmWorkerSectionMarkers,
  type ManagedSwarmAggregationChild,
  assessManagedSwarmAggregation,
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
  function workerSection(sessionId: string, content: string): string[] {
    const markers = buildManagedSwarmWorkerSectionMarkers(sessionId)
    return [markers.start, content, markers.end]
  }

  function synthesisSection(content: string): string[] {
    const markers = buildManagedSwarmSynthesisSectionMarkers()
    return [markers.start, content, markers.end]
  }

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

  it('requires source-bound worker coverage while allowing synthesis', () => {
    const finalAggregation = 'Compare all worker evidence and resolve conflicts.'
    const workerSummary = [
      '代码审查确认身份令牌只保存在内存中，刷新页面后会丢失。',
      '回归测试覆盖了登录、刷新和退出流程，三条路径全部通过。',
      '因此应优先修复持久化边界，并保留现有退出时清理令牌的行为。',
    ].join('')
    const children = [
      { sessionId: 'worker-a', status: 'completed', summary: workerSummary },
      { sessionId: 'worker-b', status: 'failed' },
    ] satisfies ManagedSwarmAggregationChild[]
    const marker = buildManagedSwarmCoverageMarker({
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })
    const workerResultRef = buildManagedSwarmResultReference(children[0])!
    const valid = [
      ...workerSection('worker-a', `worker-a completed：${workerResultRef}。代码证据表明登录令牌缺少持久化，刷新后会丢失；应修复存储边界并保留退出清理。`),
      'worker-b failed：执行失败，结论保留该风险。',
      ...synthesisSection('综合结论：身份令牌需要持久化修复，同时必须保留失败 worker 带来的证据缺口和决策风险。'),
      marker,
    ].join('\n')

    expect(assessManagedSwarmAggregation({
      finalText: valid,
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toEqual({ valid: true, reasons: [] })
    expect(assessManagedSwarmAggregation({
      finalText: `worker-a completed。需要我帮你汇总剩余报告吗？\n${marker}`,
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('worker-b'),
        expect.stringContaining('structured result section for worker worker-a'),
      ]),
    })
    expect(assessManagedSwarmAggregation({
      finalText: valid,
      orchestrationId: 'orch-1',
      finalAggregation: 'A different aggregation contract.',
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('declared aggregation contract'),
      ]),
    })
    expect(assessManagedSwarmAggregation({
      finalText: [
        'worker-a completed：给出代码证据。',
        'worker-b：仅提供了部分证据。',
        '状态概览：failed。',
        '综合结论：两条结果存在上述限制。',
        marker,
      ].join('\n'),
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('worker-b with status failed on the same line'),
      ]),
    })

    expect(assessManagedSwarmAggregation({
      finalText: [
        ...workerSection('worker-a', `worker-a completed：${workerResultRef}，已纳入最终结论。`),
        'worker-b failed：执行失败，结论保留该风险。',
        ...synthesisSection('综合结论：身份令牌需要持久化修复，同时必须保留失败 worker 带来的证据缺口和决策风险。'),
        marker,
      ].join('\n'),
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('does not explain the concrete contribution from worker worker-a'),
      ]),
    })

    expect(assessManagedSwarmAggregation({
      finalText: [
        ...workerSection('worker-a', [
          'worker-a completed：这里没有给出具体发现或建议。',
          `<!-- ${workerResultRef} -->`,
        ].join('\n')),
        'worker-b failed：执行失败，结论保留该风险。',
        ...synthesisSection('综合结论：身份令牌需要持久化修复，同时必须保留失败 worker 带来的证据缺口和决策风险。'),
        marker,
      ].join('\n'),
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('does not cite the result from worker worker-a'),
      ]),
    })

    expect(assessManagedSwarmAggregation({
      finalText: [
        ...workerSection('worker-a', `worker-a completed：${workerResultRef}。代码证据表明登录令牌缺少持久化，刷新后会丢失；应修复存储边界并保留退出清理。`),
        'worker-b failed：执行失败，结论保留该风险。',
        ...synthesisSection('综合结论：身份令牌需要持久化修复，同时必须保留失败 worker 带来的证据缺口和决策风险。'),
        '完整报告见各子代理会话的最终回复。',
        marker,
      ].join('\n'),
      orchestrationId: 'orch-1',
      finalAggregation,
      children,
    })).toEqual({ valid: true, reasons: [] })
  })

  it('puts the persisted contract, long worker output, and exact marker in the aggregation nudge', () => {
    const longSummary = 'evidence '.repeat(2_000)
    const nudge = buildManagedSwarmNudge({
      orchestrationId: 'orch-long',
      finalAggregation: 'Reconcile code and documentation evidence.',
      children: [
        { sessionId: 'worker-a', status: 'completed', summary: longSummary },
      ],
    })

    expect(nudge).toContain('Reconcile code and documentation evidence.')
    expect(nudge).toContain(longSummary)
    const resultRef = buildManagedSwarmResultReference({
      sessionId: 'worker-a',
      status: 'completed',
      summary: longSummary,
    })!
    expect(nudge).toContain('Worker completion results follow')
    expect(nudge).toContain(resultRef)
    expect(nudge).toContain(buildManagedSwarmCoverageMarker({
      orchestrationId: 'orch-long',
      finalAggregation: 'Reconcile code and documentation evidence.',
      children: [{ sessionId: 'worker-a', status: 'completed', summary: longSummary }],
    }))
  })

  it('requires a source-bound contribution from every long worker result', () => {
    const finalAggregation = 'Compare all three model reports and recommend one.'
    const children = [
      {
        sessionId: 'hy4-session',
        status: 'completed' as const,
        summary: 'HY4_UNIQUE_FACT：官方技术报告给出的上下文上限是一百万 token，工具调用需要显式开启。独立测试确认长文本检索稳定，但多模态吞吐下降明显。完整评估建议先压测真实工作负载。',
      },
      {
        sessionId: 'glm-session',
        status: 'completed' as const,
        summary: 'GLM_UNIQUE_FACT：公开权重允许本地部署，许可证对商业使用给出了明确范围。代码任务测试表现稳定，函数调用在复杂 schema 下仍需校验。完整评估建议核对部署成本。',
      },
      {
        sessionId: 'kimi-session',
        status: 'completed' as const,
        summary: 'KIMI_UNIQUE_FACT：稀疏专家结构降低了推理成本，长上下文采用原生训练方案。搜索任务测试覆盖中文资料较好，英文引用仍需交叉验证。完整评估建议关注服务可用性。',
      },
    ] satisfies ManagedSwarmAggregationChild[]
    const marker = buildManagedSwarmCoverageMarker({
      orchestrationId: 'orch-models',
      finalAggregation,
      children,
    })
    const contributions = [
      '该报告确认一百万 token 上下文和稳定的长文本检索，同时指出多模态吞吐下降，建议用真实负载压测。',
      '该报告确认可本地部署及商业许可证范围，同时指出复杂 schema 的函数调用仍需校验，并建议核算部署成本。',
      '该报告确认稀疏专家结构和原生长上下文训练，同时指出英文引用仍需交叉验证，并建议关注服务可用性。',
    ]
    const sections = children.map((child, index) => {
      const resultRef = buildManagedSwarmResultReference(child)!
      return workerSection(
        child.sessionId,
        `${child.sessionId} ${child.status}：${resultRef}。${contributions[index]}`,
      )
    })

    expect(assessManagedSwarmAggregation({
      finalText: [
        ...sections[0],
        ...sections[1],
        ...workerSection('kimi-session', 'kimi-session completed：已纳入最终结论。'),
        ...synthesisSection('综合结论：结合三者的能力、部署成本和证据质量，当前优先选择 HY4，并保留服务可用性风险。'),
        marker,
      ].join('\n'),
      orchestrationId: 'orch-models',
      finalAggregation,
      children,
    })).toMatchObject({
      valid: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('result from worker kimi-session'),
      ]),
    })

    expect(assessManagedSwarmAggregation({
      finalText: [
        ...sections.flat(),
        ...synthesisSection('综合结论：结合三者的能力、部署成本和证据质量，当前优先选择 HY4，并保留服务可用性风险。'),
        marker,
      ].join('\n'),
      orchestrationId: 'orch-models',
      finalAggregation,
      children,
    })).toEqual({ valid: true, reasons: [] })
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
