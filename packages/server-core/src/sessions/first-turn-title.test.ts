import { describe, expect, it } from 'bun:test'
import { shouldFlushFirstTurnAiTitle, shouldQueueFirstTurnAiTitle } from './first-turn-title.ts'

describe('shouldQueueFirstTurnAiTitle (#46)', () => {
  const firstTurn = {
    visibleUserCount: 1,
    isHidden: false,
    hasExistingName: false,
    isAutomation: false,
  }

  it('queues the AI title for the first visible user message', () => {
    expect(shouldQueueFirstTurnAiTitle(firstTurn)).toBe(true)
  })

  it('keeps the truncated placeholder path when a name already exists', () => {
    expect(shouldQueueFirstTurnAiTitle({ ...firstTurn, hasExistingName: true })).toBe(false)
  })

  it('skips automation sessions', () => {
    expect(shouldQueueFirstTurnAiTitle({ ...firstTurn, isAutomation: true })).toBe(false)
  })

  it('ignores hidden nudges so they cannot become the session title', () => {
    expect(shouldQueueFirstTurnAiTitle({ ...firstTurn, isHidden: true })).toBe(false)
  })

  it('does not queue again after the first visible user message', () => {
    expect(shouldQueueFirstTurnAiTitle({ ...firstTurn, visibleUserCount: 2 })).toBe(false)
  })
})

describe('shouldFlushFirstTurnAiTitle (#46)', () => {
  it('does not start title generation when the agent becomes ready', () => {
    expect(shouldFlushFirstTurnAiTitle({
      hasPending: true,
      flushPoint: 'agent-ready',
      queueLength: 0,
    })).toBe(false)
  })

  it('does not start title generation while the first prompt is in flight', () => {
    expect(shouldFlushFirstTurnAiTitle({
      hasPending: true,
      flushPoint: 'prompt-in-flight',
      queueLength: 0,
    })).toBe(false)
  })

  it('starts title generation only after the session is idle', () => {
    expect(shouldFlushFirstTurnAiTitle({
      hasPending: true,
      flushPoint: 'session-idle',
      queueLength: 0,
    })).toBe(true)
  })

  it('waits until the message queue drains so a follow-up is not raced', () => {
    expect(shouldFlushFirstTurnAiTitle({
      hasPending: true,
      flushPoint: 'session-idle',
      queueLength: 1,
    })).toBe(false)
  })

  it('is a no-op when nothing is pending', () => {
    expect(shouldFlushFirstTurnAiTitle({
      hasPending: false,
      flushPoint: 'session-idle',
      queueLength: 0,
    })).toBe(false)
  })
})
