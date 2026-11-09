import { describe, expect, it } from 'bun:test'
import {
  handleComplete,
  handleError,
  handleInterrupted,
  handleMessagesTruncated,
  handleMessagesRestored,
  handleRegenerateStarted,
  handleUserMessage,
} from '../session'
import type { SessionState } from '../../types'

function makeState(overrides: Partial<SessionState['session']> = {}): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [
        { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'hello', timestamp: 2 },
      ],
      lastMessageAt: 2,
      isProcessing: false,
      ...overrides,
    } as SessionState['session'],
    streaming: { content: 'stale' },
  }
}

describe('regenerate UI state (#17)', () => {
  it('enters running state without dropping the old response before the new run is ready', () => {
    const next = handleRegenerateStarted(makeState(), {
      type: 'regenerate_started',
      sessionId: 'session-1',
      runId: 'regen-1',
    })

    expect(next.state.session.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.processingStartedAt).toBeGreaterThan(1)
  })

  it('enters the same running state as a normal send when regenerate truncates', () => {
    const next = handleMessagesTruncated(makeState({
      currentStatus: { message: 'Thinking…' },
    }), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    expect(next.state.session.messages.map(m => m.id)).toEqual(['u1'])
    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.currentStatus).toBeUndefined()
    expect(next.state.session.processingStartedAt).toBeGreaterThan(1)
    expect(next.state.streaming).toBeNull()
  })

  it('keeps running state when a later user_message replay/status event arrives', () => {
    const afterTruncate = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    const next = handleUserMessage(afterTruncate.state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: { id: 'u1', role: 'user', content: 'hi', timestamp: 1 } as SessionState['session']['messages'][number],
      status: 'accepted',
    })

    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.processingStartedAt).toBe(afterTruncate.state.session.processingStartedAt)
  })

  it('returns to idle after regenerate completes', () => {
    const running = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    const next = handleComplete(running.state, {
      type: 'complete',
      sessionId: 'session-1',
    })

    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.processingStartedAt).toBeUndefined()
    expect(next.state.streaming).toBeNull()
  })

  it('returns to idle after regenerate fails', () => {
    const running = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    const next = handleError(running.state, {
      type: 'error',
      sessionId: 'session-1',
      error: 'Failed to regenerate',
    })

    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.processingStartedAt).toBeUndefined()
    expect(next.state.session.messages.some(m => m.role === 'error')).toBe(true)
  })

  it('restores the old response after a failed regenerate and keeps the error', () => {
    const running = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
      runId: 'regen-1',
    })
    const failed = handleError(running.state, {
      type: 'error',
      sessionId: 'session-1',
      error: 'Failed to regenerate',
    })

    const restored = handleMessagesRestored(failed.state, {
      type: 'messages_restored',
      sessionId: 'session-1',
      messages: makeState().session.messages,
      runId: 'regen-1',
    })

    expect(restored.state.session.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'error',
    ])
    expect(restored.state.session.messages[1]?.content).toBe('hello')
    expect(restored.state.session.isProcessing).toBe(false)
    expect(restored.state.streaming).toBeNull()
  })

  it('returns to idle after regenerate is stopped', () => {
    const running = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    const next = handleInterrupted(running.state, {
      type: 'interrupted',
      sessionId: 'session-1',
      message: { id: 'info-1', role: 'info', content: 'Response interrupted', timestamp: 3 } as SessionState['session']['messages'][number],
    })

    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.processingStartedAt).toBeUndefined()
    expect(next.state.session.messages.map(m => m.id)).toEqual(['u1', 'info-1'])
  })

  it('preserves the active turn clock when a mid-stream user_message is queued', () => {
    const running = handleMessagesTruncated(makeState(), {
      type: 'messages_truncated',
      sessionId: 'session-1',
      keepThroughMessageId: 'u1',
    })

    const next = handleUserMessage(running.state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: { id: 'u2', role: 'user', content: 'later', timestamp: 4 } as SessionState['session']['messages'][number],
      status: 'queued',
    })

    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.processingStartedAt).toBe(running.state.session.processingStartedAt)
  })
})
