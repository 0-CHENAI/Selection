import { describe, expect, it } from 'bun:test'
import { handleTextComplete, handleTextDelta } from '../text'
import type { SessionState, TextCompleteEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
    } as any,
    streaming: null,
  }
}

describe('handleTextComplete messageId synchronization', () => {
  it('overwrites existing streaming message id with authoritative messageId', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'final response',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    }

    const next = handleTextComplete(state, event)
    const msg = next.session.messages[0] as any

    expect(msg.id).toBe('msg-main-1')
    expect(msg.content).toBe('final response')
    expect(msg.isStreaming).toBe(false)
    expect(msg.isPending).toBe(false)
    expect(msg.timestamp).toBe(200)
  })

  it('uses authoritative messageId when creating message in race path', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'created from complete',
      turnId: 'turn-race',
      messageId: 'msg-main-race',
      timestamp: 300,
    }

    const next = handleTextComplete(state, event)
    expect(next.session.messages).toHaveLength(1)
    expect((next.session.messages[0] as any).id).toBe('msg-main-race')
  })

  it('keeps a shorter renderable complete over a stale longer stream', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: '先读 skill 文件再继续检查文档。',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])
    state.streaming = { content: '先读 skill 文件再继续检查文档。', turnId: 'turn-1' }

    const next = handleTextComplete(state, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '已经改完。',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    })
    expect((next.session.messages[0] as any).content).toBe('已经改完。')
  })

  it('does not recover truncation from a different turn stream', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: '|',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])
    state.streaming = { content: '另一轮已经写好的正文。', turnId: 'turn-2' }

    const next = handleTextComplete(state, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '|',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    })
    expect((next.session.messages[0] as any).content).toBe('|')
  })

  it('does not let a truncated complete replace a longer streamed body (#81)', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: '先读 skill 文件再继续检查文档。',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])
    state.streaming = { content: '先读 skill 文件再继续检查文档。', turnId: 'turn-1' }

    const next = handleTextComplete(state, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '|',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    })
    const msg = next.session.messages[0] as any
    expect(msg.content).toBe('先读 skill 文件再继续检查文档。')
    expect(msg.isStreaming).toBe(false)
  })

  it('keeps backward compatibility when messageId is missing', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'legacy payload',
      turnId: 'turn-legacy',
      timestamp: 400,
    }

    const next = handleTextComplete(state, event)
    const id = (next.session.messages[0] as any).id as string

    expect(id.startsWith('msg-')).toBe(true)
    expect(id).not.toBe('')
  })
})

describe('explicit answer identity (#330)', () => {
  it('preserves exact committed content and ignores duplicate and late completions', () => {
    const state = makeState([{ id: 'draft', role: 'assistant', content: '旧草稿', turnId: 'draft-turn', isIntermediate: true }])
    const event: TextCompleteEvent = { type: 'text_complete', sessionId: 'session-1', text: '完整正文\n\n| A | B |\n| - | - |\n| 1 | 2 |', messageId: 'answer', turnId: 'answer-run', timestamp: 400,
      answerProtocol: 'explicit-v1', answerRunId: 'run', answerCommitted: true, phase: 'final', isIntermediate: false }
    const accepted = handleTextComplete(state, event)
    expect(accepted.session.messages.at(-1)).toMatchObject({ id: 'answer', answerCommitted: true, answerRunId: 'run', content: event.text })
    expect(handleTextComplete(accepted, event).session.messages).toHaveLength(2)
    expect(handleTextComplete(accepted, { ...event, answerCommitted: false, messageId: 'late', text: '短句' }).session.messages.at(-1)?.content).toBe(event.text)
  })
})

it('never extends a committed answer with a longer unclassified streaming draft', () => {
  const state = makeState([])
  state.streaming = { content: '答案。旧草稿尾部不能进入正式正文。' }
  const next = handleTextComplete(state, { type: 'text_complete', sessionId: 'session-1', text: '答案。', messageId: 'answer', turnId: 'answer-run', answerProtocol: 'explicit-v1', answerRunId: 'run', answerCommitted: true })
  expect(next.session.messages[0]?.content).toBe('答案。')
  expect(next.streaming).toBeNull()
})

it('ignores replayed deltas after delivery without disturbing another stream', () => {
  const state = makeState([{ id: 'answer', role: 'assistant', content: '答案', answerCommitted: true, answerRunId: 'run' }])
  state.streaming = { content: '下一轮过程', turnId: 'new-turn' }
  expect(handleTextDelta(state, { type: 'text_delta', sessionId: 'session-1', delta: '迟到文本', answerRunId: 'run', answerProtocol: 'explicit-v1' })).toBe(state)
})
