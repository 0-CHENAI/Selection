import * as React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { isTasksOrchestrateEnabled } from '@craft-agent/shared/feature-flags'
import {
  PALETTE_KINDS,
  applyGraphToSpec,
  autoLayout,
  classifyEdge,
  deleteImpact,
  specToGraph,
  type CanvasGraph,
  type CanvasKind,
} from './conductor-graph'

export interface WorkbenchSpec {
  id?: string
  title?: string
  goal?: string
  runner?: 'conduct' | 'orchestrate'
  nodes: Array<{ id: string; title?: string; kind?: string; prompt?: string; depends_on?: string[] }>
  ui?: { layout?: { direction?: 'TB' | 'LR'; nodes?: Record<string, { x: number; y: number }> } }
}

interface ConductorWorkbenchProps {
  spec: WorkbenchSpec
  liveRun?: { status: string; nodes: Array<{ id: string; state: string }> } | null
  onSpecChange: (spec: WorkbenchSpec) => void
}

function toFlow(graph: CanvasGraph, live?: ConductorWorkbenchProps['liveRun']): { nodes: Node[]; edges: Edge[] } {
  const stateById = new Map(live?.nodes.map((n) => [n.id, n.state]) ?? [])
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: `${n.title} · ${n.kind}${stateById.get(n.id) ? ` · ${stateById.get(n.id)}` : ''}` },
    })),
    edges: graph.edges.map((e, i) => ({ id: `e-${e.source}-${e.target}-${i}`, source: e.source, target: e.target })),
  }
}

function fromFlow(nodes: Node[], edges: Edge[], spec: WorkbenchSpec): CanvasGraph {
  return {
    nodes: nodes.map((n) => {
      const prev = spec.nodes.find((p) => p.id === n.id)
      return {
        id: n.id,
        title: prev?.title ?? n.id,
        kind: (prev?.kind as CanvasKind) || 'session',
        prompt: prev?.prompt,
        x: n.position.x,
        y: n.position.y,
      }
    }),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  }
}

function WorkbenchInner({ spec, liveRun, onSpecChange }: ConductorWorkbenchProps) {
  const { t } = useTranslation()
  const orchestrateOn = isTasksOrchestrateEnabled()
  const graph = specToGraph(spec)
  const hasCoords = spec.nodes.some((n) => spec.ui?.layout?.nodes?.[n.id])
  const initial = toFlow(hasCoords ? graph : autoLayout(graph), liveRun)
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selected, setSelected] = React.useState<string | null>(null)
  const specKey = spec.nodes.map((n) => n.id).join('|')

  React.useEffect(() => {
    const nextGraph = specToGraph(spec)
    const laid = spec.nodes.some((n) => spec.ui?.layout?.nodes?.[n.id]) ? nextGraph : autoLayout(nextGraph)
    const flow = toFlow(laid, liveRun)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    // Only rematerialize when the node set changes; drag updates keep layout in the spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, liveRun?.status])

  const commit = React.useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      onSpecChange(applyGraphToSpec(spec, fromFlow(nextNodes, nextEdges, spec)))
    },
    [onSpecChange, spec],
  )

  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const conflict = classifyEdge(
        edges.map((e) => ({ source: e.source, target: e.target })),
        { source: connection.source, target: connection.target },
      )
      if (conflict) return
      const next = addEdge(connection, edges)
      setEdges(next)
      commit(nodes, next)
    },
    [edges, nodes, setEdges, commit],
  )

  const addNode = (kind: CanvasKind) => {
    const id = `${kind}-${nodes.length + 1}`.replace(/[^a-z0-9-]/g, '')
    const node: Node = { id, position: { x: 80, y: 80 + nodes.length * 24 }, data: { label: `${id} · ${kind}` } }
    const next = [...nodes, node]
    setNodes(next)
    commit(next, edges)
  }

  const selectedSpec = spec.nodes.find((n) => n.id === selected)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-[12.5px] text-foreground/55">
        <span>
          {spec.runner === 'orchestrate' && !orchestrateOn ? t('tasks.orchestrateBeta') : spec.runner ?? 'conduct'}
        </span>
        {liveRun && !['completed', 'failed', 'stopped'].includes(liveRun.status) && (
          <span className="ml-auto">{t('tasks.canvasActiveRunHint')}</span>
        )}
      </div>
      <div className="grid min-h-[420px] flex-1 grid-cols-[140px_minmax(0,1fr)_220px] gap-2">
        <aside className="flex flex-col gap-1 overflow-auto rounded-lg border border-border bg-card p-2" aria-label={t('tasks.tabCanvas')}>
          {PALETTE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="rounded px-2 py-1 text-left text-[12px] hover:bg-foreground/5"
              onClick={() => addNode(kind)}
            >
              {kind}
            </button>
          ))}
        </aside>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_e, _n, next) => commit(next, edges)}
            onNodesDelete={(deleted) => {
              for (const n of deleted) {
                const impact = deleteImpact({ nodes: [], edges: edges.map((e) => ({ source: e.source, target: e.target })) }, n.id)
                if (impact.dependents.length && !window.confirm(t('tasks.deleteNodeImpact', { id: n.id, nodes: impact.dependents.join(', ') }))) {
                  return
                }
              }
              const ids = new Set(deleted.map((n) => n.id))
              const nextNodes = nodes.filter((n) => !ids.has(n.id))
              const nextEdges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
              setNodes(nextNodes)
              setEdges(nextEdges)
              commit(nextNodes, nextEdges)
            }}
            onSelectionChange={(sel) => setSelected(sel.nodes[0]?.id ?? null)}
            deleteKeyCode={['Backspace', 'Delete']}
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
              <div className="text-foreground/55">{selectedSpec.kind ?? 'session'}</div>
              {selectedSpec.prompt && <p className="whitespace-pre-wrap text-foreground/80">{selectedSpec.prompt}</p>}
            </div>
          ) : (
            <p className="text-foreground/45">{t('tasks.canvasInspectorEmpty')}</p>
          )}
          {liveRun && (
            <div className="mt-3 border-t border-border pt-2 text-foreground/60">
              {t('tasks.tabLiveRun')}: {liveRun.status}
            </div>
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
