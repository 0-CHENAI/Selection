import { expect, it } from 'bun:test'
import { runThoughtReplay } from './thought-replay'
import type { ThoughtGeneration, ThoughtReplay } from '@craft-agent/shared/thought-workbench/types'

const initial = (): ThoughtReplay => ({ id: 'replay', documentId: 'doc', nodeIds: ['a', 'b'], completedNodeIds: [], status: 'running' })
const result = (id: string, status: ThoughtGeneration['status'] = 'completed'): ThoughtGeneration => ({ id, documentId: 'doc', nodeId: id, sessionId: 'session', contextHash: 'hash', status })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

it('waits for each answer before dispatching the next node', async () => {
  const first = deferred<ThoughtGeneration>()
  const calls: string[] = []
  const snapshots: ThoughtReplay[] = []
  const controller = runThoughtReplay(initial(), {
    persist: value => snapshots.push(structuredClone(value)), cancel: async () => {},
    start: async id => { calls.push(id); return { generationId: id, finished: id === 'a' ? first.promise : Promise.resolve(result(id)) } },
  })
  await Promise.resolve()
  expect(calls).toEqual(['a'])
  first.resolve(result('a'))
  expect((await controller.finished).completedNodeIds).toEqual(['a', 'b'])
  expect(calls).toEqual(['a', 'b'])
  expect(snapshots.at(-1)?.status).toBe('completed')
})
it('cancels an in-flight start and never dispatches the remaining queue', async () => {
  const start = deferred<{ generationId: string; finished: Promise<ThoughtGeneration> }>()
  const cancelled: string[] = []
  const calls: string[] = []
  const controller = runThoughtReplay(initial(), { persist() {}, start: async id => { calls.push(id); return start.promise }, cancel: async id => { cancelled.push(id) } })
  await controller.cancel()
  start.resolve({ generationId: 'a', finished: Promise.resolve(result('a')) })
  expect((await controller.finished).status).toBe('interrupted')
  expect(calls).toEqual(['a'])
  expect(cancelled).toEqual(['a'])
})
it('stops at a failed or interrupted generation instead of rerunning tools', async () => {
  for (const status of ['failed', 'interrupted'] as const) {
    const calls: string[] = []
    const controller = runThoughtReplay(initial(), { persist() {}, cancel: async () => {}, start: async id => { calls.push(id); return { generationId: id, finished: Promise.resolve(result(id, status)) } } })
    expect((await controller.finished).status).toBe('failed')
    expect(calls).toEqual(['a'])
  }
})
it('still cancels dispatched work when saving the cancellation record fails', async () => {
  const generation = deferred<ThoughtGeneration>()
  const cancelled: string[] = []
  let failSave = false
  const controller = runThoughtReplay(initial(), {
    persist() { if (failSave) throw new Error('disk full') },
    start: async () => ({ generationId: 'a', finished: generation.promise }),
    cancel: async id => { cancelled.push(id); generation.resolve(result(id, 'interrupted')) },
  })
  await Promise.resolve()
  failSave = true
  const terminal = controller.finished.catch(error => error.message)
  await expect(controller.cancel()).rejects.toThrow('disk full')
  expect(cancelled).toEqual(['a'])
  expect(await terminal).toBe('disk full')
  expect(controller.replay.status).toBe('interrupted')
})
