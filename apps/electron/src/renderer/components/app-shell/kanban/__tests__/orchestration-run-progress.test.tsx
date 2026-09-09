import { describe, expect, it } from 'bun:test'
import i18next, { type InitOptions } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { OrchestrationRunProgressView } from '../OrchestrationRunProgress'
import {
  buildOrchestrationProgressRows,
  canPreviewOrchestrationChild,
  countFinishedProgressRows,
  isActiveTaskRunStatus,
  isTaskRunEventForProgress,
  pickStoppableTaskRun,
  sessionIdForProgressRow,
  shouldShowOrchestrationRunProgress,
} from '../orchestration-run-progress'

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

function renderWithI18n(language: keyof typeof LOCALE_REGISTRY, ui: ReactNode): string {
  const instance = i18next.createInstance()
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    initImmediate: false,
    resources: Object.fromEntries(
      Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
        code,
        { translation: entry.messages },
      ]),
    ),
  } as InitOptions)
  return renderToStaticMarkup(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>)
}

describe('shouldShowOrchestrationRunProgress', () => {
  it('hides the panel for ordinary chats and child sessions', () => {
    expect(shouldShowOrchestrationRunProgress({
      isTaskOrchestrator: false,
      orchestrationStatus: 'running',
      runStatus: 'running',
    })).toBe(false)
  })

  it('shows the panel as soon as the orchestrator session is running', () => {
    expect(shouldShowOrchestrationRunProgress({
      isTaskOrchestrator: true,
      orchestrationStatus: 'running',
    })).toBe(true)
  })

  it('shows paused and waiting runs even when the session pill is idle', () => {
    expect(shouldShowOrchestrationRunProgress({
      isTaskOrchestrator: true,
      runStatus: 'waiting-approval',
    })).toBe(true)
    expect(shouldShowOrchestrationRunProgress({
      isTaskOrchestrator: true,
      runStatus: 'paused',
    })).toBe(true)
  })

  it('retains completed, failed, and stopped runs as history', () => {
    expect(isActiveTaskRunStatus('completed')).toBe(false)
    expect(isActiveTaskRunStatus('failed')).toBe(false)
    expect(isActiveTaskRunStatus('stopped')).toBe(false)
    expect(shouldShowOrchestrationRunProgress({
      isTaskOrchestrator: true,
      runStatus: 'completed',
    })).toBe(true)
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

describe('OrchestrationRunProgressView', () => {
  it('renders live node titles and states in the main chat chrome', () => {
    const html = renderWithI18n('zh-Hans', (
      <OrchestrationRunProgressView
        runningHint
        liveRun={snapshot()}
        rows={[
          { id: 'hy4', title: '调研 Hy4-preview', state: 'running', sessionId: 'sess-hy4' },
          { id: 'summary', title: '汇总', state: 'pending' },
        ]}
        onPreviewSession={() => {}}
      />
    ))

    expect(html).toContain('data-testid="orchestration-run-progress"')
    expect(html).toContain('当前运行')
    expect(html).toContain('运行中')
    expect(html).toContain('调研 Hy4-preview')
    expect(html).toContain('汇总')
    expect(html).toContain('待处理')
    expect(html).toContain('0/2')
    expect(html).toContain('<button')
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
    const html = renderWithI18n('zh-Hans', <OrchestrationRunProgressView runningHint liveRun={snapshot({ status: 'stopped' })} rows={rows} onPreviewSession={() => {}} />)
    for (const id of ['s0', 's1-old', 's1-new', 's2']) expect(html).toContain(`data-session-id="${id}"`)
    expect(html).toContain('运行历史')
    expect(html).toContain('已停止')
    expect(html).not.toContain('animate-ping')
    expect(html).not.toContain('重试失败节点')
  })

  it('offers distinct run ids without reviving terminal status from the parent hint', () => {
    const runs = [snapshot({ runId: 'old', status: 'stopped' }), snapshot({ runId: 'new', status: 'running' })]
    const html = renderWithI18n('en', <OrchestrationRunProgressView runningHint liveRun={runs[0]} runs={runs} onSelectRun={() => {}} rows={[]} />)
    expect(html).toContain('value="old"')
    expect(html).toContain('value="new"')
    expect(html).toContain('Stopped')
    expect(html).not.toContain('animate-ping')
  })
})
