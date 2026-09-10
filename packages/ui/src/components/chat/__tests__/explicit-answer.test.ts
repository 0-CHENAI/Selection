import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { messageToStored, storedToMessage } from '@craft-agent/core'
import { groupMessagesByTurn } from '../turn-utils'

const explanation = '蒙提霍尔问题：\n\n1. 三扇门中有一辆车。\n2. 主持人知道奖品位置，并打开一扇有羊的门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 不换 | 1/3 |\n| 换门 | 2/3 |'
const answer = `${explanation}\n\n模拟结果：换门胜率约为 2/3。`
const protocol = { answerProtocol: 'explicit-v1' as const, answerRunId: 'run-330' }
function transcript(): Message[] {
  return [
    { id: 'user', role: 'user', content: '解释蒙提霍尔问题并验证', timestamp: 1, ...protocol },
    { id: 'explanation', role: 'assistant', content: explanation, timestamp: 2, ...protocol },
    { id: 'simulation', role: 'tool', content: '', toolName: 'Bash', toolUseId: 'sim', toolStatus: 'completed', toolResult: '0.6667', timestamp: 3, ...protocol },
    { id: 'short', role: 'assistant', content: '模拟证实了结果。', timestamp: 4, ...protocol },
    { id: 'answer', role: 'assistant', content: answer, timestamp: 5, answerCommitted: true, ...protocol },
    { id: 'receipt', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'submit', toolStatus: 'completed', toolResult: 'Answer delivered.', timestamp: 6, ...protocol },
    { id: 'late', role: 'assistant', content: '已完成。', timestamp: 7, ...protocol },
  ] as Message[]
}
describe('explicit answer delivery (#330)', () => {
  it('keeps the complete answer through receipts, late text and reload', () => {
    for (const messages of [transcript(), transcript().map(messageToStored).map(storedToMessage)]) {
      const turns = groupMessagesByTurn(messages).filter(t => t.type === 'assistant')
      expect(turns).toHaveLength(1)
      expect(turns[0]?.response?.text).toBe(answer)
      expect(turns[0]?.response?.messageId).toBe('answer')
      expect(turns[0]?.isComplete).toBe(true)
      expect(turns[0]?.activities.some(a => a.toolUseId === 'sim')).toBe(true)
    }
  })
  it('does not expose uncommitted provider finals as a response', () => {
    const turns = groupMessagesByTurn(transcript().slice(0, 4)).filter(t => t.type === 'assistant')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.response).toBeUndefined()
    expect(turns[0]?.activities.some(a => a.content === explanation)).toBe(true)
  })
  it('does not assemble superseded explanations into the committed answer', () => {
    const messages = transcript()
    messages[4]!.content = '修正：主持人随机开门的条件不同，不能直接使用上述结论。'
    expect(groupMessagesByTurn(messages).find(t => t.type === 'assistant')?.response?.text).toBe(messages[4]!.content)
  })
  it('keeps legacy behavior for messages without protocol metadata', () => {
    const messages: Message[] = [{ id: 'legacy', role: 'assistant', content: '旧答案', timestamp: 1 }]
    expect(groupMessagesByTurn(messages)[0]).toMatchObject({ response: { text: '旧答案' } })
  })
  it('does not fold an accepted answer when orchestration status arrives late', () => {
    const messages = transcript()
    messages[2] = { ...messages[2]!, toolName: 'spawn_session', toolResult: JSON.stringify({ status: 'started', spawnReason: 'automatic', lifecycle: 'managed' }) }
    for (const options of [{ isManagedSwarmRunning: true }, { isTaskOrchestrationRunning: true }, { isManagedSwarmRunning: true, isTaskOrchestrationRunning: true }]) {
      const turn = groupMessagesByTurn(messages, options).find(t => t.type === 'assistant')!
      expect(turn.response?.text).toBe(answer)
      expect(turn.isComplete).toBe(true)
      expect(turn.isStreaming).toBe(false)
    }
  })
  it('still keeps a later undelivered orchestration turn open', () => {
    const messages: Message[] = [...transcript(),
      { id: 'new-user', role: 'user', content: '继续检查', timestamp: 8, answerProtocol: 'explicit-v1', answerRunId: 'new-run' },
      { id: 'new-tool', role: 'tool', content: '', toolName: 'spawn_session', toolStatus: 'completed', toolResult: JSON.stringify({ status: 'started', spawnReason: 'automatic', lifecycle: 'managed' }), timestamp: 9, answerProtocol: 'explicit-v1', answerRunId: 'new-run' },
    ]
    const turns = groupMessagesByTurn(messages, { isManagedSwarmRunning: true, isTaskOrchestrationRunning: true }).filter(t => t.type === 'assistant')
    expect(turns[0]?.response?.text).toBe(answer)
    expect(turns[1]?.response).toBeUndefined()
    expect(turns[1]?.isComplete).toBe(false)
    expect(turns[1]?.isStreaming).toBe(true)
  })
})

it('keeps a later explicit delivery run separate, even after a hidden wake', () => {
  const messages: Message[] = [...transcript(),
    { id: 'wake', role: 'user', hidden: true, content: '后台工作完成', timestamp: 8, answerProtocol: 'explicit-v1', answerRunId: 'next-run' },
    { id: 'next-tool', role: 'tool', content: '', toolName: 'Read', toolStatus: 'completed', toolResult: '完成', timestamp: 9, answerProtocol: 'explicit-v1', answerRunId: 'next-run' },
    { id: 'next-answer', role: 'assistant', content: '后台结果', timestamp: 10, answerProtocol: 'explicit-v1', answerRunId: 'next-run', answerCommitted: true },
  ]
  const turns = groupMessagesByTurn(messages).filter(t => t.type === 'assistant')
  expect(turns.map(t => t.response?.text)).toEqual([answer, '后台结果'])
})

it('never promotes an undelivered answer when processing stops', () => {
  const turns = groupMessagesByTurn(transcript().slice(0, 4), { isSessionProcessing: false }).filter(t => t.type === 'assistant')
  expect(turns[0]?.response).toBeUndefined()
  expect(turns[0]?.activities.some(a => a.content === explanation)).toBe(true)
})
