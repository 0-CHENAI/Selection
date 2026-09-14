/**
 * Execution topology editor. Without onChange this remains a read-only run surface.
 */
import * as React from 'react'
import { nodeDefinitionRows, runtimeNodesForDefinition } from './conductor-inspector'
export { nodeDefinitionRows, runtimeNodesForDefinition } from './conductor-inspector'
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
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { resolveNodeStatePill } from './node-state-pill'
import { nodeKindLabelKey, runStatusLabelKey, runnerLabelKey } from './task-labels'
import type { EditorNodeKind } from './task-spec-form'
import { SESSION_LIKE_KINDS, EDITOR_NODE_KINDS } from './task-spec-form'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/ThemeContext'
import type { KanbanModelProviderGroup } from './types'
import {
  autoLayout,
  applyGraphToSpec,
  classifyEdge,
  deleteImpact,
  referencedBy,
  hasCompleteLayout,
  overlayState,
  specToGraph,
  specTopologyKey,
  type CanvasGraph,
} from './conductor-graph'

export type WorkbenchNode = {
  id: string
  title?: string
  kind?: EditorNodeKind
  prompt?: string
  depends_on?: string[]
  permissionMode?: string
  model?: string
  llmConnection?: string
  outputs?: Array<{ name?: string; kind?: string; type?: string }>
  loop?: unknown
  for_each?: string
  route?: unknown
  when?: unknown
}

export interface WorkbenchSpec {
  id?: string
  title?: string
  goal?: string
  runner?: 'conduct' | 'orchestrate'
  nodes: WorkbenchNode[]
  ui?: { layout?: { direction?: 'TB' | 'LR'; nodes?: Record<string, { x: number; y: number }> } }
}


interface ConductorWorkbenchProps {
  spec: WorkbenchSpec
  liveRun?: TaskRunSnapshotDto | null
  compact?: boolean
  onChange?: (spec: WorkbenchSpec) => void
  onPendingChange?: (pending: boolean) => void
  modelGroups?: KanbanModelProviderGroup[]
  renderNodeSources?: (nodeId: string) => React.ReactNode
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

function WorkbenchInner({ spec, liveRun, compact, onChange, onPendingChange, modelGroups = [], renderNodeSources }: ConductorWorkbenchProps) {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const { fitView } = useReactFlow()
  const orchestrateOn = isTasksOrchestrateEnabled()
  const initial = displayFlow(spec, liveRun, t)
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [newNodeKind, setNewNodeKind] = React.useState<EditorNodeKind>('session')
  const [editError, setEditError] = React.useState('')
  const [nodeDrafts, setNodeDrafts] = React.useState<Record<string, { base: string; text: string }>>({})
  const pending = spec.nodes.some(node => nodeDrafts[node.id] && nodeDrafts[node.id]!.text !== JSON.stringify(node, null, 2))
  React.useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  React.useEffect(() => () => { onPendingChange?.(false) }, [onPendingChange])
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
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
  // Parent graph/layout updates recreate node objects. Only a changed definition
  // should replace the editor input, not a new reference to identical fields.
  const selectedDefinition = selectedSpec ? JSON.stringify(selectedSpec, null, 2) : ''
  const selectedDraft = selected ? nodeDrafts[selected] : undefined
  const nodeJson = selectedDraft?.text ?? selectedDefinition
  const draftConflict = !!selectedDraft && selectedDraft.base !== selectedDefinition && selectedDraft.text !== selectedDefinition
  const setNodeJson = (text: string) => {
    if (!selected) return
    setNodeDrafts(previous => ({ ...previous, [selected]: { base: previous[selected]?.base ?? selectedDefinition, text } }))
  }
  const resetNodeDraft = () => {
    if (!selected) return
    setNodeDrafts(previous => { const next = { ...previous }; delete next[selected]; return next })
  }
  const editableNode = React.useMemo(() => {
    try {
      const value = JSON.parse(nodeJson)
      return value && typeof value === 'object' && !Array.isArray(value) && value.id === selectedSpec?.id ? value as WorkbenchNode : null
    } catch { return null }
  }, [nodeJson, selectedSpec?.id])
  const patchNodeDraft = (patch: Partial<WorkbenchNode>) => {
    if (editableNode) setNodeJson(JSON.stringify({ ...editableNode, ...patch }, null, 2))
  }
  const commitGraph = (graph: CanvasGraph) => { setEditError(''); onChange?.(applyGraphToSpec(spec, graph)) }
  const currentGraph = (): CanvasGraph => {
    const graph = specToGraph(spec)
    return { ...graph, nodes: graph.nodes.map(n => { const p = nodes.find(item => item.id === n.id)?.position; return p ? { ...n, ...p } : n }) }
  }
  const selectedLive = selectedSpec ? definitionOverlayState(selectedSpec.id, liveRun) : undefined
  const selectedPill = selectedLive ? resolveNodeStatePill(selectedLive) : null
  const selectedInstances = selectedSpec ? runtimeNodesForDefinition(liveRun?.nodes ?? [], selectedSpec.id) : []
  const dynamicInstances = (liveRun?.nodes ?? []).filter((node) => node.definitionId || node.id.includes('#'))
  const runStatusKey = runStatusLabelKey(liveRun?.status)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground/55">
        <span>{t(runnerLabelKey(spec.runner, orchestrateOn))}</span>
        {!onChange && <span className="text-foreground/40">{t('tasks.canvasReadOnlyHint')}</span>}
        {onChange && <><select aria-label={t('tasks.inspectorKind')} className="rounded border border-border bg-background p-1 text-sm" value={newNodeKind} onChange={event => setNewNodeKind(event.target.value as EditorNodeKind)}>
          {EDITOR_NODE_KINDS.map(kind => <option key={kind} value={kind}>{t(nodeKindLabelKey(kind))}</option>)}
        </select><Button variant="outline" size="sm" onClick={() => {
          const graph = currentGraph()
          const id = `node-${crypto.randomUUID().slice(0, 8)}`
          commitGraph({ ...graph, nodes: [...graph.nodes, { id, title: id, kind: newNodeKind, ...(SESSION_LIKE_KINDS.has(newNodeKind) ? { prompt: '' } : {}), x: 0, y: graph.nodes.length * 100 }] })
          setSelected(id)
        }}>{t('tasks.addNode')}</Button></>}
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
      {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
      <div className={`grid flex-1 grid-cols-1 grid-rows-[minmax(240px,1fr)_auto] gap-2 md:grid-cols-[minmax(0,1fr)_260px] md:grid-rows-1 ${compact ? 'min-h-0' : 'min-h-[420px]'}`}>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ReactFlow
            colorMode={isDark ? 'dark' : 'light'}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesDraggable={!!onChange}
            nodesConnectable={!!onChange}
            onNodeDragStop={(_, dragged) => {
              if (!onChange) return
              const graph = currentGraph()
              commitGraph({ ...graph, nodes: graph.nodes.map(n => n.id === dragged.id ? { ...n, ...dragged.position } : n) })
            }}
            onConnect={connection => {
              if (!onChange) return
              const graph = currentGraph()
              const conflict = classifyEdge(graph.edges, connection)
              if (conflict) { setEditError(t(`tasks.edge${conflict === 'self' ? 'Self' : conflict === 'duplicate' ? 'Duplicate' : 'Cycle'}`)); return }
              commitGraph({ ...graph, edges: [...graph.edges, { source: connection.source, target: connection.target }] })
            }}
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
        <aside className="max-h-64 overflow-auto rounded-lg border border-border bg-card p-2 text-[12.5px] md:max-h-none">
          {selectedSpec ? (
            <div className="flex flex-col gap-2">
              <div className="font-semibold">{selectedSpec.id}</div>
              <div className="text-foreground/55">{t(nodeKindLabelKey(selectedSpec.kind))}</div>
              {renderNodeSources?.(selectedSpec.id)}
              {onChange && <>
                {selectedDraft && <div className="flex flex-wrap items-center gap-2">
                  <span role="status" className="text-xs text-muted-foreground">{draftConflict ? t('tasks.toastEtagConflict') : t('thought.unsaved')}</span>
                  <Button variant="ghost" size="sm" onClick={resetNodeDraft}>{t('common.reset')}</Button>
                </div>}
                {pendingDelete === selectedSpec.id ? <div role="alert" className="space-y-2 rounded border border-destructive/40 p-2">
                  <p>{t('tasks.deleteNodeImpact', { dependencies: deleteImpact(currentGraph(), selectedSpec.id).dependents.join(', ') || '—', references: referencedBy(spec, selectedSpec.id).join(', ') || '—' })}</p>
                  <Button variant="destructive" size="sm" disabled={referencedBy(spec, selectedSpec.id).length > 0} onClick={() => {
                    const graph = currentGraph(); commitGraph({ nodes: graph.nodes.filter(n => n.id !== selectedSpec.id), edges: graph.edges.filter(e => e.source !== selectedSpec.id && e.target !== selectedSpec.id) }); setPendingDelete(null)
                  }}>{t('common.delete')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</Button>
                </div> : <Button variant="ghost" size="sm" onClick={() => setPendingDelete(selectedSpec.id)}>{t('common.delete')}</Button>}
                <label className="space-y-1">{t('tasks.title')}<input className="w-full rounded border border-border bg-background p-2 text-sm" disabled={!editableNode} value={editableNode?.title ?? ''} onChange={event => patchNodeDraft({ title: event.target.value })} /></label>
                {SESSION_LIKE_KINDS.has(editableNode?.kind ?? selectedSpec.kind ?? 'session') && <>
                  <label className="space-y-1">{t('tasks.nodeModel')}<select className="w-full rounded border border-border bg-background p-2 text-sm" disabled={!editableNode} value={JSON.stringify([editableNode?.llmConnection ?? '', editableNode?.model ?? ''])} onChange={event => {
                    const [llmConnection, model] = JSON.parse(event.target.value) as [string, string]
                    patchNodeDraft({ model: model || undefined, llmConnection: llmConnection || undefined })
                  }}>
                    <option value={'["",""]'}>—</option>
                    {(editableNode?.model || editableNode?.llmConnection) && !modelGroups.some(group => group.connectionSlug === editableNode.llmConnection && group.models.some(model => model.id === editableNode.model)) && <option value={JSON.stringify([editableNode.llmConnection ?? '', editableNode.model ?? ''])}>{editableNode.llmConnection} · {editableNode.model}</option>}
                    {modelGroups.map((group, index) => <optgroup key={`${group.connectionSlug}:${index}`} label={group.label}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.connectionSlug ?? '', model.id])}>{model.name}</option>)}</optgroup>)}
                  </select></label>
                  <textarea aria-label={t('tasks.promptPlaceholder')} placeholder={t('tasks.promptPlaceholder')} className="min-h-40 w-full rounded border border-border bg-background p-2 text-sm" disabled={!editableNode} value={editableNode?.prompt ?? ''} onChange={event => patchNodeDraft({ prompt: event.target.value })} />
                  <label className="space-y-1">{t('tasks.nodePermission')}<select className="w-full rounded border border-border bg-background p-2 text-sm" disabled={!editableNode} value={editableNode?.permissionMode ?? ''} onChange={event => patchNodeDraft({ permissionMode: event.target.value || undefined })}>
                    <option value="">—</option>
                    {(['safe', 'ask', 'allow-all'] as const).map(mode => <option key={mode} value={mode}>{t(`mode.${mode}`)}</option>)}
                    {editableNode?.permissionMode && !['safe', 'ask', 'allow-all'].includes(editableNode.permissionMode) && <option value={editableNode.permissionMode}>{editableNode.permissionMode}</option>}
                  </select></label>
                </>}
                <details><summary className="cursor-pointer">{t('tasks.nodeConfig')} · JSON</summary>
                  <textarea aria-label={t('tasks.nodeConfig')} className="mt-2 min-h-64 w-full rounded border border-border bg-background p-2 font-mono text-xs" value={nodeJson} onChange={event => setNodeJson(event.target.value)} />
                </details>
                <Button size="sm" disabled={draftConflict} onClick={() => {
                  if (draftConflict) return
                  try {
                    const next = JSON.parse(nodeJson) as WorkbenchNode
                    if (!next || Array.isArray(next) || next.id !== selectedSpec.id || (next.depends_on !== undefined && (!Array.isArray(next.depends_on) || next.depends_on.some(id => typeof id !== 'string' || !spec.nodes.some(n => n.id === id))))) throw new Error(t('tasks.invalidNodeConfig'))
                    const updated = { ...spec, nodes: spec.nodes.map(n => n.id === next.id ? next : n) }
                    const checked: CanvasGraph['edges'] = []
                    for (const edge of specToGraph(updated).edges) { if (classifyEdge(checked, edge)) throw new Error(t('tasks.invalidNodeConfig')); checked.push(edge) }
                    setEditError(''); onChange(updated); resetNodeDraft()
                  } catch (error) { setEditError(error instanceof Error ? error.message : String(error)) }
                }}>{t('common.apply')}</Button>
                {(selectedSpec.depends_on ?? []).map(id => <Button key={id} variant="ghost" size="sm" onClick={() => {
                  const graph = currentGraph(); commitGraph({ ...graph, edges: graph.edges.filter(e => !(e.source === id && e.target === selectedSpec.id)) })
                }}>{t('tasks.removeDependency', { id })}</Button>)}
              </>}
              {selectedPill && selectedLive && (
                <div className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] ${selectedPill.className}`}>
                  {selectedPill.labelKey ? t(selectedPill.labelKey) : selectedLive}
                </div>
              )}
              {nodeDefinitionRows(selectedSpec).map((row) => (
                <div key={row.key} className="text-foreground/55">
                  <span className="font-medium text-foreground/70">{t(row.labelKey)}: </span>
                  <span className="break-words text-foreground/80">{row.value}</span>
                </div>
              ))}
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
