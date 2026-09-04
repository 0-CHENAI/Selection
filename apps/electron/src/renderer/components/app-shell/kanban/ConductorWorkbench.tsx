/**
 * Read-only topology + live-run overlay.
 * Authoring stays on the definition tab and YAML — this surface never writes spec.nodes.
 */
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
import { nodeKindLabelKey, runStatusLabelKey, runnerLabelKey } from './task-labels'
import type { EditorNodeKind } from './task-spec-form'
import {
  autoLayout,
  hasCompleteLayout,
  overlayState,
  specToGraph,
  specTopologyKey,
  type CanvasGraph,
} from './conductor-graph'

export interface WorkbenchSpec {
  id?: string
  title?: string
  goal?: string
  runner?: 'conduct' | 'orchestrate'
  nodes: Array<{ id: string; title?: string; kind?: EditorNodeKind; prompt?: string; depends_on?: string[] }>
  ui?: { layout?: { direction?: 'TB' | 'LR'; nodes?: Record<string, { x: number; y: number }> } }
}

interface ConductorWorkbenchProps {
  spec: WorkbenchSpec
  liveRun?: TaskRunSnapshotDto | null
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
      data: { label: nodeLabel(byId.get(n.id) ?? n, live, translate) },
    })),
    edges: graph.edges.map((e, i) => ({ id: `e-${e.source}-${e.target}-${i}`, source: e.source, target: e.target })),
  }
}

function displayFlow(spec: WorkbenchSpec, live: ConductorWorkbenchProps['liveRun'], translate: (key: string) => string) {
  const graph = specToGraph(spec)
  const laid = hasCompleteLayout(spec) ? graph : autoLayout(graph, spec.ui?.layout?.direction)
  return toFlow(laid, spec, live, translate)
}

function WorkbenchInner({ spec, liveRun }: ConductorWorkbenchProps) {
  const { t } = useTranslation()
  const { fitView } = useReactFlow()
  const orchestrateOn = isTasksOrchestrateEnabled()
  const initial = displayFlow(spec, liveRun, t)
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selected, setSelected] = React.useState<string | null>(null)
  const topologyKey = specTopologyKey(spec)
  const liveKey = `${liveRun?.status ?? ''}:${liveRun?.metrics?.elapsedMs ?? ''}:${liveRun?.metrics?.cacheHits ?? ''}:${(liveRun?.nodes ?? []).map((n) => `${n.id}:${n.state}:${n.cacheStatus}:${n.elapsedMs}:${n.verdict?.result}`).join('|')}`

  React.useEffect(() => {
    const flow = displayFlow(spec, liveRun, t)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey])

  React.useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const authored = spec.nodes.find((p) => p.id === n.id)
        if (!authored) return n
        const label = nodeLabel(authored, liveRun, t)
        return n.data.label === label ? n : { ...n, data: { ...n.data, label } }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  React.useEffect(() => {
    const id = requestAnimationFrame(() => fitView({ padding: 0.2 }))
    return () => cancelAnimationFrame(id)
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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-[12.5px] text-foreground/55">
        <span>{t(runnerLabelKey(spec.runner, orchestrateOn))}</span>
        <span className="text-foreground/40">{t('tasks.canvasReadOnlyHint')}</span>
        {liveRun && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span>{t('tasks.tabLiveRun')}: {runStatusKey ? t(runStatusKey) : liveRun.status}</span>
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
      <div className="grid min-h-[420px] flex-1 grid-cols-[minmax(0,1fr)_220px] gap-2">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
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
            <MiniMap />
          </ReactFlow>
        </div>
        <aside className="overflow-auto rounded-lg border border-border bg-card p-2 text-[12.5px]">
          {selectedSpec ? (
            <div className="flex flex-col gap-2">
              <div className="font-semibold">{selectedSpec.id}</div>
              <div className="text-foreground/55">{t(nodeKindLabelKey(selectedSpec.kind))}</div>
              {selectedPill && selectedLive && (
                <div className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] ${selectedPill.className}`}>
                  {selectedPill.labelKey ? t(selectedPill.labelKey) : selectedLive}
                </div>
              )}
              {selectedSpec.prompt && <p className="whitespace-pre-wrap text-foreground/80">{selectedSpec.prompt}</p>}
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
