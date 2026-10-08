import { describe, expect, it } from 'bun:test'
import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import {
  buildOrchestrationProgressRows,
  collectOrchestrationResearchSources,
  canPreviewOrchestrationChild,
  countFinishedProgressRows,
  isActiveTaskRunStatus,
  isTaskRunEventForProgress,
  pickStoppableTaskRun,
  nodeStateForSession,
  sessionIdForProgressRow,
  withOrchestrationProgress,
} from '../orchestration-run-progress'
import type { Turn } from '@craft-agent/ui'
import type { Message } from '@craft-agent/core'

function snapshot(partial: Partial<TaskRunSnapshotDto> = {}): TaskRunSnapshotDto {
  return {
    slug: 'research',
    runId: 'run-1',
    taskId: 'task-1',
    status: 'running',
    nodes: [],
    tokensUsed: 0,
    ...partial,
  }
}

function node(partial: Partial<TaskNodeRunStateDto> & Pick<TaskNodeRunStateDto, 'id'>): TaskNodeRunStateDto {
  return {
    state: 'pending',
    attempt: 1,
    ...partial,
  }
}

it('collects distinct successful worker sources for the owning run, including reloaded history', () => {
  const fetch = (url: string, timestamp: number, partial: Partial<Message> = {}): Message => ({
    id: `${url}-${timestamp}`, role: 'tool', timestamp, content: 'Running WebFetch...', toolName: 'WebFetch',
    toolStatus: 'completed', toolInput: { url }, toolResult: `Content from ${url}:\n\nActual source text.`, ...partial,
  })
  const run = snapshot({ orchestratorSessionId: 'parent', nodes: [
    node({ id: 'read', sessionId: 'actor', startedAt: 10 }), node({ id: 'review', sessionId: 'reviewer' }),
  ] })
  const sessions = [null,
    { id: 'actor', parentSessionId: 'parent', taskRunId: 'run-2', messages: [
      fetch('https://earlier.example.com', 5), fetch('https://example.com/page#first', 11),
      fetch('https://example.com/page#second', 12), fetch('https://failed.example.com', 13, { isError: true }),
      fetch('https://pending.example.com', 14, { toolStatus: 'executing' }),
      fetch('https://later.example.com', 21),
    ] },
    { id: 'reviewer', parentSessionId: 'parent', taskRunId: 'run-1', messages: [fetch('https://verified.example.com', 15)] },
    { id: 'unrelated', parentSessionId: 'parent', messages: [fetch('https://unrelated.example.com', 15)] },
  ]
  const nextRun = snapshot({ runId: 'run-2', orchestratorSessionId: 'parent', nodes: [node({ id: 'next', sessionId: 'actor', startedAt: 20 })] })
  const sources = collectOrchestrationResearchSources(run, sessions, [run, nextRun])
  expect(sources.map(source => source.url)).toEqual(['https://example.com/page', 'https://verified.example.com/'])
  expect(sources[0]?.description).toBe('Actual source text.')
  expect(collectOrchestrationResearchSources({ ...run, orchestratorSessionId: 'other' }, sessions)).toEqual([])
  expect(collectOrchestrationResearchSources(run, sessions.map(session => session?.id === 'reviewer' ? { ...session, taskRunId: 'other' } : session), [run, nextRun])).toHaveLength(1)
  expect(collectOrchestrationResearchSources(nextRun, sessions, [run, nextRun]).map(source => source.hostname)).toEqual(['later.example.com'])
})

describe('inline orchestration progress', () => {
  it('shows the selected worker state without mistaking a previous attempt for a completed retry', () => {
    const runs = [snapshot({ nodes: [node({ id: 'research', state: 'done', sessionId: 'latest', attempts: [
      { attempt: 1, sessionId: 'previous', state: 'invalid' },
      { attempt: 2, sessionId: 'latest', state: 'running' },
    ] })] })]
    expect(nodeStateForSession(runs, 'latest')).toBe('done')
    expect(nodeStateForSession(runs, 'previous')).toBe('invalid')
    expect(nodeStateForSession(runs, 'unknown')).toBeUndefined()
    expect(nodeStateForSession(runs, null)).toBeUndefined()
    expect(nodeStateForSession([...runs, snapshot({ nodes: [node({ id: 'research', state: 'running', sessionId: 'latest' })] })], 'latest')).toBe('running')
    expect(nodeStateForSession([snapshot({ nodes: [
      node({ id: 'earlier', state: 'done', sessionId: 'reused', startedAt: 10 }),
      node({ id: 'later', state: 'running', sessionId: 'reused', startedAt: 20 }),
    ] })], 'reused')).toBe('running')
  })
  it('uses dispatch times across operations and keeps undispatched or legacy nodes last without fabricated times', () => {
    const turn: Turn = { type: 'assistant', taskRunId: 'run-1', turnId: 'root', timestamp: 10,
      isComplete: false, isStreaming: true, activities: [
        { id: 'read', type: 'tool', toolName: 'Read', status: 'completed', timestamp: 15 },
        { id: 'review', type: 'intermediate', content: '核对结果', status: 'completed', timestamp: 30 },
      ] }
    const projected = withOrchestrationProgress([turn], snapshot({ nodes: [
      node({ id: 'later', startedAt: 25, state: 'running' }),
      node({ id: 'first', startedAt: 20, state: 'done' }),
      node({ id: 'pending' }), node({ id: 'legacy', state: 'done' }),
    ] }), key => key)[0]
    if (projected?.type !== 'assistant') throw Error('Missing work chain')
    expect(projected.activities.filter(row => row.statusType !== 'task_progress').sort((a, b) => a.timestamp - b.timestamp)
      .map(row => row.id)).toEqual(['read', 'task-node:run-1:first', 'task-node:run-1:later', 'review', 'task-node:run-1:pending', 'task-node:run-1:legacy'])
    expect(projected.activities.filter(row => row.taskNode).map(row => row.timestamp)).toEqual([25, 20, 30, 30])
    expect(turn.activities.map(row => row.id)).toEqual(['read', 'review'])
    const activeOnly = withOrchestrationProgress([turn], snapshot({ nodes: [
      node({ id: 'active', state: 'running', startedAt: 40 }), node({ id: 'next' }),
    ] }), key => key)[0]
    if (activeOnly?.type !== 'assistant') throw Error('Missing active chain')
    expect(activeOnly.activities.find(row => row.id === 'task-node:run-1:next')?.timestamp).toBe(40)
  })
  it('updates only the latest matching chain, keeps worker states folded and preserves the report', () => {
    const turns: Turn[] = ['run-1', 'run-2', 'run-1'].map((taskRunId, index) => ({
      type: 'assistant', taskRunId, turnId: `turn-${index}`, activities: [], timestamp: index,
      isComplete: true, isStreaming: false, response: { text: '集中报告', isStreaming: false },
    }))
    const before = JSON.stringify(turns)
    const t = (key: string, options?: { count: number }) => key === 'session.executionChildren' ? `子代理 (${options?.count})` : key
    const projected = withOrchestrationProgress(turns, snapshot({ nodes: [
      node({ id: 'done', title: '读取资料', instruction: '核对原文金额。提交 values.research={}.', sessionId: 'worker-1', state: 'done' }),
      node({ id: 'running', title: '修订报告', state: 'running' }),
      node({ id: 'pending', title: '核验修订稿', state: 'pending' }),
      node({ id: 'failed', title: '审查报告', state: 'failed' }),
    ] }), t)
    expect(projected[0]).toBe(turns[0])
    expect(projected[1]).toBe(turns[1])
    if (projected[2]?.type !== 'assistant') throw new Error('expected root chain')
    expect(projected[2].activities.map(row => row.status)).toEqual(['completed', 'running', 'pending', 'error', 'running'])
    expect(projected[2].intent).toContain('子代理 (4) · 1/4')
    expect(projected[2].response?.text).toBe('集中报告')
    expect(projected[2].activities[0]?.taskNode).toEqual({ title: '读取资料', description: '核对原文金额。', sessionId: 'worker-1', stateLabel: 'tasks.nodeStateDone' })
    expect(projected[2].activities.filter(activity => activity.taskNode)).toHaveLength(4)
    expect(JSON.stringify(turns)).toBe(before)
    expect(withOrchestrationProgress(turns, snapshot({ runId: 'unrelated' }), t)).toBe(turns)
  })

  it('does not label a paused run as running or completed', () => {
    const turns: Turn[] = [{ type: 'assistant', taskRunId: 'run-1', turnId: 'cp', activities: [], timestamp: 1, isComplete: true, isStreaming: false }]
    const result = withOrchestrationProgress(turns, snapshot({ status: 'paused' }), key => key)
    expect(result[0]?.type === 'assistant' && result[0].activities.at(-1)?.status).toBe('pending')
  })
})

describe('task-run ownership guards', () => {
  it('ignores run events from another workspace or another orchestrator session', () => {
    const owned = snapshot({ orchestratorSessionId: 'orch-1' })
    expect(isTaskRunEventForProgress('ws-a', 'research', 'orch-1', 'ws-a', owned)).toBe(true)
    expect(isTaskRunEventForProgress('ws-a', 'research', 'orch-1', 'ws-b', owned)).toBe(false)
    expect(isTaskRunEventForProgress('ws-a', 'research', 'orch-1', 'ws-a', snapshot({
      slug: 'other',
      orchestratorSessionId: 'orch-1',
    }))).toBe(false)
    expect(isTaskRunEventForProgress('ws-a', 'research', 'orch-1', 'ws-a', snapshot({
      orchestratorSessionId: 'orch-2',
    }))).toBe(false)
  })

  it('stops only an active run owned by this orchestrator session', () => {
    expect(pickStoppableTaskRun(snapshot({
      status: 'running',
      orchestratorSessionId: 'orch-1',
    }), 'orch-1')?.runId).toBe('run-1')
    expect(pickStoppableTaskRun(snapshot({
      status: 'completed',
      orchestratorSessionId: 'orch-1',
    }), 'orch-1')).toBeNull()
    expect(pickStoppableTaskRun(snapshot({
      status: 'running',
      orchestratorSessionId: 'orch-2',
    }), 'orch-1')).toBeNull()
    expect(pickStoppableTaskRun(snapshot({ status: 'running' }), 'orch-1')?.runId).toBe('run-1')
  })

  it('previews only children of the current orchestrator when parent is known', () => {
    expect(canPreviewOrchestrationChild('orch-1', undefined)).toBe(true)
    expect(canPreviewOrchestrationChild('orch-1', {})).toBe(true)
    expect(canPreviewOrchestrationChild('orch-1', { parentSessionId: 'orch-1' })).toBe(true)
    expect(canPreviewOrchestrationChild('orch-1', { parentSessionId: 'other' })).toBe(false)
  })
})

describe('buildOrchestrationProgressRows', () => {
  const spec = [
    { id: 'hy4', title: '调研 Hy4-preview' },
    { id: 'glm', title: '调研 GLM5.3' },
    { id: 'kimi', title: '调研 Kimi K3' },
    { id: 'summary', title: '汇总' },
  ]

  it('uses actual assignments for internal names and omits protocol clauses from historical titles', () => {
    const rows = buildOrchestrationProgressRows(undefined, snapshot({ nodes: [
      node({ id: 'cost', title: 'cost', instruction: '核对原文中的两年成本。提交 values.research={}.', state: 'done' }),
      node({ id: 'report', title: '提交 values.research.report；只引用独立审查支持的结论', instruction: '只引用独立审查支持的结论。保留资料缺口。' }),
      node({ id: 'risk', title: '独立 Read 冻结资料' }),
    ] }))
    expect(rows.map(row => row.title)).toEqual(['核对原文中的两年成本。', '只引用独立审查支持的结论', '独立读取冻结资料'])
    expect(rows[1]?.description).toBe('只引用独立审查支持的结论。 保留资料缺口。')
  })

  it('folds live node state onto spec titles and prefers the running session', () => {
    const rows = buildOrchestrationProgressRows(spec, snapshot({
      nodes: [
        node({ id: 'hy4', state: 'running', sessionId: 'sess-hy4' }),
        node({ id: 'glm', state: 'done', sessionId: 'sess-glm' }),
        node({ id: 'kimi', state: 'pending' }),
        node({ id: 'summary', state: 'pending' }),
      ],
    }))

    expect(rows).toEqual([
      { id: 'hy4', title: '调研 Hy4-preview', state: 'running', sessionId: 'sess-hy4' },
      { id: 'glm', title: '调研 GLM5.3', state: 'done', sessionId: 'sess-glm' },
      { id: 'kimi', title: '调研 Kimi K3', state: 'pending', sessionId: undefined },
      { id: 'summary', title: '汇总', state: 'pending', sessionId: undefined },
    ])
    expect(countFinishedProgressRows(rows)).toBe(1)
  })

  it('keeps spec rows pending before the first snapshot arrives', () => {
    const rows = buildOrchestrationProgressRows(spec, null)
    expect(rows.map((row) => row.state)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(countFinishedProgressRows(rows)).toBe(0)
  })

  it('falls back to live node ids when the spec is missing', () => {
    const rows = buildOrchestrationProgressRows(undefined, snapshot({
      nodes: [node({ id: 'hy4#0', state: 'running', sessionId: 'sess-hy4' })],
    }))
    expect(rows).toEqual([
      { id: 'hy4#0', title: 'hy4#0', state: 'running', sessionId: 'sess-hy4' },
    ])
  })

  it('does not silently choose one sibling for a definition row', () => {
    expect(sessionIdForProgressRow([
      node({ id: 'hy4#0', definitionId: 'hy4', state: 'done', sessionId: 'old' }),
      node({ id: 'hy4#1', definitionId: 'hy4', state: 'running', sessionId: 'live' }),
    ], 'hy4')).toBeUndefined()
  })
})

describe('instance and history visibility', () => {
  it('keeps all instances, retries and frozen titles addressable', () => {
    const rows = buildOrchestrationProgressRows([{ id: 'map', title: 'Edited later' }], snapshot({
      status: 'stopped', nodes: [
        node({ id: 'map', title: 'Original title', state: 'cancelled' }),
        node({ id: 'map#2', definitionId: 'map', state: 'cancelled', sessionId: 's2' }),
        node({ id: 'map#0', definitionId: 'map', state: 'done', sessionId: 's0' }),
        node({ id: 'map#1', definitionId: 'map', state: 'failed', sessionId: 's1-new', attempt: 2,
          attempts: [{ attempt: 1, sessionId: 's1-old', state: 'failed' }, { attempt: 2, sessionId: 's1-new', state: 'failed' }] }),
      ],
    }))
    expect(rows[0]!.title).toBe('Original title')
    expect(rows[0]!.sessionId).toBeUndefined()
    expect(rows[0]!.children!.map(row => row.sessionId)).toEqual(['s0', 's1-new', 's2'])
    expect(rows[0]!.children![1]!.attempts?.map(attempt => attempt.sessionId)).toEqual(['s1-old', 's1-new'])

  })

  it('keeps completed runs in their own chains with only the current child session shown', () => {
    const turns: Turn[] = ['old', 'new'].map(taskRunId => ({ type: 'assistant', taskRunId,
      turnId: taskRunId, timestamp: 1, activities: [], isComplete: true, isStreaming: false }))
    const runs = [snapshot({ runId: 'old', status: 'stopped', nodes: [node({ id: 'cost', state: 'cancelled',
      sessionId: 'latest-attempt', attempt: 2, attempts: [{ attempt: 1, state: 'failed', sessionId: 'old-attempt' }, { attempt: 2, state: 'cancelled', sessionId: 'latest-attempt' }] })] }),
      snapshot({ runId: 'new', status: 'running', nodes: [node({ id: 'review', state: 'running', sessionId: 'new-worker' })] })]
    const projected = runs.reduce((history, run) => withOrchestrationProgress(history, run, key => key), turns)
    const oldTurn = projected[0]
    const newTurn = projected[1]
    if (oldTurn?.type !== 'assistant' || newTurn?.type !== 'assistant') throw Error('Missing work chains')
    expect(oldTurn.intent).toContain('tasks.runStatusStopped')
    expect(newTurn.intent).toContain('tasks.runStatusRunning')
    expect(oldTurn.activities[0]?.taskNode).not.toHaveProperty('attempts')
    expect(oldTurn.activities[0]?.taskNode?.sessionId).toBe('latest-attempt')
    expect(newTurn.activities[0]?.taskNode?.sessionId).toBe('new-worker')
    expect(turns.every(turn => turn.type === 'assistant' && !turn.activities.length)).toBe(true)
  })
})
