import { expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { groupMessagesByTurn, pendingClarificationLayout, type Turn } from '../turn-utils'

const user: Message = { id: 'u', role: 'user', content: '做一份报告', timestamp: 1 }
const clarification: Message = {
  id: 'c',
  role: 'clarification',
  content: '范围是哪一年？',
  timestamp: 2,
  clarification: {
    requestId: 'req',
    question: '范围是哪一年？',
    ambiguity: 'scope',
    selection: 'single',
    options: [{ id: '2024', label: '2024' }],
    round: 1,
    status: 'pending',
    originSessionId: 'root',
  },
}
const answer: Message = { id: 'a', role: 'assistant', content: '按 2024 继续。', timestamp: 4 }
const clarifyTool: Message = {
  id: 'tool',
  role: 'tool',
  content: 'Waiting for clarification',
  timestamp: 2,
  toolName: 'clarify',
  toolStatus: 'completed',
}
const commentary: Message = {
  id: 'note',
  role: 'assistant',
  content: '需要确认具体任务是什么',
  timestamp: 3,
  isIntermediate: true,
}

test('clarification is its own card and is not promoted into the final answer', () => {
  const turns = groupMessagesByTurn([user, clarification, answer], { isSessionProcessing: false })
  expect(turns.map(turn => turn.type)).toEqual(['user', 'clarification', 'assistant'])
  const assistant = turns.find(turn => turn.type === 'assistant')
  expect(assistant && assistant.type === 'assistant' ? assistant.response?.text : undefined).toBe('按 2024 继续。')
  expect(turns.some(turn => turn.type === 'assistant' && turn.response?.text === '范围是哪一年？')).toBe(false)
})

test('a pending clarification keeps the header above the card and hides the later work chain', () => {
  const turns = groupMessagesByTurn([user, clarifyTool, clarification, commentary], { isSessionProcessing: false })
  expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'clarification', 'assistant'])
  const layout = pendingClarificationLayout(turns)
  expect(layout?.statusTurnIndex).toBe(1)
  expect([...(layout?.hiddenTurnIndexes ?? [])]).toEqual([3])
})

test('answering or skipping restores the normal work-chain layout', () => {
  const settled = (status: 'answered' | 'skipped'): Turn[] => groupMessagesByTurn([
    user,
    clarifyTool,
    { ...clarification, clarification: { ...clarification.clarification!, status } },
    commentary,
  ], { isSessionProcessing: false })
  expect(pendingClarificationLayout(settled('answered'))).toBeNull()
  expect(pendingClarificationLayout(settled('skipped'))).toBeNull()
})

test('commentary after a clarification joins the continuation chain instead of its own list', () => {
  const note = 'The user asked to solve "this task" but no task content or attachment was provided'
  const turns = groupMessagesByTurn([
    { ...user, answerRunId: 'run-1', answerProtocol: 'explicit-v1', answerRoutingVersion: 1 },
    { ...clarifyTool, toolPurpose: 'work', answerRunId: 'run-1', answerProtocol: 'explicit-v1', answerRoutingVersion: 1 },
    { ...clarification, clarification: { ...clarification.clarification!, status: 'answered', text: '在另一个会话里' } },
    {
      ...commentary,
      content: note,
      answerRunId: 'run-1',
      answerProtocol: 'explicit-v1',
      answerRoutingVersion: 1,
    },
    {
      id: 'continue',
      role: 'user',
      content: 'Clarification req answered',
      timestamp: 5,
      hidden: true,
      answerRunId: 'run-2',
      answerProtocol: 'explicit-v1',
      answerRoutingVersion: 1,
    },
    {
      id: 'find',
      role: 'tool',
      content: 'sessions',
      timestamp: 6,
      toolName: 'Bash',
      toolStatus: 'completed',
      toolIntent: 'Find other sessions in the workspace',
      toolPurpose: 'work',
      answerRunId: 'run-2',
      answerProtocol: 'explicit-v1',
      answerRoutingVersion: 1,
    },
    {
      ...answer,
      timestamp: 7,
      answerRunId: 'run-2',
      answerProtocol: 'explicit-v1',
      answerCommitted: true,
      answerRoutingVersion: 1,
    },
  ], { isSessionProcessing: false })

  expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'clarification', 'assistant'])
  const lower = turns[3]
  expect(lower?.type).toBe('assistant')
  if (lower?.type !== 'assistant') return
  expect(lower.activities.some(activity => activity.content?.includes('The user asked'))).toBe(true)
  expect(lower.activities.some(activity => activity.intent === 'Find other sessions in the workspace')).toBe(true)
  expect(lower.response?.text).toBe('按 2024 继续。')
  expect(turns.filter(turn => turn.type === 'assistant' && turn.activities.some(activity => activity.content?.includes('The user asked')))).toHaveLength(1)
})

test('a pending card from an earlier request does not restyle the current turn', () => {
  const turns = groupMessagesByTurn([
    user,
    clarification,
    { id: 'next', role: 'user', content: '用 2024', timestamp: 5 },
    answer,
  ], { isSessionProcessing: false })
  expect(pendingClarificationLayout(turns)).toBeNull()
})
