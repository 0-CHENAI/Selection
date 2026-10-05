import { expect, test } from 'bun:test'
import { buildChatPlan, chatRequestKey, chatInputHash } from './chat-plan'
const root = { id: 'root', model: 'model', permissionMode: 'safe' as const, workingDirectory: '/work', projectId: 'project' }
const input = { requestId: 'create-1', title: 'Research', description: 'Compare costs' }
test('chat plans preserve root defaults and derive stable root-scoped ownership', () => {
  const plan = buildChatPlan(input, root)
  expect(plan.defaults).toEqual({ model: 'model', permissionMode: 'safe' })
  expect(plan.schema_version).toBe(3)
  expect(buildChatPlan(input, { ...root, originalRequest: 'Original goal with user constraints' }).goal).toBe('Original goal with user constraints')
  expect(plan.locked_fields).toEqual(['goal', 'acceptance_criteria'])
  expect(plan.id).toBe(buildChatPlan({ ...input, requestId: 'retry' }, root).id)
  expect(plan.id).not.toBe(buildChatPlan(input, { ...root, id: 'other' }).id)
  expect(chatRequestKey(root.id, 'create-1')).not.toBe(chatRequestKey('other', 'create-1'))
  expect(chatInputHash({ a: 1, b: 2 })).toBe(chatInputHash({ b: 2, a: 1 }))
})
test('creation rejects ambiguous or escalated plans before writing', () => {
  const plan = buildChatPlan(input, root)
  expect(() => buildChatPlan({ ...input, requestId: '' }, root)).toThrow()
  expect(() => buildChatPlan({ requestId: 'bad-field', spec: { ...plan, acceptanceCriteria: 'Wrong casing' } }, root)).toThrow()
  expect(() => buildChatPlan({ requestId: 'new', spec: { ...plan, sources: ['unapproved-source'] } }, root)).toThrow('source scope')
  expect(buildChatPlan({ requestId: 'same', spec: { ...plan, sources: ['approved-source'] } }, { ...root, enabledSourceSlugs: ['approved-source'] }).sources).toEqual(['approved-source'])
  expect(() => buildChatPlan({ ...input, model: 'unapproved-model' }, root)).toThrow('current model')
  expect(() => buildChatPlan({ ...input, projectId: 'elsewhere' }, root)).toThrow('current project')
  expect(() => buildChatPlan({ requestId: 'new', spec: { ...plan, defaults: { permissionMode: 'allow-all' } } }, root)).toThrow('authorization')
  expect(() => buildChatPlan({ requestId: 'new', spec: { ...plan, nodes: [{ id: 'work', kind: 'session', prompt: 'Do work', permissionMode: 'allow-all' }] } }, root)).toThrow('ceiling')
})

test('new chat research plans require host-owned original-read receipts', () => {
  const plan = buildChatPlan({ requestId: 'research', spec: {
    title: 'Research', goal: 'Verify cost', nodes: [{ id: 'work', prompt: 'Read originals', researchRole: 'researcher', outputs: [{ name: 'research', kind: 'param', type: 'json', required: true }] }],
    research: { line: { id: 'main', question: 'Cost' }, dimensions: [{ id: 'cost', requirement: 'Verify cost' }], sources: [] },
  } }, root)
  expect(plan.research?.assuranceVersion).toBe(2)
})
