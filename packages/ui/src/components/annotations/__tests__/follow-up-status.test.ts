import { expect, test } from 'bun:test'
import { createTextSelectionAnnotation } from '../annotation-core'
import { getAnnotationFeedbackStatus, isAnnotationFollowUpProcessing, isTrackedFollowUp } from '../follow-up-state'

test('only runtime lifecycle facts are displayed; legacy and malformed metadata have no status', () => {
  const annotation = createTextSelectionAnnotation('answer', { start: 0, end: 4, selectedText: 'test', prefix: '', suffix: '' }, 'Revise')
  expect(getAnnotationFeedbackStatus(annotation)).toBeUndefined()
  for (const status of ['queued', 'running', 'waiting-user', 'delivered', 'failed', 'interrupted'] as const) {
    annotation.meta = { followUp: { requestMessageId: 'request', status } }
    expect(getAnnotationFeedbackStatus(annotation)).toBe(status)
  }
  for (const followUp of [{ status: 'delivered' }, { requestMessageId: 'request', status: 'success' }, []]) {
    annotation.meta = { followUp }
    expect(getAnnotationFeedbackStatus(annotation)).toBeUndefined()
    expect(isTrackedFollowUp(annotation)).toBe(false)
    expect(isAnnotationFollowUpProcessing(annotation)).toBe(false)
  }
})

test('processing locks mutations and every sent status is tracked', () => {
  const annotation = createTextSelectionAnnotation('answer', { start: 0, end: 4, selectedText: 'test', prefix: '', suffix: '' }, 'Revise')
  expect(isTrackedFollowUp(annotation)).toBe(false)
  expect(isAnnotationFollowUpProcessing(annotation)).toBe(false)
  for (const status of ['queued', 'waiting-user', 'delivered', 'failed', 'interrupted'] as const) {
    annotation.meta = { followUp: { requestMessageId: 'request', status } }
    expect(isTrackedFollowUp(annotation)).toBe(true)
    expect(isAnnotationFollowUpProcessing(annotation)).toBe(false)
  }
  annotation.meta = { followUp: { requestMessageId: 'request', status: 'running' } }
  expect(isTrackedFollowUp(annotation)).toBe(true)
  expect(isAnnotationFollowUpProcessing(annotation)).toBe(true)
})
