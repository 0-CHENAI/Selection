/**
 * Read-only topology + live-run overlay.
 * Inspect assignments and outcomes without granting execution or editing authority.
 */
import { projectTaskView } from '@craft-agent/shared/tasks/explain'
import { effectiveNodeDeps } from '@craft-agent/shared/tasks/plan'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { TASK_FLOW_NODE_SIZE } from './TaskFlowNode'
import { TaskGraphCanvas, type TaskGraphNode, type TaskGraphEdge } from './TaskGraphCanvas'
import { TaskNodeInspector } from './TaskNodeInspector'
import type { EditorNodeKind } from './task-spec-form'
import {
  autoLayout,
  overlayState,
  specTopologyKey,
  type CanvasGraph,
} from './conductor-graph'

export type WorkbenchNode = {
  id: string
  title?: string
  kind?: EditorNodeKind
  prompt?: string
  inputs?: Record<string, string | { from: string }>
  depends_on?: string[]
  permissionMode?: string
  model?: string
  actor?: { id: string; persona?: string }
  outputs?: Array<{ name?: string; kind?: string; type?: string }>
  loop?: unknown
  for_each?: string
  route?: { cases?: Array<{ goto: string; when: unknown }>; default: string }
  when?: unknown
}

export interface WorkbenchSpec {
  id?: string
  title?: string
  goal?: string
  runner?: 'conduct' | 'orchestrate'
  defaults?: { permissionMode?: string }
  research?: unknown
  nodes: WorkbenchNode[]
  ui?: { layout?: { direction?: 'TB' | 'LR'; nodes?: Record<string, { x: number; y: number }> } }
}

export function nodeDefinitionRows(node: WorkbenchNode, nodes?: WorkbenchNode[]): Array<{ key: string; labelKey: string; value: string }> {
  const rows: Array<{ key: string; labelKey: string; value: string }> = []
  if (node.title && node.title !== node.id) rows.push({ key: 'title', labelKey: 'tasks.title', value: node.title })
  if (effectiveNodeDeps(node, nodes).length) rows.push({ key: 'depends', labelKey: 'tasks.nodeDependsOn', value: effectiveNodeDeps(node, nodes).join(', ') })
  if (node.permissionMode) rows.push({ key: 'permission', labelKey: 'tasks.nodePermission', value: node.permissionMode })
  if (node.model) rows.push({ key: 'model', labelKey: 'tasks.nodeModel', value: node.model })
  if (node.actor) rows.push({ key: 'actor', labelKey: 'tasks.nodeActor', value: `${node.actor.id}${node.actor.persona ? ` · ${node.actor.persona}` : ''}` })
  const outputs = node.outputs?.map((output) => output.name).filter(Boolean)
  if (outputs?.length) rows.push({ key: 'outputs', labelKey: 'tasks.nodeOutputs', value: outputs.join(', ') })
  if (node.for_each) rows.push({ key: 'for_each', labelKey: 'tasks.nodeControlFlow', value: `for_each: ${node.for_each}` })
  if (node.loop != null) rows.push({ key: 'loop', labelKey: 'tasks.nodeControlFlow', value: `loop: ${JSON.stringify(node.loop)}` })
  if (node.route != null) rows.push({ key: 'route', labelKey: 'tasks.nodeControlFlow', value: `route: ${JSON.stringify(node.route)}` })
  if (node.when != null) rows.push({ key: 'when', labelKey: 'tasks.nodeControlFlow', value: `when: ${JSON.stringify(node.when)}` })
  return rows
}

interface ConductorWorkbenchProps {
  workspaceId?: string
  onOpenChildSession?: (sessionId: string) => void
  spec: WorkbenchSpec
  liveRun?: TaskRunSnapshotDto | null
  compact?: boolean
}

export function ManagedTaskWorkers({ workers, runId, onOpenSession }: { workers?: TaskRunSnapshotDto['workers']; runId: string; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  if (!workers?.length) return null
  return <details className="min-w-0 text-[12.5px]">
    <summary className="cursor-pointer rounded-sm text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('tasks.managedWorkers')} ({workers.length})</summary>
    <ul className="mt-2 max-h-40 space-y-2 overflow-auto text-foreground/80">
      {workers.map(worker => <li key={worker.workerId} className="break-words [overflow-wrap:anywhere]">
        <p>{worker.nodeId} · r{worker.revision} · {t('tasks.nodeAttempt')} {worker.attempt} · {t(`tasks.workerRole.${worker.role}`)} · {t(`tasks.workerState.${worker.state}`)}</p>
        <p className="font-mono text-[11px] text-foreground/70">{worker.sessionId ?? worker.workerId} · {runId}</p>
        {worker.sessionId && onOpenSession ? <button type="button" className="rounded-sm text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenSession(worker.sessionId!)}>{t('tasks.openChildSession')}</button> : null}
        {worker.output?.text ? <p className="whitespace-pre-wrap">{worker.output.text}</p> : null}
        {worker.reason ? <p>{worker.reason}</p> : null}
      </li>)}
    </ul>
  </details>
}

export function runtimeNodesForDefinition(nodes: TaskNodeRunStateDto[], nodeId: string): TaskNodeRunStateDto[] {
  return nodes.filter((node) => node.id === nodeId || node.definitionId === nodeId || node.id.startsWith(`${nodeId}#`))
}

function definitionOverlayState(nodeId: string, live: ConductorWorkbenchProps['liveRun']): string | undefined {
  if (!live) return undefined
  return overlayState(nodeId, {
    nodes: live.nodes.map((node) => ({
      id: node.definitionId ? `${node.definitionId}#${node.id}` : node.id,
      state: node.state,
    })),
  })
}

export function toTaskGraph(
  graph: CanvasGraph,
  spec: WorkbenchSpec,
  live: ConductorWorkbenchProps['liveRun'],
  direction: 'TB' | 'LR' = spec.ui?.layout?.direction ?? 'TB',
): { nodes: TaskGraphNode[]; edges: TaskGraphEdge[] } {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]))
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { title: n.title, kind: n.kind, caption: byId.get(n.id)?.prompt ?? n.prompt,
        state: definitionOverlayState(n.id, live), instanceCount: runtimeNodesForDefinition(live?.nodes ?? [], n.id).length, direction },
    })),
    edges: graph.edges.map((e, i) => {
      const state = definitionOverlayState(e.source, live)
      const active = state === 'done' && definitionOverlayState(e.target, live) === 'running'
      const color = active ? 'var(--task-graph-accent)' : state === 'done' ? 'var(--task-graph-complete)' : 'var(--task-graph-connector)'
      return { id: `e-${e.source}-${e.target}-${i}`, source: e.source, target: e.target,
        color, active,
        label: 'label' in e ? String(e.label ?? '') : undefined }
    }),
  }
}

function displayFlow(spec: WorkbenchSpec, live: ConductorWorkbenchProps['liveRun'], direction: 'TB' | 'LR') {
  const projection = projectTaskView(spec, 'task')
  const graph: CanvasGraph = { nodes: projection.nodes.map(node => ({ ...node, kind: node.kind as CanvasGraph['nodes'][number]['kind'], x: spec.ui?.layout?.nodes?.[node.id]?.x ?? 0, y: spec.ui?.layout?.nodes?.[node.id]?.y ?? 0 })), edges: projection.edges }
  const laid = autoLayout(graph, direction, TASK_FLOW_NODE_SIZE)
  return toTaskGraph(laid, spec, live, direction)
}

export function ConductorWorkbench({ spec, liveRun, workspaceId, onOpenChildSession, compact }: ConductorWorkbenchProps) {
  const [pageHidden, setPageHidden] = React.useState(() => typeof document !== 'undefined' && document.hidden)
  React.useEffect(() => {
    const update = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  const workbench = React.useRef<HTMLDivElement>(null)
  const [wide, setWide] = React.useState(false)
  const [inspectorOverlays, setInspectorOverlays] = React.useState(false)
  React.useLayoutEffect(() => {
    const element = workbench.current
    if (!element) return
    const measure = () => {
      setWide(element.clientWidth >= 960)
      setInspectorOverlays(element.clientWidth <= 760)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const graphContainer = React.useRef<HTMLDivElement>(null)
  const restoreNodeFocus = React.useRef<string>()
  const direction = spec.ui?.layout?.direction ?? (wide ? 'LR' : 'TB')
  const [selected, setSelected] = React.useState<string | null>(null)
  const topologyKey = `${direction}:${specTopologyKey(spec)}`
  const flow = React.useMemo(() => displayFlow(spec, liveRun, direction), [spec, liveRun, direction])

  React.useEffect(() => {
    if (selected && !spec.nodes.some((n) => n.id === selected)) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, selected])

  const selectedSpec = spec.nodes.find((n) => n.id === selected)
  const inspectorOverlayOpen = inspectorOverlays && Boolean(selectedSpec)
  React.useLayoutEffect(() => {
    const element = graphContainer.current
    if (!element) return
    element.inert = inspectorOverlayOpen
    if (!inspectorOverlayOpen && restoreNodeFocus.current) {
      const id = restoreNodeFocus.current
      restoreNodeFocus.current = undefined
      Array.from(element.querySelectorAll<HTMLElement>('[data-node-id]'))
        .find(node => node.dataset.nodeId === id)?.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }, [inspectorOverlayOpen, selected])
  const selectedLive = selectedSpec ? definitionOverlayState(selectedSpec.id, liveRun) : undefined
  const selectedInstances = selectedSpec ? runtimeNodesForDefinition(liveRun?.nodes ?? [], selectedSpec.id) : []

  return (
    <div ref={workbench} className="task-workbench flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-motion-paused={pageHidden}>
      <div className={`task-workbench-grid grid min-h-0 min-w-0 flex-1 gap-3 ${selectedSpec ? 'has-inspector' : ''}`}>
        <div ref={graphContainer} className="flex min-h-0 min-w-0" aria-hidden={inspectorOverlayOpen || undefined}>
          <TaskGraphCanvas {...flow} selected={selected} topologyKey={topologyKey} onSelect={setSelected} compact={compact} />
        </div>
        {selectedSpec && <TaskNodeInspector key={selectedSpec.id} node={selectedSpec} nodes={spec.nodes} instances={selectedInstances} state={selectedLive} run={liveRun} workspaceId={workspaceId} overlay={inspectorOverlayOpen}
          onSelect={setSelected} onOpenSession={onOpenChildSession} onClose={() => {
            restoreNodeFocus.current = selectedSpec.id
            setSelected(null)
          }} />}
      </div>
    </div>
  )
}
