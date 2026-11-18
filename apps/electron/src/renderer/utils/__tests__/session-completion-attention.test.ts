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
  ])).toEqual({ ordinary: false, runningOrdinary: false, runningOffice: false, projects: new Set(), runningProjects: new Set(['a']) })
})

test('running and completed unread siblings remain independently visible', () => {
  const running = { projectId: 'a', isProcessing: true, hasUnread: false }
  const sessions = [running, { projectId: 'a', hasUnread: true }, { projectId: 'b', isProcessing: true, hidden: true }]
  expect(sessionCompletionAttention(sessions)).toEqual({ ordinary: false, runningOrdinary: false, runningOffice: false, projects: new Set(['a']), runningProjects: new Set(['a']) })
  running.isProcessing = false
  running.hasUnread = true
  expect(sessionCompletionAttention(sessions).runningProjects.size).toBe(0)
  expect([...sessionCompletionAttention(sessions).projects]).toEqual(['a'])
})

test('ordinary sessions, individual projects and Office can run and settle independently', () => {
  const chat = { isProcessing: true }
  const project = { projectId: 'a', isProcessing: true }
  const ppt = { ppt: {}, isProcessing: false, pptProgress: { generating: true } }
  const word = { isProcessing: true }
  const state = () => sessionCompletionAttention([chat, project], [ppt, word])
  expect(state()).toMatchObject({ runningOrdinary: true, runningProjects: new Set(['a']), runningOffice: true })
  chat.isProcessing = false
  project.isProcessing = false
  word.isProcessing = false
  expect(state()).toMatchObject({ runningOrdinary: false, runningProjects: new Set(), runningOffice: true })
  ppt.pptProgress.generating = false
  expect(state().runningOffice).toBe(false)
  word.isProcessing = true
  expect(state().runningOffice).toBe(true)
})

test('hidden and archived runs do not light up the ordinary or Office row', () => {
  const excluded = [{ hidden: true, isProcessing: true }, { isArchived: true, isProcessing: true }]
  expect(sessionCompletionAttention(excluded, excluded)).toMatchObject({ runningOrdinary: false, runningOffice: false })
})
