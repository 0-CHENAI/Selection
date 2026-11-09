import { describe, expect, it } from 'bun:test'
import {
  specToGraph,
  applyGraphToSpec,
  autoLayout,
  classifyEdge,
  deleteImpact,
  hasCompleteLayout,
  layerLayout,
  overlayState,
  specTopologyKey,
  type SpecLike,
} from '../conductor-graph.ts'

const SPEC: SpecLike = {
  nodes: [
    { id: 'a', title: 'A', kind: 'session', prompt: 'a' },
    { id: 'b', title: 'B', kind: 'session', prompt: 'b', depends_on: ['a'] },
    { id: 'c', title: 'C', kind: 'approval', depends_on: ['b'] },
  ],
}

describe('conductor-graph', () => {
  it('round-trips depends_on through canvas edges', () => {
    const graph = specToGraph(SPEC)
    expect(graph.edges).toEqual([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ])
    const next = applyGraphToSpec(SPEC, graph)
    expect(next.nodes.find((n) => n.id === 'b')?.depends_on).toEqual(['a'])
    expect(next.ui?.layout?.nodes?.a).toBeDefined()
  })

  it('specTopologyKey changes when depends_on changes, not when layout is incomplete', () => {
    const a = specTopologyKey(SPEC)
    const b = specTopologyKey({
      ...SPEC,
      nodes: SPEC.nodes.map((n) => (n.id === 'c' ? { ...n, depends_on: ['a', 'b'] } : n)),
    })
    expect(a).not.toBe(b)
  })

  it('hasCompleteLayout is false when only a dragged leftover coordinate exists', () => {
    expect(hasCompleteLayout(SPEC)).toBe(false)
    expect(hasCompleteLayout({ ...SPEC, ui: { layout: { nodes: { b: { x: 80, y: 90 } } } } })).toBe(false)
    expect(
      hasCompleteLayout({
        ...SPEC,
        ui: { layout: { nodes: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } } } },
      }),
    ).toBe(true)
  })

  it('overlayState folds map instances onto the definition node and ignores prefix siblings', () => {
    const live = {
      nodes: [
        { id: 'fan#0', state: 'done' },
        { id: 'fan#1', state: 'running' },
        { id: 'fanout', state: 'failed' },
      ],
    }
    expect(overlayState('fan', live)).toBe('running')
    expect(overlayState('fanout', live)).toBe('failed')
    expect(overlayState('other', live)).toBeUndefined()
  })

  it('rejects self-loops, duplicates, and cycles immediately', () => {
    const edges = [{ source: 'a', target: 'b' }]
    expect(classifyEdge(edges, { source: 'x', target: 'x' })).toBe('self')
    expect(classifyEdge(edges, { source: 'a', target: 'b' })).toBe('duplicate')
    expect(classifyEdge(edges, { source: 'b', target: 'a' })).toBe('cycle')
    expect(classifyEdge(edges, { source: 'b', target: 'c' })).toBeNull()
  })

  it('reports dependents that would be left hanging after a delete', () => {
    expect(deleteImpact(specToGraph(SPEC), 'a').dependents).toEqual(['b'])
  })

  it('auto-layouts a chain with dagre ranks', () => {
    const laid = autoLayout(specToGraph(SPEC), 'TB')
    const a = laid.nodes.find((n) => n.id === 'a')!
    const c = laid.nodes.find((n) => n.id === 'c')!
    expect(a.y).toBeLessThan(c.y)
  })

  it('lays out a chain without overlapping ranks', () => {
    const laid = layerLayout(specToGraph(SPEC), 'TB')
    const a = laid.nodes.find((n) => n.id === 'a')!
    const b = laid.nodes.find((n) => n.id === 'b')!
    const c = laid.nodes.find((n) => n.id === 'c')!
    expect(a.y).toBeLessThan(b.y)
    expect(b.y).toBeLessThan(c.y)
  })
})
