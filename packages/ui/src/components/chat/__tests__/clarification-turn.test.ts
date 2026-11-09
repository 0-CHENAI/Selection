import { expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import {
  anchorClarificationWorkStatus,
  groupMessagesByTurn,
  pendingClarificationLayout,
  interleaveSettledClarifications,
  settledClarificationGroups,
  type Turn,
} from '../turn-utils'

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

  expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'clarification'])
  const chain = turns[1]
  expect(chain?.type).toBe('assistant')
  if (chain?.type !== 'assistant') return
  expect(chain.activities.some(activity => activity.toolName === 'clarify')).toBe(true)
  expect(chain.activities.some(activity => activity.content?.includes('The user asked'))).toBe(true)
  expect(chain.activities.some(activity => activity.intent === 'Find other sessions in the workspace')).toBe(true)
  expect(chain.response?.text).toBe('按 2024 继续。')
  expect(turns.filter(turn => turn.type === 'assistant')).toHaveLength(1)
})

test('answered clarifications fold into the first process row and hoist the work status', () => {
  const turns = groupMessagesByTurn([
    user,
    clarifyTool,
    { ...clarification, clarification: { ...clarification.clarification!, status: 'answered', text: '2024' } },
    commentary,
    answer,
  ], { isSessionProcessing: false })
  expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'clarification'])
  expect(turns.filter(turn => turn.type === 'assistant')).toHaveLength(1)
  const chain = turns[1]
  expect(chain?.type).toBe('assistant')
  if (chain?.type !== 'assistant') return
  expect(chain.activities.some(activity => activity.toolName === 'clarify')).toBe(true)
  expect(chain.activities.some(activity => activity.content?.includes('需要确认'))).toBe(true)
  expect(chain.response?.text).toBe('按 2024 继续。')
  const groups = settledClarificationGroups(turns)
  expect(groups).toEqual([{ anchorIndex: 1, clarificationIndexes: [2] }])
  const timings = anchorClarificationWorkStatus(turns, new Map([[1, 'worked']]), groups)
  expect(timings.get(1)).toBe('worked')
  expect([...timings.keys()]).toEqual([1])
})

test('several settled questions in one flow share a summary without moving the next request', () => {
  const skipped = {
    ...clarification,
    id: 'c2',
    timestamp: 5,
    content: '要附录吗？',
    clarification: { ...clarification.clarification!, requestId: 'req-2', question: '要附录吗？', status: 'skipped' as const },
  }
  const turns = groupMessagesByTurn([
    user,
    clarifyTool,
    { ...clarification, clarification: { ...clarification.clarification!, status: 'answered' } },
    skipped,
    commentary,
    answer,
    { ...user, id: 'u2', content: '再来一份', timestamp: 8 },
    { ...answer, id: 'a2', timestamp: 9 },
  ], { isSessionProcessing: false })
  const secondUser = turns.findIndex((turn, index) => index > 0 && turn.type === 'user')
  const groups = settledClarificationGroups(turns)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.clarificationIndexes.map(index => turns[index]?.type)).toEqual(['clarification', 'clarification'])
  expect(groups[0]!.clarificationIndexes.every(index => index < secondUser)).toBe(true)
  const assistantsBeforeNext = turns.filter((turn, index) => turn.type === 'assistant' && index < secondUser)
  expect(assistantsBeforeNext).toHaveLength(1)
  const firstStatus = turns.findLastIndex((turn, index) => turn.type === 'assistant' && index < secondUser)
  const secondStatus = turns.findLastIndex(turn => turn.type === 'assistant')
  expect(firstStatus).toBe(groups[0]!.anchorIndex)
  const timings = anchorClarificationWorkStatus(turns, new Map([[firstStatus, 'first'], [secondStatus, 'second']]))
  expect(timings.get(groups[0]!.anchorIndex)).toBe('first')
  expect(timings.get(secondStatus)).toBe('second')
})

test('a clarification that lands before the process joins that fold', () => {
  const turns = groupMessagesByTurn([
    user,
    { ...clarification, clarification: { ...clarification.clarification!, status: 'answered', text: '2024' } },
    answer,
  ], { isSessionProcessing: false })
  expect(turns.map(turn => turn.type)).toEqual(['user', 'clarification', 'assistant'])
  const groups = settledClarificationGroups(turns)
  expect(groups).toEqual([{ anchorIndex: 2, clarificationIndexes: [1] }])
  const timings = anchorClarificationWorkStatus(turns, new Map([[2, 'worked']]))
  expect([...timings.keys()]).toEqual([2])
  expect(timings.has(1)).toBe(false)
})

test('settled clarifications keep their place in the process timeline', () => {
  const rows = [
    { id: 'early', type: 'tool' as const, status: 'completed' as const, timestamp: 1 },
    { id: 'late', type: 'tool' as const, status: 'completed' as const, timestamp: 5 },
  ]
  const earlyQuestion: Message = {
    ...clarification,
    id: 'c-early',
    timestamp: 2,
    clarification: { ...clarification.clarification!, status: 'answered' },
  }
  const lateQuestion: Message = {
    ...clarification,
    id: 'c-late',
    timestamp: 6,
    clarification: { ...clarification.clarification!, requestId: 'req-2', status: 'skipped' },
  }
  const entries = interleaveSettledClarifications(rows, [lateQuestion, clarification, earlyQuestion])
  expect(entries.map(entry => entry.kind === 'step' ? entry.row.id : entry.message.id)).toEqual([
    'early',
    'c-early',
    'late',
    'c-late',
  ])
})

test('a pending clarification does not fold into the settled summary', () => {
  const turns = groupMessagesByTurn([user, clarifyTool, clarification, commentary], { isSessionProcessing: false })
  expect(settledClarificationGroups(turns)).toEqual([])
  expect(anchorClarificationWorkStatus(turns, new Map([[1, 'waiting']])).get(1)).toBe('waiting')
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
