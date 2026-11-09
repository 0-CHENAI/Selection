import { describe, expect, it } from 'bun:test'
import { findRetryableCancelledUser, isCancelledTurnMarker } from './cancelled-turn'

describe('cancelled turn retry target', () => {
  it('recognizes the English stop row and the status marker', () => {
    expect(isCancelledTurnMarker({ role: 'info', content: 'Response interrupted' })).toBe(true)
    expect(isCancelledTurnMarker({ role: 'info', content: '已取消', statusType: 'turn_cancelled' })).toBe(true)
    expect(isCancelledTurnMarker({ role: 'info', content: 'Compacted' })).toBe(false)
  })

  it('returns only the latest user message when that turn was cancelled', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'done' },
      { id: 'u2', role: 'user', content: 'second' },
      { id: 'a2', role: 'assistant', content: 'partial' },
      { id: 'stop', role: 'info', content: 'Response interrupted', statusType: 'turn_cancelled' },
      { id: 'q', role: 'user', content: 'queued', isQueued: true },
    ]
    expect(findRetryableCancelledUser(messages)?.id).toBe('u2')
  })

  it('does not offer an older cancelled turn after a newer user message', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'stop', role: 'info', content: 'Response interrupted' },
      { id: 'u2', role: 'user', content: 'second' },
      { id: 'a2', role: 'assistant', content: 'answer' },
    ]
    expect(findRetryableCancelledUser(messages)).toBeNull()
  })
})
