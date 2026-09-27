import { describe, expect, test } from 'bun:test'
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core'
import { groupMessagesByTurn, countWorkRecords } from '../turn-utils'
import { isAnswerDeliveryTool, isSubmitAnswerTool } from '../tool-labels'

const msg = (id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
  id, role, content, timestamp: Number(id), answerProtocol: 'explicit-v1', answerRunId: 'run', answerRoutingVersion: 1, ...extra,
})
const assistants = (messages: Message[]) => groupMessagesByTurn(messages, { isSessionProcessing: false }).filter(t => t.type === 'assistant')

describe('structured answer routing', () => {
  test('keeps process text even when it shares the answer heading or prefix', () => {
    const messages = [msg('1', 'user', '解释'), msg('2', 'assistant', '# 长标题正文\n提交答案'),
      msg('3', 'tool', '', { toolName: 'submit_answer', toolPurpose: 'answer-delivery', toolStatus: 'completed' }),
      msg('4', 'assistant', '# 长标题正文\n提交答案：这是正文。', { answerCommitted: true, answerSalvaged: true })]
    for (const input of [messages, messages.map(messageToStored).map(storedToMessage)]) {
      const turns = assistants(input)
      expect(turns).toHaveLength(1)
      expect(turns[0]!.response).toMatchObject({ text: messages[3]!.content, answerSalvaged: true })
      expect(turns[0]!.activities.map(a => a.content)).toContain(messages[1]!.content)
      expect(turns[0]!.activities.some(a => a.toolName === 'submit_answer')).toBe(false)
    }
  })
  test('successful receipt cannot promote a draft in new runs, but legacy runs keep salvage', () => {
    const messages = [msg('1', 'user', '问题'), msg('2', 'assistant', '尚未交付'),
      msg('3', 'tool', '', { toolName: 'submit_answer', toolPurpose: 'answer-delivery', toolStatus: 'completed' })]
    expect(assistants(messages).every(t => !t.response)).toBe(true)
    expect(assistants(messages.map(m => ({ ...m, answerRoutingVersion: undefined })))[0]!.response?.text).toBe('尚未交付')
  })
  test('purpose controls work records without changing accepted legacy names', () => {
    for (const name of ['submit_answer', 'session__submit_answer', 'mcp__session__submit_answer', 'SUBMIT_ANSWER', 'mcp__other__submit_answer', 'submit_answer_extra']) {
      expect(isAnswerDeliveryTool({ toolName: name })).toBe(isSubmitAnswerTool(name))
      expect(isAnswerDeliveryTool({ toolName: name, answerRoutingVersion: 1, toolPurpose: 'work' })).toBe(false)
    }
    const turns = assistants([msg('1', 'user', '问题'), msg('2', 'tool', '', { toolName: 'submit_answer', toolPurpose: 'work', toolStatus: 'completed' })])
    expect(countWorkRecords(turns[0]!.activities)).toBe(1)
  })
  test('mixed history chooses routing per run and duplicate commits never add a second answer', () => {
    const legacy = [msg('1', 'user', '旧问题'), msg('2', 'assistant', '旧草稿'), msg('3', 'tool', '', { toolName: 'submit_answer', toolStatus: 'completed' })].map(m => ({ ...m, answerRoutingVersion: undefined, answerRunId: 'old' }))
    const modern = [msg('4', 'user', '新问题'), msg('5', 'assistant', '新草稿'), msg('6', 'assistant', '最终', { answerCommitted: true }), msg('7', 'assistant', '最终', { answerCommitted: true })]
    const turns = assistants([...legacy, ...modern])
    expect(turns.map(t => t.response?.text)).toEqual(['旧草稿', '最终'])
    expect(turns[1]!.activities.some(a => a.content === '新草稿')).toBe(true)
  })
})
