import { describe, expect, it } from 'bun:test'
import {
  decidePendingFirstTurnAiTitle,
  shouldCommitFirstTurnAiTitle,
  shouldFlushFirstTurnAiTitle,
  shouldQueueFirstTurnAiTitle,
} from './first-turn-title.ts'

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
  it('starts the idle flush only when a title is pending and the queue is empty', () => {
    expect(shouldFlushFirstTurnAiTitle({ hasPending: true, queueLength: 0 })).toBe(true)
  })

  it('waits until the message queue drains so a follow-up is not raced', () => {
    expect(shouldFlushFirstTurnAiTitle({ hasPending: true, queueLength: 1 })).toBe(false)
  })

  it('is a no-op when nothing is pending', () => {
    expect(shouldFlushFirstTurnAiTitle({ hasPending: false, queueLength: 0 })).toBe(false)
  })
})

describe('decidePendingFirstTurnAiTitle (#46)', () => {
  const idle = {
    sessionAlive: true,
    isProcessing: false,
    queueLength: 0,
    currentName: 'Write a report about oak trees',
    placeholder: 'Write a report about oak trees',
  }

  it('starts when the session is still idle on the placeholder', () => {
    expect(decidePendingFirstTurnAiTitle(idle)).toBe('start')
  })

  it('defers when a new turn has already started', () => {
    expect(decidePendingFirstTurnAiTitle({ ...idle, isProcessing: true })).toBe('defer')
  })

  it('defers when a follow-up is queued', () => {
    expect(decidePendingFirstTurnAiTitle({ ...idle, queueLength: 1 })).toBe('defer')
  })

  it('drops when the user renamed the session', () => {
    expect(decidePendingFirstTurnAiTitle({ ...idle, currentName: 'Oak bid' })).toBe('drop')
  })

  it('drops when the session is gone', () => {
    expect(decidePendingFirstTurnAiTitle({ ...idle, sessionAlive: false })).toBe('drop')
  })
})

describe('shouldCommitFirstTurnAiTitle (#46)', () => {
  it('commits only while the placeholder is still the live name', () => {
    expect(shouldCommitFirstTurnAiTitle({
      sessionAlive: true,
      currentName: 'Write a report about oak trees',
      placeholder: 'Write a report about oak trees',
    })).toBe(true)
  })

  it('does not overwrite a rename that landed during generation', () => {
    expect(shouldCommitFirstTurnAiTitle({
      sessionAlive: true,
      currentName: 'Oak bid',
      placeholder: 'Write a report about oak trees',
    })).toBe(false)
  })

  it('does not revive a deleted session', () => {
    expect(shouldCommitFirstTurnAiTitle({
      sessionAlive: false,
      currentName: 'Write a report about oak trees',
      placeholder: 'Write a report about oak trees',
    })).toBe(false)
  })
})
