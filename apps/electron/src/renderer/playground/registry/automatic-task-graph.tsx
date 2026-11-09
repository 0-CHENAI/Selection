import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@craft-agent/core'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { TurnCard } from '@craft-agent/ui/chat/TurnCard'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
import { withOrchestrationProgress } from '@/components/app-shell/kanban/orchestration-run-progress'
import { AutomaticTaskGraphDialog } from '@/components/app-shell/kanban/AutomaticTaskGraphDialog'
import { TaskGraphButton } from '@/components/ui/TaskGraphButton'
import { useOrchestrationRuns } from '@/hooks/useOrchestrationRuns'
import { mockElectronAPI } from '../mock-utils'
import type { ComponentEntry } from './types'

const spec = { version: 3, id: 'minimal-flow', title: '近期反馈调研', goal: '交叉核对官方与社区反馈，提交可追溯结论。', runner: 'conduct', nodes: [
  { id: 'prepare', title: '明确研究问题', prompt: '确定问题、时间范围和证据标准。' },
  { id: 'official', title: '检索官方信息', prompt: '核对官方公告与状态记录，确认模型名称、事件时间和受影响服务。\n\n直接阅读原始来源，记录可复核的链接与发布日期。区分产品能力文档和故障说明；证据不足时保留未知边界，不把相近时间的事件直接归因于该模型。交付一段简洁结论及来源。', depends_on: ['prepare'], outputs: [{ name: '官方信息摘要' }] },
  { id: 'community', title: '整理社区反馈', prompt: '收集公开讨论，区分事实与个人体验。', depends_on: ['prepare'] },
  { id: 'report', title: '核验并汇总', kind: 'verify', prompt: '交叉核对两路证据，提交简明结论。', depends_on: ['official', 'community'] },
] }

const escapedMarkdownOutput = [
  '## 官方核对结论', '', '**资料已核对，结论保留证据边界。**', '',
  '可复核来源：', '1. [原始资料](https://example.com/source)', '2. 核对发布日期与适用范围。', '',
  '### 限制', '- 个案不能推导为普遍问题。', '- 保留代码中的字面转义：\x60String.raw("\\n")\x60。',
].join('\\n')

// No coordinator checkpoint: exercise dispatch receipt → live child rows.
const startMessages: Message[] = [
  { id: 'plan', role: 'tool', timestamp: 1, content: '', toolName: 'mcp__session__create_task', toolStatus: 'completed', toolIntent: '创建调研计划', toolResult: '调研计划已创建。' },
  // The start receipt arrives after the workers were dispatched at 3 and 4.
  { id: 'start', role: 'tool', timestamp: 5, content: '', toolName: 'mcp__session__run_task', toolStatus: 'completed',
    toolResult: JSON.stringify({ runId: 'minimal-run', status: 'running' }), toolIntent: '启动两路核对与独立核验' },
  { id: 'ack', role: 'assistant', timestamp: 6, content: '已启动两路核对，完成后独立核验。' },
]

function Preview({ scenario }: { scenario: string }) {
  const [ready, setReady] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [writes, setWrites] = React.useState(0)
  const [child, setChild] = React.useState('')
  const emit = React.useRef<(complete?: boolean) => void>(() => {})
  React.useEffect(() => {
    const previous = window.electronAPI
    const activeSpec = ['three', 'adaptive'].includes(scenario) ? { ...spec, nodes: spec.nodes.filter(node => node.id !== 'prepare').map(node => ({ ...node, depends_on: node.id === 'report' ? ['official', 'community'] : [] })) }
      : scenario === 'many' ? { ...spec, nodes: [spec.nodes[0]!, ...Array.from({ length: 8 }, (_, i) => ({ id: `research-${i}`, title: `独立核对 ${i + 1}`, prompt: '核对指定来源并保留证据边界。', depends_on: ['prepare'] })), { ...spec.nodes[3]!, depends_on: Array.from({ length: 8 }, (_, i) => `research-${i}`) }] } : spec
    const failed = scenario === 'failed' || scenario === 'three'
    const listeners = new Set<(workspaceId: string, snapshot: TaskRunSnapshotDto) => void>()
    let current: TaskRunSnapshotDto = { workspaceId: 'preview', slug: 'minimal-flow', runId: 'minimal-run', taskId: 'minimal-flow', orchestratorSessionId: 'root', revision: 0,
      status: failed ? 'failed' : scenario === 'waiting' ? 'waiting-approval' : ['done', 'verdict', 'markdown'].includes(scenario) ? 'completed' : 'running', tokensUsed: 0,
      nodes: activeSpec.nodes.map(node => ({ id: node.id, title: node.title, attempt: node.id === 'report' && scenario !== 'verdict' ? 0 : 1, sessionId: node.id === 'official' ? 'official-child' : undefined,
        ...(node.id === 'official' ? { model: 'gpt-6-luna', tokensUsed: 83977, retryCount: 0, elapsedMs: 227349, queueMs: 109, cacheStatus: 'miss' as const } : {}),
        ...(scenario === 'adaptive' && node.id !== 'report' ? { startedAt: node.id === 'official' ? 3 : 4 } : {}),
        state: ['done', 'verdict', 'markdown'].includes(scenario) || node.id === 'prepare' ? 'done' : node.id === 'report' ? failed ? 'cancelled' : 'pending' : failed ? 'invalid' : scenario === 'waiting' && node.id === 'community' ? 'waiting-approval' : 'running',
        ...(scenario === 'verdict' && node.id === 'report' ? { verdict: { result: 'pass' as const, reason: '**独立核验完成。**两路证据支持结论；未确认的原因保留为未知。', evidence: '已复核以下材料：\n\n- 官方来源的日期与范围。\n- 社区材料的引用。' } } : {}),
        blocker: failed && node.id === 'report' ? 'blocked-dependency' : undefined })) }
    const denyWrite = async () => { setWrites(count => count + 1); throw new Error('Read-only preview: write attempted') }
    const api = { ...mockElectronAPI,
      getTask: async () => ({ slug: current.slug, validation: { valid: true, errors: [], warnings: [] }, spec: activeSpec, runHistory: [current] }),
      getSessionMessages: async () => null,
      getTaskResults: async () => ({ slug: current.slug, runId: current.runId, runIds: [current.runId], revision: current.revision, orchestratorSessionId: 'root', nodes: current.nodes.filter(node => node.state === 'done').map(node => ({ id: node.id, title: activeSpec.nodes.find(definition => definition.id === node.id)!.title, state: node.state, sessionId: node.sessionId, attempt: node.attempt, revision: current.revision, output: scenario === 'markdown' && node.id === 'official' ? escapedMarkdownOutput : scenario === 'verdict' && ['report', 'community'].includes(node.id) ? undefined : node.id === 'official' ? '已核对官方公告与状态记录。已公布的信息确认存在 API 延迟事件，但未按模型划分影响。\n\n模型名称与接口标识已核对；目前材料不足以确认该模型存在普遍故障。' : '已完成限定范围内的核对，并保留证据边界。' })) }),
      onTaskRunChanged: (callback: (ws: string, run: TaskRunSnapshotDto) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
      inspectTaskRun: async () => {
        if (scenario === 'error') throw new Error('Preview transport failure')
        return { readOnly: true, cursor: 0, total: 0, spec: scenario === 'empty' ? { ...activeSpec, nodes: [] } : activeSpec,
          snapshot: current, history: [], changes: [], preflight: null, views: {}, limitations: [] }
      },
      createTask: denyWrite, saveTask: denyWrite, runTask: denyWrite, continueTask: denyWrite, applyTaskRunRevision: denyWrite,
    }
    window.electronAPI = api as unknown as typeof window.electronAPI
    emit.current = (complete = true) => {
      current = { ...current, status: complete ? 'completed' : 'running', nodes: current.nodes.map(node => ({ ...node, state: complete ? 'done' : node.id === 'report' ? 'running' : 'done' })) }
      listeners.forEach(listener => listener('preview', current))
    }
    setReady(true)
    return () => { window.electronAPI = previous }
  }, [scenario])
  return ready ? <RunPreview scenario={scenario} open={open} onOpenChange={setOpen} onComplete={() => emit.current()} onJoin={() => emit.current(false)} writes={writes} child={child} onChild={id => { setOpen(false); setChild(id) }} /> : null
}

function RunPreview({ scenario, open, onOpenChange, onComplete, onJoin, writes, child, onChild }: {
  scenario: string;
  open: boolean; onOpenChange: (open: boolean) => void; onComplete: () => void; onJoin: () => void;
  writes: number; child: string; onChild: (id: string) => void;
}) {
  const { t } = useTranslation()
  const { runs } = useOrchestrationRuns('preview', 'minimal-flow', 'root')
  const run = runs.at(-1)
  const turns = React.useMemo(() => {
    const grouped = groupMessagesByTurn(startMessages, { isTaskOrchestrationRoot: true, isTaskOrchestrationRunning: run?.status === 'running', isSessionProcessing: false })
    return run ? withOrchestrationProgress(grouped, run, t) : grouped
  }, [run, t])
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  // Keyboard shortcuts exercise live events while the protected dialog is open.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'j') onJoin(); if (event.key === 'c') onComplete() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onJoin, onComplete])
  return <div className="max-w-xl space-y-4 p-6">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">PRO 自动任务图 · 最小验收</h2><TaskGraphButton triggerRef={triggerRef} open={open} onOpen={() => onOpenChange(true)} /></div>
    <p className="text-sm text-muted-foreground">{['three', 'adaptive'].includes(scenario) ? '三个演示节点：两路核对 → 核验汇合。' : scenario === 'many' ? '十个演示节点：准备 → 八路核对 → 核验汇合。' : '四个演示节点：准备 → 两路并行 → 核验汇合。'}打开后按 J 推进到汇合，按 C 完成。</p>
    <p className="text-sm" role="status">写调用：{writes} · 运行：{runs.at(-1)?.status ?? 'loading'}{child ? ` · 已打开子代理：${child}` : ''}</p>
    {scenario === 'adaptive' && turns.map(turn => turn.type === 'assistant' && <TurnCard key={turn.turnId} {...turn} displayMode="informative"
      onOpenActivityDetails={activity => { if (activity.taskNode?.sessionId) onChild(activity.taskNode.sessionId) }} />)}
    <AutomaticTaskGraphDialog triggerRef={triggerRef} open={open} onOpenChange={onOpenChange} workspaceId="preview" run={runs.at(-1) ?? null} onOpenChildSession={onChild} />
  </div>
}

function AutomaticTaskGraphPreview({ scenario = 'running' }: { scenario?: string }) { return <Preview key={scenario} scenario={scenario} /> }

export const automaticTaskGraphComponents: ComponentEntry[] = [{
  id: 'automatic-task-graph', name: 'Automatic Task Graph', category: 'Kanban', description: 'PRO read-only observer with a four-node live fork/join fixture.', component: AutomaticTaskGraphPreview,
  props: [{ name: 'scenario', control: { type: 'select', options: ['running', 'adaptive', 'three', 'many', 'done', 'verdict', 'markdown', 'failed', 'waiting', 'error', 'empty'].map(value => ({ label: value, value })) }, defaultValue: 'running' }],
  variants: ['running', 'adaptive', 'three', 'many', 'done', 'verdict', 'markdown', 'failed', 'waiting', 'error', 'empty'].map(scenario => ({ name: scenario, props: { scenario } })),
}]
