import { expect, test } from 'bun:test'
import { artifactFeedbackAnchor } from './artifact-feedback-anchor'
test('text selection maps Windows newlines and Unicode to exact stored offsets', () => {
  expect(artifactFeedbackAnchor('标题\r\n😀正文\r尾', 'hash', 3, 7)).toEqual({ hash: 'hash', start: 4, end: 8, text: '😀正文' })
  expect(artifactFeedbackAnchor('a\r\nb', 'hash', 0, 3)?.text).toBe('a\r\nb')
  expect(artifactFeedbackAnchor('abc', 'hash', 1, 1)).toBeUndefined()
  expect(artifactFeedbackAnchor('abc', 'hash', 1, 5)).toBeUndefined()
})
