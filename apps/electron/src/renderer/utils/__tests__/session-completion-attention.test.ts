import { expect, test } from 'bun:test'
import { sessionCompletionAttention } from '../session-completion-attention'

test('finished unread conversations reach their drawer and clear on read', () => {
  const sessions = [{ hasUnread: true }, { projectId: 'a', hasUnread: true }, { projectId: 'a', hasUnread: true }, { projectId: 'b', hasUnread: false }]
  const result = sessionCompletionAttention(sessions)
  expect(result.ordinary).toBe(true)
  expect([...result.projects]).toEqual(['a'])
  sessions.forEach(s => { s.hasUnread = false })
  expect(sessionCompletionAttention(sessions).projects.size).toBe(0)
  expect(sessionCompletionAttention(sessions).ordinary).toBe(false)
})
test('running, hidden and archived conversations do not announce completion', () => {
  expect(sessionCompletionAttention([
    { projectId: 'a', hasUnread: true, isProcessing: true },
    { projectId: 'b', hasUnread: true, hidden: true },
    { hasUnread: true, isArchived: true },
  ])).toEqual({ ordinary: false, projects: new Set(), runningProjects: new Set(['a']) })
})

test('running and completed unread siblings remain independently visible', () => {
  const running = { projectId: 'a', isProcessing: true, hasUnread: false }
  const sessions = [running, { projectId: 'a', hasUnread: true }, { projectId: 'b', isProcessing: true, hidden: true }]
  expect(sessionCompletionAttention(sessions)).toEqual({ ordinary: false, projects: new Set(['a']), runningProjects: new Set(['a']) })
  running.isProcessing = false
  running.hasUnread = true
  expect(sessionCompletionAttention(sessions).runningProjects.size).toBe(0)
  expect([...sessionCompletionAttention(sessions).projects]).toEqual(['a'])
})
