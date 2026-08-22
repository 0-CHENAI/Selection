import { describe, expect, it } from 'bun:test'
import {
  createTurnUsageAccumulator,
  finalizeTurnUsage,
  normalizeModelCallUsage,
  recordModelCallStart,
  recordModelCallUsage,
  snapshotTurnUsage,
} from './usage-accounting'

describe('turn usage accounting', () => {
  it('normalizes one provider call without changing legacy token semantics', () => {
    expect(normalizeModelCallUsage({
      inputTokens: 1_200,
      outputTokens: 80,
      cacheReadTokens: 1_000,
      cacheCreationTokens: 20,
      costUsd: 0.004,
    })).toEqual({
      inputTokens: 1_200,
      outputTokens: 80,
      totalTokens: 1_280,
      cacheReadTokens: 1_000,
      cacheCreationTokens: 20,
      costUsd: 0.004,
    })
  })

  it('accumulates every model call in a user turn', () => {
    let turn = createTurnUsageAccumulator(1_000)
    const first = recordModelCallUsage(turn, {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 80,
      costUsd: 0.01,
    })
    turn = first.accumulator
    const second = recordModelCallUsage(turn, {
      inputTokens: 140,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheCreationTokens: 5,
      costUsd: 0.02,
    })

    expect(first.lastCall.totalTokens).toBe(110)
    expect(second.lastCall.totalTokens).toBe(160)
    expect(snapshotTurnUsage(second.accumulator, 4_000)).toEqual({
      inputTokens: 240,
      outputTokens: 30,
      totalTokens: 270,
      cacheReadTokens: 180,
      cacheCreationTokens: 5,
      costUsd: 0.03,
      modelCallCount: 2,
      startedAt: 1_000,
      updatedAt: 4_000,
      wallClockMs: 3_000,
    })
    expect(finalizeTurnUsage(second.accumulator, 5_500)).toEqual({
      inputTokens: 240,
      outputTokens: 30,
      totalTokens: 270,
      cacheReadTokens: 180,
      cacheCreationTokens: 5,
      costUsd: 0.03,
      modelCallCount: 2,
      startedAt: 1_000,
      completedAt: 5_500,
      wallClockMs: 4_500,
    })
  })

  it('clamps invalid negative provider counters and clock skew', () => {
    const recorded = recordModelCallUsage(createTurnUsageAccumulator(5_000), {
      inputTokens: -1,
      outputTokens: -2,
      cacheReadTokens: -3,
      cacheCreationTokens: -4,
      costUsd: -5,
    })
    expect(recorded.lastCall).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    })
    expect(finalizeTurnUsage(recorded.accumulator, 4_000).wallClockMs).toBe(0)
  })

  it('counts failed attempts without usage and does not double-count later usage', () => {
    let turn = recordModelCallStart(createTurnUsageAccumulator(1_000))
    turn = recordModelCallUsage(turn, {
      inputTokens: 100,
      outputTokens: 10,
    }, { countModelCall: false }).accumulator
    turn = recordModelCallStart(turn)

    expect(turn.modelCallCount).toBe(2)
    expect(turn.inputTokens).toBe(100)
    expect(turn.outputTokens).toBe(10)
  })
})
