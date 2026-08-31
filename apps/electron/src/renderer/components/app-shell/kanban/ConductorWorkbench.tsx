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
  liveRun?: { status: string; nodes: Array<{ id: string; state: string }> } | null
}

function nodeLabel(
  n: { id: string; title?: string; kind?: string },
  live: ConductorWorkbenchProps['liveRun'],
  translate: (key: string) => string,
): string {
  const state = overlayState(n.id, live)
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
  const liveKey = `${liveRun?.status ?? ''}:${(liveRun?.nodes ?? []).map((n) => `${n.id}:${n.state}`).join('|')}`

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
  const selectedLive = selectedSpec ? overlayState(selectedSpec.id, liveRun) : undefined
  const selectedPill = selectedLive ? resolveNodeStatePill(selectedLive) : null
  const runStatusKey = runStatusLabelKey(liveRun?.status)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-[12.5px] text-foreground/55">
        <span>{t(runnerLabelKey(spec.runner, orchestrateOn))}</span>
        <span className="text-foreground/40">{t('tasks.canvasReadOnlyHint')}</span>
        {liveRun && (
          <span className="ml-auto">
            {t('tasks.tabLiveRun')}: {runStatusKey ? t(runStatusKey) : liveRun.status}
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
            </div>
          ) : (
            <p className="text-foreground/45">{t('tasks.canvasInspectorEmpty')}</p>
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
