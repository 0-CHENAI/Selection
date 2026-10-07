/**
 * Read-only topology + live-run overlay.
 * Authoring stays on the definition tab and YAML — this surface never writes spec.nodes.
 */
import { TASK_VIEWS, projectTaskView, explainPreflight, type TaskView } from '@craft-agent/shared/tasks/explain'
import { effectiveNodeDeps } from '@craft-agent/shared/tasks/plan'
import { validateTaskInput } from '../../../../../../../packages/shared/src/tasks/validate'
import * as React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { isTasksOrchestrateEnabled } from '@craft-agent/shared/feature-flags'
import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { resolveNodeStatePill } from './node-state-pill'
import { ResearchResults } from './ResearchResults'
import { nodeKindLabelKey, runStatusLabelKey, runnerLabelKey } from './task-labels'
import type { EditorNodeKind } from './task-spec-form'
import {
  autoLayout,
  hasCompleteLayout,
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

function nodeLabel(
  n: { id: string; title?: string; kind?: string },
  live: ConductorWorkbenchProps['liveRun'],
  translate: (key: string) => string,
): string {
  const state = definitionOverlayState(n.id, live)
  const pill = state ? resolveNodeStatePill(state) : null
  const stateText = pill?.labelKey ? translate(pill.labelKey) : state
  return `${n.title ?? n.id} · ${translate(nodeKindLabelKey(n.kind))}${stateText ? ` · ${stateText}` : ''}`
}

function toFlow(
  graph: CanvasGraph,
  spec: WorkbenchSpec,
  live: ConductorWorkbenchProps['liveRun'],
  translate: (key: string) => string,
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]))
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: byId.has(n.id) ? nodeLabel({ ...byId.get(n.id)!, title: n.title }, live, translate) : n.title },
    })),
    edges: graph.edges.map((e, i) => ({ id: `e-${e.source}-${e.target}-${i}`, source: e.source, target: e.target, label: 'label' in e ? String(e.label ?? '') : undefined })),
  }
}

function displayFlow(spec: WorkbenchSpec, live: ConductorWorkbenchProps['liveRun'], translate: (key: string) => string, view: TaskView) {
  const projection = projectTaskView(spec, view, live?.research)
  const graph: CanvasGraph = { nodes: projection.nodes.map(node => ({ ...node, kind: node.kind as CanvasGraph['nodes'][number]['kind'], x: spec.ui?.layout?.nodes?.[node.id]?.x ?? 0, y: spec.ui?.layout?.nodes?.[node.id]?.y ?? 0 })), edges: projection.edges }
  const laid = view === 'task' && hasCompleteLayout(spec) ? graph : autoLayout(graph, spec.ui?.layout?.direction)
  return toFlow(laid, spec, live, translate)
}

function WorkbenchInner({ spec: authoredSpec, liveRun: currentRun, workspaceId, onOpenChildSession, compact }: ConductorWorkbenchProps) {
  const [view, setView] = React.useState<TaskView>('task')
  const [inspection, setInspection] = React.useState<import('@craft-agent/shared/tasks').TaskRunInspection | null>(null)
  const [historyError, setHistoryError] = React.useState<string>()
  const [cursor, setCursor] = React.useState<number>()
  const historyGeneration = React.useRef(0)
  const inspect = async (position?: number) => {
    if (!workspaceId || !currentRun || !window.electronAPI.inspectTaskRun) return
    const generation = ++historyGeneration.current
    try {
      const value = await window.electronAPI.inspectTaskRun(workspaceId, currentRun.slug, currentRun.runId, position)
      if (generation !== historyGeneration.current) return
      setInspection(value); setCursor(value.cursor); setHistoryError(undefined)
    } catch (error) { if (generation === historyGeneration.current) setHistoryError(String(error)) }
  }
  React.useEffect(() => { historyGeneration.current++; setInspection(null); setCursor(undefined); setHistoryError(undefined) }, [currentRun?.runId])
  const spec = inspection ? inspection.spec ?? { ...authoredSpec, nodes: [] } : authoredSpec
  const liveRun = inspection?.snapshot ?? currentRun
  const preflight = inspection?.preflight ?? { ...explainPreflight(spec), ...validateTaskInput(spec) }
  const { t } = useTranslation()
  const { fitView } = useReactFlow()
  const graphContainer = React.useRef<HTMLDivElement>(null)
  const orchestrateOn = isTasksOrchestrateEnabled()
  const initial = displayFlow(spec, liveRun, t, view)
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selected, setSelected] = React.useState<string | null>(null)
  const topologyKey = `${view}:${inspection?.cursor ?? 'live'}:${specTopologyKey(spec)}:${liveRun?.research?.claims.map(claim => `${claim.id}@${claim.version}`).join('|') ?? ''}`
  const liveKey = `${liveRun?.status ?? ''}:${liveRun?.metrics?.elapsedMs ?? ''}:${liveRun?.metrics?.cacheHits ?? ''}:${(liveRun?.nodes ?? []).map((n) => `${n.id}:${n.state}:${n.cacheStatus}:${n.elapsedMs}:${n.verdict?.result}`).join('|')}`

  React.useEffect(() => {
    const flow = displayFlow(spec, liveRun, t, view)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey])

  React.useEffect(() => {
    const labels = new Map(displayFlow(spec, liveRun, t, view).nodes.map(node => [node.id, node.data.label]))
    setNodes(previous => previous.map(node => ({ ...node, data: { ...node.data, label: labels.get(node.id) ?? node.data.label } })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  React.useEffect(() => {
    let frame: number
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fitView({ padding: 0.2 })) }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    if (graphContainer.current) observer?.observe(graphContainer.current)
    fit()
    return () => { observer?.disconnect(); cancelAnimationFrame(frame) }
  }, [topologyKey, fitView])

  React.useEffect(() => {
    if (selected && !spec.nodes.some((n) => n.id === selected)) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, selected])

  const selectedSpec = spec.nodes.find((n) => n.id === selected)
  const selectedLive = selectedSpec ? definitionOverlayState(selectedSpec.id, liveRun) : undefined
  const selectedPill = selectedLive ? resolveNodeStatePill(selectedLive) : null
  const selectedInstances = selectedSpec ? runtimeNodesForDefinition(liveRun?.nodes ?? [], selectedSpec.id) : []
  const dynamicInstances = (liveRun?.nodes ?? []).filter((node) => node.definitionId || node.id.includes('#'))
  const runStatusKey = runStatusLabelKey(liveRun?.status)

  return (
    <div className="task-workbench flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground/70" aria-live="polite">
        <span>{t(runnerLabelKey(spec.runner, orchestrateOn))}</span>
        <span className="text-foreground/40">{t('tasks.canvasReadOnlyHint')}</span>
        {liveRun && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span>{t('tasks.tabLiveRun')}: {runStatusKey ? t(runStatusKey) : liveRun.status}</span>
            {liveRun.planner && <span>{t(`tasks.planner.${liveRun.planner.phase}`)} · {t('tasks.planner.pending', { count: liveRun.planner.pendingResults.length })}</span>}
            {liveRun.status === 'waiting-coordinator' && (
              <span>{t('tasks.coordinatorWaiting')}: {liveRun.blockers?.join(', ')}</span>
            )}
            {liveRun.blockers?.includes('coordinator-timeout') && <span>{t('tasks.coordinatorTimeout')}</span>}
            {liveRun.metrics?.verifyBudgetRemaining !== undefined && (
              <span>{t('tasks.verifyBudget')}: {liveRun.metrics.verifyBudgetRemaining}</span>
            )}
            {liveRun.metrics?.criticalPathNodeIds?.length ? (
              <span>{t('tasks.criticalPath')}: {liveRun.metrics.criticalPathNodeIds.slice(0, 4).join(' → ')}</span>
            ) : null}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">{t('tasks.explain.view')}
          <select value={view} onChange={event => setView(event.target.value as TaskView)} className="rounded-md border border-border bg-background px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {TASK_VIEWS.map(value => <option key={value} value={value}>{t(`tasks.explain.${value}`)}</option>)}
          </select>
        </label>
        {workspaceId && currentRun && <button type="button" className="rounded-md px-2 py-1.5 text-foreground/75 hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { if (inspection) { historyGeneration.current++; setInspection(null); setCursor(undefined) } else void inspect() }}>{t(inspection ? 'tasks.explain.returnLive' : 'tasks.explain.replay')}</button>}
      </div>
      {historyError && <p role="alert" className="text-xs text-destructive">{historyError}</p>}
      {inspection && <section className="space-y-2 rounded-md border border-border p-3 text-xs">
        <label className="flex items-center gap-3">{t('tasks.explain.replay')} · {inspection.cursor}/{inspection.total} · r{inspection.snapshot.revision}
          <input type="range" min="0" max={inspection.total} value={cursor ?? inspection.cursor} onChange={event => { const value = Number(event.target.value); setCursor(value); void inspect(value) }} className="min-w-20 flex-1" aria-label={t('tasks.explain.replay')} />
        </label>
        {inspection.history[inspection.cursor - 1] && <p>{inspection.history[inspection.cursor - 1]!.time} · {inspection.history[inspection.cursor - 1]!.kind} · {inspection.history[inspection.cursor - 1]!.nodeId}{inspection.history[inspection.cursor - 1]!.reason ? ` · ${inspection.history[inspection.cursor - 1]!.reason}` : ''}</p>}
        {inspection.limitations.map((limit, index) => <p key={index} className="text-muted-foreground">{limit}</p>)}
        {inspection.changes.map((change, index) => <details key={index}><summary className="cursor-pointer">r{change.revision} · {change.reason}</summary><p>{t('tasks.explain.affected')}: {change.impact?.affected.join(', ') ?? t('tasks.notAvailable')}</p><p>{t('tasks.explain.unaffected')}: {change.impact?.unaffected.join(', ')}</p></details>)}
      </section>}
      <details className="text-xs text-foreground/75">
        <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('tasks.explain.preflight')}</summary>
        <div className="mt-2 space-y-2 rounded-md border border-border p-3">
          <p>{t('tasks.explain.frontier')}: {preflight.frontier.map(node => `${node.id}${node.conditional ? ' ?' : ''}`).join(', ') || '—'}</p>
          <p className="text-muted-foreground">{t('tasks.explain.limits')}</p>
          <ul className="space-y-1">{preflight.permissions.map(node => <li key={node.id}>{node.id} · {node.mode} · {t(node.capabilities === 'read-only' ? 'tasks.explain.readOnly' : 'tasks.explain.writes')} {node.approval ? `· ${t('tasks.nodeKindApproval')}` : ''}</li>)}</ul>
          {preflight.unknown.length > 0 && <p>{t('tasks.explain.unknown')}: {preflight.unknown.join(', ')}</p>}
          {preflight.errors.map((error, index) => <p key={`error-${index}`} role="alert" className="text-destructive">{error.path}: {error.message}</p>)}
          {preflight.warnings.map((warning, index) => <p key={`warning-${index}`} className="text-muted-foreground">{warning.path}: {warning.message}</p>)}
        </div>
      </details>
      {liveRun?.planChanges?.length ? <details className="min-w-0 text-[12.5px]">
        <summary className="cursor-pointer rounded-sm text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('tasks.planChanges')}</summary>
        <ol className="mt-2 max-h-32 space-y-2 overflow-auto text-foreground/80">
          {liveRun.planChanges.map(change => <li key={change.decisionId} className="break-words [overflow-wrap:anywhere]">
            <span className="font-medium">r{change.revision} · {t(`tasks.planChange.${change.kind}`)}</span>
            <p>{change.reason}</p>
            <p className="text-foreground/70">
              {change.added.length ? `${t('tasks.planChange.added')}: ${change.added.join(', ')}. ` : ''}
              {change.updated.length ? `${t('tasks.planChange.updated')}: ${change.updated.join(', ')}. ` : ''}
              {change.cancelled.length ? `${t('tasks.planChange.cancelled')}: ${change.cancelled.join(', ')}` : ''}
            </p>
          </li>)}
        </ol>
      </details> : null}
      {liveRun && <ManagedTaskWorkers workers={liveRun.workers} runId={liveRun.runId} onOpenSession={onOpenChildSession} />}
      <ResearchResults research={liveRun?.research} onOpenSession={onOpenChildSession} />
      {liveRun?.artifactAvailability && <p role="status" className="break-words text-[12px] text-warning">{t('tasks.artifactAvailability')}: {liveRun.artifactAvailability.nodeIds.join(', ')} — {liveRun.artifactAvailability.reason}</p>}
      {liveRun?.resumedFrom && <p className="break-words text-[12px] text-foreground/70">{t('tasks.resumedFrom')}: {liveRun.resumedFrom}</p>}
      {liveRun?.supersededBy && <p className="break-words text-[12px] text-foreground/70">{t('tasks.supersededBy')}: {liveRun.supersededBy}</p>}
      <div className="task-workbench-grid grid min-h-[320px] min-w-0 flex-1 shrink-0 gap-3">
        <div ref={graphContainer} className="overflow-hidden rounded-lg border border-border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            deleteKeyCode={null}
            onSelectionChange={(sel) => {
              const id = sel.nodes[0]?.id
              if (id) setSelected(id)
            }}
            onPaneClick={() => setSelected(null)}
            fitView
          >
            <Background />
            <Controls />
            {!compact && <MiniMap />}
          </ReactFlow>
        </div>
        <aside className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-card p-3 text-[12.5px]">
          {selectedSpec ? (
            <div className="flex flex-col gap-2">
              <div className="font-semibold">{selectedSpec.id}</div>
              <div className="text-foreground/55">{t(nodeKindLabelKey(selectedSpec.kind))}</div>
              {selectedPill && selectedLive && (
                <div className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] ${selectedPill.className}`}>
                  {selectedPill.labelKey ? t(selectedPill.labelKey) : selectedLive}
                </div>
              )}
              {nodeDefinitionRows(selectedSpec, spec.nodes).map((row) => (
                <div key={row.key} className="text-foreground/55">
                  <span className="font-medium text-foreground/70">{t(row.labelKey)}: </span>
                  <span className="break-words text-foreground/80">{row.value}</span>
                </div>
              ))}
              {selectedSpec.prompt && <p className="whitespace-pre-wrap break-words text-foreground/80">{selectedSpec.prompt}</p>}
              {selectedInstances.length > 0 && (
                <section className="mt-1 border-t border-border/70 pt-2">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    {t('tasks.runtimeInstances', { count: selectedInstances.length })}
                  </div>
                  <div className="space-y-3">
                    {selectedInstances.map((instance) => {
                      const pill = resolveNodeStatePill(instance.state)
                      return (
                        <div key={instance.id} className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-[11px] font-semibold">{instance.id}</span>
                            <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] ${pill.className}`}>
                              {pill.labelKey ? t(pill.labelKey) : instance.state}
                            </span>
                          </div>
                          <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-foreground/55">
                            <div>
                              <dt className="inline">{t('tasks.nodeModel')}: </dt>
                              <dd className="inline text-foreground/75">{instance.model ?? t('tasks.notAvailable')}</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeTokens')}: </dt>
                              <dd className="inline text-foreground/75">{instance.tokensUsed ?? 0}</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeAttempt')}: </dt>
                              <dd className="inline text-foreground/75">{instance.attempt}</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeRetries')}: </dt>
                              <dd className="inline text-foreground/75">{instance.retryCount ?? 0}</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeElapsed')}: </dt>
                              <dd className="inline text-foreground/75">{instance.elapsedMs ?? 0}ms</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeQueue')}: </dt>
                              <dd className="inline text-foreground/75">{instance.queueMs ?? 0}ms</dd>
                            </div>
                            <div>
                              <dt className="inline">{t('tasks.nodeCache')}: </dt>
                              <dd className="inline text-foreground/75">
                                {instance.cacheStatus === 'hit'
                                  ? t('tasks.nodeCacheHit')
                                  : instance.cacheStatus === 'bypass'
                                    ? t('tasks.nodeCacheBypass')
                                    : instance.cacheStatus === 'miss'
                                      ? t('tasks.nodeCacheMiss')
                                      : instance.cacheStatus ?? t('tasks.notAvailable')}
                              </dd>
                            </div>
                          </dl>
                          {instance.cacheStatus === 'hit' && (
                            <div className="mt-1.5 text-[11px] text-foreground/55">
                              {t('tasks.cacheSource')}: {instance.cacheSourceRunId ?? t('tasks.notAvailable')}
                              {instance.cacheCreatedAt ? ` · ${t('tasks.cacheCreatedAt')}: ${instance.cacheCreatedAt}` : ''}
                            </div>
                          )}
                          {instance.verdict && (
                            <div className="mt-1.5 rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[11px]">
                              <div>{t('tasks.finalVerdict')}: {instance.verdict.result}</div>
                              {instance.verdict.reason && (
                                <div className="text-foreground/70">{instance.verdict.reason}</div>
                              )}
                              {instance.verdict.evidence && (
                                <div className="text-foreground/70">{t('tasks.evidenceSummary')}: {instance.verdict.evidence}</div>
                              )}
                            </div>
                          )}
                          {instance.blocker && (
                            <div className="mt-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                              <span className="font-semibold">{t('tasks.nodeBlocker')}: </span>{instance.blocker}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <p className="text-foreground/45">{t('tasks.canvasInspectorEmpty')}</p>
          )}
          {dynamicInstances.length > 0 && (
            <section className="mt-3 border-t border-border/70 pt-2">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                {t('tasks.dynamicInstances', { count: dynamicInstances.length })}
              </div>
              <div className="space-y-1">
                {dynamicInstances.map((instance) => {
                  const definition = instance.definitionId ?? instance.id.slice(0, instance.id.indexOf('#'))
                  const pill = resolveNodeStatePill(instance.state)
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => setSelected(definition)}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{instance.id}</span>
                      <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] ${pill.className}`}>
                        {pill.labelKey ? t(pill.labelKey) : instance.state}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

export function ConductorWorkbench(props: ConductorWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkbenchInner {...props} />
    </ReactFlowProvider>
  )
}
