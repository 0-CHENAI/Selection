/**
 * Spec ↔ canvas graph helpers. Pure: no React, no fs.
 * Edges are depends_on (source = dependency, target = dependent).
 */
import dagre from '@dagrejs/dagre'

export type CanvasKind =
  | 'session'
  | 'orchestrator'
  | 'route'
  | 'parallel'
  | 'map'
  | 'loop'
  | 'approval'
  | 'synthesize'
  | 'verify'
  | 'judge'
  | 'filter'
  | 'aggregate'
  | 'finally'

export interface CanvasNode {
  id: string
  title: string
  kind: CanvasKind
  prompt?: string
  x: number
  y: number
}

export interface CanvasEdge {
  source: string
  target: string
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export type EdgeConflict = 'self' | 'duplicate' | 'cycle'

export const PALETTE_KINDS: CanvasKind[] = [
  'session',
  'parallel',
  'route',
  'approval',
  'finally',
  'map',
  'loop',
  'synthesize',
  'verify',
  'judge',
  'filter',
  'aggregate',
]

type SpecLike = {
  nodes: Array<{
    id: string
    title?: string
    kind?: string
    prompt?: string
    depends_on?: string[]
  }>
  ui?: { layout?: { direction?: 'TB' | 'LR'; nodes?: Record<string, { x: number; y: number }> } }
}

export function specToGraph(spec: SpecLike): CanvasGraph {
  const layout = spec.ui?.layout?.nodes ?? {}
  const nodes: CanvasNode[] = spec.nodes.map((n, i) => ({
    id: n.id,
    title: n.title ?? n.id,
    kind: (n.kind as CanvasKind) || 'session',
    prompt: n.prompt,
    x: layout[n.id]?.x ?? (i % 4) * 220,
    y: layout[n.id]?.y ?? Math.floor(i / 4) * 120,
  }))
  const edges: CanvasEdge[] = []
  for (const n of spec.nodes) {
    for (const dep of n.depends_on ?? []) {
      if (spec.nodes.some((x) => x.id === dep)) edges.push({ source: dep, target: n.id })
    }
  }
  return { nodes, edges }
}

export function graphToDependsOn(graph: CanvasGraph): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const n of graph.nodes) out[n.id] = []
  for (const e of graph.edges) {
    if (!out[e.target]) out[e.target] = []
    if (!out[e.target]!.includes(e.source)) out[e.target]!.push(e.source)
  }
  return out
}

/**
 * Drag/pan writes coordinates only. Never replace `spec.nodes` from a partial
 * flow selection — xyflow's onNodeDragStop third argument is the dragged set.
 */
export function applyLayoutToSpec<T extends SpecLike>(
  spec: T,
  positions: Record<string, { x: number; y: number }>,
): T {
  const known = new Set(spec.nodes.map((n) => n.id))
  const nodes = { ...spec.ui?.layout?.nodes }
  for (const [id, pos] of Object.entries(positions)) {
    if (known.has(id)) nodes[id] = pos
  }
  return {
    ...spec,
    ui: {
      ...spec.ui,
      layout: {
        ...spec.ui?.layout,
        nodes,
      },
    },
  }
}

export function applyGraphToSpec<T extends SpecLike>(spec: T, graph: CanvasGraph): T {
  const deps = graphToDependsOn(graph)
  const layoutNodes: Record<string, { x: number; y: number }> = {}
  for (const n of graph.nodes) layoutNodes[n.id] = { x: n.x, y: n.y }
  return {
    ...spec,
    nodes: graph.nodes.map((n) => {
      const prev = spec.nodes.find((p) => p.id === n.id)
      return {
        ...prev,
        id: n.id,
        title: n.title,
        kind: n.kind,
        prompt: n.prompt ?? prev?.prompt,
        depends_on: deps[n.id]?.length ? deps[n.id] : undefined,
      }
    }),
    ui: {
      ...spec.ui,
      layout: {
        ...spec.ui?.layout,
        nodes: layoutNodes,
      },
    },
  }
}

export function classifyEdge(edges: CanvasEdge[], next: CanvasEdge): EdgeConflict | null {
  if (next.source === next.target) return 'self'
  if (edges.some((e) => e.source === next.source && e.target === next.target)) return 'duplicate'
  if (wouldCycle([...edges, next])) return 'cycle'
  return null
}

export function wouldCycle(edges: CanvasEdge[]): boolean {
  const incoming = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const e of edges) {
    nodes.add(e.source)
    nodes.add(e.target)
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])
  }
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (seen.has(id)) return false
    visiting.add(id)
    for (const up of incoming.get(id) ?? []) if (visit(up)) return true
    visiting.delete(id)
    seen.add(id)
    return false
  }
  for (const id of nodes) if (visit(id)) return true
  return false
}

export function deleteImpact(graph: CanvasGraph, nodeId: string): { dependents: string[] } {
  return { dependents: graph.edges.filter((e) => e.source === nodeId).map((e) => e.target) }
}

export function autoLayout(graph: CanvasGraph, direction: 'TB' | 'LR' = 'TB'): CanvasGraph {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 48, ranksep: 88 })
  for (const n of graph.nodes) g.setNode(n.id, { width: 196, height: 72 })
  for (const e of graph.edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return {
    nodes: graph.nodes.map((n) => {
      const p = g.node(n.id)
      return { ...n, x: (p?.x ?? n.x) - 98, y: (p?.y ?? n.y) - 36 }
    }),
    edges: graph.edges,
  }
}

export function layerLayout(graph: CanvasGraph, direction: 'TB' | 'LR' = 'TB'): CanvasGraph {
  const incoming = new Map<string, number>()
  for (const n of graph.nodes) incoming.set(n.id, 0)
  for (const e of graph.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
  const layers: string[][] = []
  const placed = new Set<string>()
  let frontier = graph.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id)
  while (frontier.length) {
    layers.push(frontier)
    for (const id of frontier) placed.add(id)
    const next: string[] = []
    for (const e of graph.edges) {
      if (placed.has(e.source) && !placed.has(e.target) && !next.includes(e.target)) {
        const remaining = graph.edges.filter((x) => x.target === e.target && !placed.has(x.source)).length
        if (remaining === 0) next.push(e.target)
      }
    }
    frontier = next
  }
  for (const n of graph.nodes) if (!placed.has(n.id)) layers.push([n.id])
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const nodes = graph.nodes.map((n) => {
    const layer = layers.findIndex((l) => l.includes(n.id))
    const index = Math.max(0, layers[layer]?.indexOf(n.id) ?? 0)
    const x = direction === 'LR' ? layer * 240 : index * 220
    const y = direction === 'LR' ? index * 120 : layer * 140
    return { ...byId.get(n.id)!, x, y }
  })
  return { nodes, edges: graph.edges }
}
