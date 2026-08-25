import { describe, expect, it } from 'bun:test'
import {
  specToGraph,
  applyGraphToSpec,
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
