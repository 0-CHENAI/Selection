import { expect, test } from 'bun:test'
import { taskProposalChanges } from '../task-proposal-diff'

test('inserting a node preserves stable ids, and reports prompt/config/dependency changes precisely', () => {
  const a = { id: 'a', kind: 'session', prompt: 'read', model: 'manual', llmConnection: 'custom' }
  const b = { id: 'b', prompt: 'English report', depends_on: ['a'], inputs: { text: '${nodes.a.output}' } }
  const base = { id: 'report', defaults: { permissionMode: 'safe' }, nodes: [a, b] }
  const next = { ...base, nodes: [a, { id: 'dedup', prompt: 'dedup', depends_on: ['a'] }, { ...b, prompt: '中文报告', depends_on: ['dedup'] }] }
  const changes = taskProposalChanges(base, next)
  expect(changes.map(change => change.path)).toEqual(['nodes.b.prompt', 'nodes.b.depends_on', 'nodes.dedup'])
  expect(changes[0]).toEqual({ path: 'nodes.b.prompt', before: 'English report', after: '中文报告' })
  expect(changes.some(change => change.path.startsWith('nodes.a') || change.path.startsWith('defaults'))).toBe(false)
  expect(taskProposalChanges(next, base).find(change => change.path === 'nodes.dedup')?.after).toBeUndefined()
})
