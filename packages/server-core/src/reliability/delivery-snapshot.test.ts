import { expect, test } from 'bun:test'
import { deliverySnapshot } from './delivery-snapshot'
import type { IsolatedWorkspace } from './isolated-workspace'

const fixture = (): IsolatedWorkspace => ({ version: 1, id: 'test', kind: 'files', directory: '/candidate', sourceRoot: '/project', inputs: {}, status: 'ready', deliveryContract: { version: 1, inputs: [], outputs: { result: 'result.txt' } } })

test('inactive work never advertises ongoing validation or integration', () => {
  for (const phase of ['validating', 'integrating'] as const) {
    const state = fixture(); state.deliveryProgress = { phase }
    expect(deliverySnapshot(state, true)?.phase).toBe(phase)
    expect(deliverySnapshot(state, false)?.phase).toBe('needs-attention')
  }
  const state = fixture()
  state.pendingDelivery = { version: 1, outputs: { result: 'result.txt' }, hashes: {}, checks: [] }
  expect(deliverySnapshot(state, false)?.phase).toBe('needs-attention')
  expect(deliverySnapshot(state, true)?.phase).toBe('integrating')
})

test('durable result wins over transient state and snapshots do not mutate storage', () => {
  const state = fixture()
  state.deliveryProgress = { phase: 'conflict', conflicts: ['result.txt'] }
  expect(deliverySnapshot(state, false)?.phase).toBe('conflict')
  state.delivery = { version: 1, outputs: { result: 'result.txt' }, hashes: {}, checks: ['file verified'] }
  const snapshot = deliverySnapshot(state, false)!
  expect(snapshot.phase).toBe('integrated')
  expect(snapshot.conflicts).toEqual([])
  snapshot.outputs.result = 'other.txt'; snapshot.checks.push('changed')
  expect(state.deliveryContract!.outputs.result).toBe('result.txt')
  expect(state.delivery.checks).toEqual(['file verified'])
  expect(deliverySnapshot(undefined, false)).toBeUndefined()
})
