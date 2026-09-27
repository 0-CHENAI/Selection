import { expect, test } from 'bun:test'
import { createTextSelectionAnnotation } from '../annotation-core'
import { getAnnotationFeedbackStatus } from '../follow-up-state'

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
  }
})
