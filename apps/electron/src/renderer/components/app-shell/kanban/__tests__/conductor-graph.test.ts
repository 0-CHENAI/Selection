import { describe, expect, it } from 'bun:test'
import {
  specToGraph,
  applyGraphToSpec,
  applyLayoutToSpec,
  autoLayout,
  classifyEdge,
  deleteImpact,
  layerLayout,
} from '../conductor-graph.ts'

const SPEC = {
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

  it('applyLayoutToSpec writes one dragged position without dropping generated nodes', () => {
    const spec = {
      ...SPEC,
      ui: { layout: { nodes: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 20, y: 20 } } } },
    }
    const next = applyLayoutToSpec(spec, { b: { x: 80, y: 90 }, ghost: { x: 1, y: 1 } })
    expect(next.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(next.nodes).toEqual(spec.nodes)
    expect(next.ui?.layout?.nodes).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 80, y: 90 },
      c: { x: 20, y: 20 },
    })
  })

  it('applyGraphToSpec replaces the node table (delete/add), so drag must not use a partial graph', () => {
    const graph = specToGraph(SPEC)
    const draggedOnly = { nodes: graph.nodes.filter((n) => n.id === 'b'), edges: graph.edges }
    const next = applyGraphToSpec(SPEC, draggedOnly)
    expect(next.nodes.map((n) => n.id)).toEqual(['b'])
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
