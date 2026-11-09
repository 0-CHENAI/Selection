import { CircleCheck, CircleX, Circle, Clock3, Loader2, Users, GitBranch, ShieldCheck, Layers, Combine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { nodeKindLabelKey } from './task-labels'
import { resolveNodeStatePill } from './node-state-pill'

export type TaskFlowNodeData = {
  title: string
  kind?: string
  caption?: string
  state?: string
  instanceCount: number
  direction: 'TB' | 'LR'
}

export const TASK_FLOW_NODE_SIZE = { width: 288, height: 128 }

// Semantic colors follow the chosen app theme, independent of OS dark media queries.
export function taskGraphStateColor(state: string) {
  if (state === 'done') return 'color-mix(in srgb, var(--success) 82%, var(--foreground))'
  if (state === 'failed' || state === 'invalid') return 'color-mix(in srgb, var(--destructive) 82%, var(--foreground))'
  if (['running', 'ready', 'waiting-approval', 'retry-wait'].includes(state)) return 'var(--pro-accent)'
  return 'color-mix(in srgb, var(--foreground) 70%, var(--popover))'
}

export function TaskFlowNode({ data, selected, onSelect, onFocus }: { data: TaskFlowNodeData; selected: boolean; onSelect: () => void; onFocus: () => void }) {
  const { t } = useTranslation()
  const state = data.state ?? 'pending'
  const pill = resolveNodeStatePill(state)
  const kindLabel = t(nodeKindLabelKey(data.kind))
  const stateLabel = pill.labelKey ? t(pill.labelKey) : state
  const StateIcon = state === 'done' ? CircleCheck : ['failed', 'invalid'].includes(state) ? CircleX
    : state === 'running' ? Loader2 : state.startsWith('waiting') || state === 'retry-wait' ? Clock3 : Circle
  const KindIcon = ['verify', 'judge', 'approval'].includes(data.kind ?? '') ? ShieldCheck
    : data.kind === 'route' ? GitBranch : ['parallel', 'map', 'loop'].includes(data.kind ?? '') ? Layers
    : ['synthesize', 'aggregate', 'finally'].includes(data.kind ?? '') ? Combine : Users
  return <button type="button" className="task-flow-node" data-selected={selected} data-state={state}
    aria-label={`${data.title} · ${kindLabel} · ${stateLabel}`} aria-pressed={selected} onClick={onSelect} onFocus={onFocus}>
    {selected && <svg className="task-flow-node-selection" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="18" pathLength="100" />
    </svg>}
    <div className="task-flow-node-meta">
      <span className="task-flow-node-kind"><KindIcon size={15} aria-hidden="true" />{kindLabel}
        {data.instanceCount > 1 && <span className="task-flow-node-instances">{t('tasks.runtimeInstances', { count: data.instanceCount })}</span>}
      </span>
      <span className="task-flow-node-state" style={{ color: taskGraphStateColor(state) }}><StateIcon size={13}
        className={state === 'running' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />{stateLabel}</span>
    </div>
    <span className="task-flow-node-title">{data.title}</span>
    <span className="task-flow-node-caption">{data.caption || t('tasks.graphNoDescription')}</span>
  </button>
}
