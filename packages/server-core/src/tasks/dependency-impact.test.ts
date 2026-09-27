import { expect, test } from 'bun:test'
import { dependencyImpact, dependencyAncestors } from './dependency-impact'

test('upstream changes invalidate only transitive consumers and unscoped finalizers', () => {
  const nodes: { id: string; kind?: string }[] = ['source', 'consumer', 'leaf', 'independent'].map(id => ({ id }))
  nodes.push({ id: 'finalizer', kind: 'finally' })
  const edges = new Map([['consumer', new Set(['source'])], ['leaf', new Set(['consumer'])]])
  expect([...dependencyImpact(new Set(['source']), nodes, edges)].sort()).toEqual(['consumer', 'finalizer', 'leaf', 'source'])
  expect([...dependencyImpact(new Set(), nodes, edges)]).toEqual([])
})

test('shared consumers are visited once even with cycles and multiple changed inputs', () => {
  const nodes = ['a', 'b', 'shared', 'other'].map(id => ({ id }))
  const edges = new Map([['shared', new Set(['a', 'b'])], ['a', new Set(['shared'])]])
  expect([...dependencyImpact(new Set(['a', 'b']), nodes, edges)].sort()).toEqual(['a', 'b', 'shared'])
})


test('artifact ancestry survives text-only intermediates and excludes unrelated roots', () => {
  const edges = new Map([
    ['leaf', new Set(['summary'])], ['summary', new Set(['artifact'])],
    ['artifact', new Set(['leaf'])], ['unrelated', new Set(['other'])],
  ])
  expect([...dependencyAncestors('leaf', edges)]).toEqual(['summary', 'artifact'])
  expect([...dependencyAncestors('other', edges)]).toEqual([])
})
