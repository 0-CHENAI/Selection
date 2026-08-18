import { describe, expect, it } from 'bun:test'
import { handleMessagesTruncated } from '../session'
import type { SessionState } from '../../types'

describe('handleMessagesTruncated', () => {
  it('keeps messages through the last user prompt and drops the rest', () => {
    const state = {
      session: {
        id: 'session-1',
        messages: [
          { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
          { id: 'u2', role: 'user', content: 'again', timestamp: 3 },
          { id: 'a2', role: 'assistant', content: 'ok', timestamp: 4 },
        ],
        currentStatus: { message: 'Thinking…' },
      },
      streaming: { content: 'partial' },
    } as SessionState

    const result = handleMessagesTruncated(state, {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u2',
    })

    expect(result.state.session.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2'])
    expect(result.state.streaming).toBeNull()
    expect(result.state.session.isProcessing).toBe(true)
    expect(result.state.session.currentStatus).toBeUndefined()
  })

  it('falls back to the last user prompt when the keep id is the backend id', () => {
    const state = {
      session: {
        id: 'session-1',
        messages: [
          { id: 'optimistic-u2', role: 'user', content: 'again', timestamp: 3 },
          { id: 'a2', role: 'assistant', content: 'ok', timestamp: 4 },
        ],
      },
      streaming: { content: 'partial' },
    } as SessionState

    const result = handleMessagesTruncated(state, {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'backend-u2',
    })

    expect(result.state.session.messages.map(m => m.id)).toEqual(['optimistic-u2'])
    expect(result.state.streaming).toBeNull()
    expect(result.state.session.isProcessing).toBe(true)
  })

  it('leaves state unchanged when there is no user prompt to keep', () => {
    const state = {
      session: {
        id: 'session-1',
        messages: [{ id: 'a1', role: 'assistant', content: 'hello', timestamp: 1 }],
      },
      streaming: null,
    } as SessionState

    const result = handleMessagesTruncated(state, {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'missing',
    })

    expect(result.state).toBe(state)
  })
})
