import type { AgentEventUsage } from '@craft-agent/core/types'
import type {
  SessionModelCallUsage,
  SessionTurnUsage,
  SessionTurnUsageSnapshot,
} from '@craft-agent/shared/sessions'

export interface TurnUsageAccumulator extends SessionModelCallUsage {
  modelCallCount: number
  startedAt: number
}

export function createTurnUsageAccumulator(startedAt: number): TurnUsageAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    modelCallCount: 0,
    startedAt,
  }
}

function normalizeCounter(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function normalizeModelCallUsage(usage: AgentEventUsage): SessionModelCallUsage {
  const inputTokens = normalizeCounter(usage.inputTokens)
  const outputTokens = normalizeCounter(usage.outputTokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: normalizeCounter(usage.cacheReadTokens),
    cacheCreationTokens: normalizeCounter(usage.cacheCreationTokens),
    costUsd: normalizeCounter(usage.costUsd),
  }
}

export function recordModelCallUsage(
  accumulator: TurnUsageAccumulator,
  usage: AgentEventUsage,
): { accumulator: TurnUsageAccumulator; lastCall: SessionModelCallUsage } {
  const lastCall = normalizeModelCallUsage(usage)
  return {
    lastCall,
    accumulator: {
      inputTokens: accumulator.inputTokens + lastCall.inputTokens,
      outputTokens: accumulator.outputTokens + lastCall.outputTokens,
      totalTokens: accumulator.totalTokens + lastCall.totalTokens,
      cacheReadTokens: accumulator.cacheReadTokens + lastCall.cacheReadTokens,
      cacheCreationTokens: accumulator.cacheCreationTokens + lastCall.cacheCreationTokens,
      costUsd: accumulator.costUsd + lastCall.costUsd,
      modelCallCount: accumulator.modelCallCount + 1,
      startedAt: accumulator.startedAt,
    },
  }
}

export function finalizeTurnUsage(
  accumulator: TurnUsageAccumulator,
  completedAt: number,
): SessionTurnUsage {
  return {
    ...accumulator,
    completedAt,
    wallClockMs: Math.max(0, completedAt - accumulator.startedAt),
  }
}

export function snapshotTurnUsage(
  accumulator: TurnUsageAccumulator,
  updatedAt: number,
): SessionTurnUsageSnapshot {
  return {
    ...accumulator,
    updatedAt,
    wallClockMs: Math.max(0, updatedAt - accumulator.startedAt),
  }
}
