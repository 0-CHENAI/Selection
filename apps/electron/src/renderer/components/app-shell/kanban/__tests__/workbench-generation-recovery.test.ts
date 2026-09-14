import { expect, it } from 'bun:test'
import { acceptGenerationReceipt, recoverLiveGeneration, isNewerGeneration } from '../workbench-generation-recovery'
import type { ThoughtGeneration } from '@craft-agent/shared/thought-workbench/types'

const receipt = (id: string, status: ThoughtGeneration['status'], documentId = 'doc'): ThoughtGeneration => ({ id, status, documentId, nodeId: id, sessionId: id, contextHash: id })

it('rejects late RPC acknowledgements after a document switch or a newer cancellation', () => {
  const old = { ...receipt('job', 'running'), sequence: 1 }
  expect(acceptGenerationReceipt('new-doc', null, old)).toBeNull()
  const cancelled = { ...old, status: 'interrupted' as const, sequence: 3 }
  expect(acceptGenerationReceipt('doc', cancelled, { ...old, sequence: 2 })).toBe(cancelled)
  expect(acceptGenerationReceipt('doc', cancelled, { ...old, sequence: 4 })).toBe(cancelled)
  expect(acceptGenerationReceipt('doc', old, cancelled)).toBe(cancelled)
  const newerJob = receipt('newer', 'running')
  expect(acceptGenerationReceipt('doc', newerJob, cancelled)).toBe(newerJob)
  expect(acceptGenerationReceipt('doc', null, old)).toBe(old)
})

it('rejects duplicate, out-of-order, foreign and post-cancellation running events', () => {
  const running = { ...receipt('job', 'running'), sequence: 2 }
  expect(isNewerGeneration(running, { ...running, sequence: 3, status: 'completed' })).toBe(true)
  for (const sequence of [1, 2]) expect(isNewerGeneration(running, { ...running, sequence })).toBe(false)
  expect(isNewerGeneration(running, { ...running, sequence: 3, documentId: 'foreign' })).toBe(false)
  expect(isNewerGeneration({ ...running, status: 'interrupted' }, { ...running, sequence: 4 })).toBe(false)
  expect(isNewerGeneration(receipt('job', 'running'), running)).toBe(true)
})

it('observes remaining live jobs after a previous job completes', () => {
  const first = receipt('first', 'completed'), next = receipt('next', 'running')
  expect(recoverLiveGeneration('doc', first, [first, next])).toBe(next)
})

it('does not replace an active observer or revive interrupted executions', () => {
  const live = receipt('live', 'running')
  expect(recoverLiveGeneration('doc', live, [receipt('other', 'running')])).toBe(live)
  expect(recoverLiveGeneration('doc', null, [receipt('stopped', 'interrupted'), receipt('foreign', 'running', 'other-doc')])).toBeNull()
})

it('clears a foreign observer when switching to a document with no live jobs', () => {
  for (const status of ['running', 'completed', 'failed', 'interrupted'] as const) {
    expect(recoverLiveGeneration('doc', receipt('old', status, 'old-doc'), [])).toBeNull()
  }
})

it('retains the current document terminal receipt for result inspection', () => {
  const completed = receipt('done', 'completed')
  expect(recoverLiveGeneration('doc', completed, [])).toBe(completed)
})
