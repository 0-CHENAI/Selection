import { expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { groupMessagesByTurn } from '../turn-utils'

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

test('clarification is its own card and is not promoted into the final answer', () => {
  const turns = groupMessagesByTurn([user, clarification, answer], { isSessionProcessing: false })
  expect(turns.map(turn => turn.type)).toEqual(['user', 'clarification', 'assistant'])
  const assistant = turns.find(turn => turn.type === 'assistant')
  expect(assistant && assistant.type === 'assistant' ? assistant.response?.text : undefined).toBe('按 2024 继续。')
  expect(turns.some(turn => turn.type === 'assistant' && turn.response?.text === '范围是哪一年？')).toBe(false)
})
