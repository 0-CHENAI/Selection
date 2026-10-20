import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { groupMessagesByTurn } from '../turn-utils'
import { stabilizeTurns } from '../turn-stability'

function message(id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { id, role, content, timestamp: extra.timestamp ?? 1, ...extra }
}

describe('stabilizeTurns', () => {
  test('reuses historical turn identities while the live tail changes', () => {
    const history: Message[] = []
    for (let index = 0; index < 12; index++) {
      history.push(message(`u${index}`, 'user', `问题 ${index}\n\n${'历史正文。'.repeat(40)}`, { timestamp: index * 2 }))
      history.push(message(`a${index}`, 'assistant', `${'已经完成的回答。'.repeat(80)}`, { timestamp: index * 2 + 1 }))
    }
    const live = message('live', 'assistant', '开始', { timestamp: 100, isStreaming: true, isPending: true })
    const first = groupMessagesByTurn([...history, live], { isSessionProcessing: true })
    const second = groupMessagesByTurn([...history, { ...live, content: '开始继续写' }], { isSessionProcessing: true })
    const stable = stabilizeTurns(first, second)
    expect(stable).not.toBe(second)
    expect(stable.at(-1)).toBe(second.at(-1))
    expect(stable.at(-1)?.type === 'assistant' && stable.at(-1).response?.text).toBe('开始继续写')
    for (let index = 0; index < stable.length - 1; index++) {
      expect(stable[index]).toBe(first[index])
    }
  })

  test('does not reuse a turn whose response actually changed', () => {
    const user = message('u', 'user', '问题', { timestamp: 1 })
    const first = groupMessagesByTurn([user, message('a', 'assistant', '第一版', { timestamp: 2 })])
    const second = groupMessagesByTurn([user, message('a', 'assistant', '第二版', { timestamp: 2 })])
    const stable = stabilizeTurns(first, second)
    expect(stable[0]).toBe(first[0])
    expect(stable[1]).toBe(second[1])
    expect(stable[1]).not.toBe(first[1])
  })

  test('a different session must not keep the previous identities', () => {
    const first = groupMessagesByTurn([message('u', 'user', '甲', { timestamp: 1 })])
    const second = groupMessagesByTurn([message('u', 'user', '甲', { timestamp: 1 })])
    expect(stabilizeTurns(undefined, second)[0]).toBe(second[0])
    expect(stabilizeTurns([], second)[0]).toBe(second[0])
    // Same shape, different message object: the user bubble is a new mount.
    expect(stabilizeTurns(first, second)[0]).toBe(second[0])
  })
})
