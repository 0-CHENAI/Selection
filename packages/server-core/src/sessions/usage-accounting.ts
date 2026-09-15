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

/** Last-call cache hit rate: cache reads over the current request input footprint. */
export function cacheHitRateFromUsage(usage: Pick<AgentEventUsage, 'inputTokens' | 'cacheReadTokens' | 'contextTokens'>): number | undefined {
  const cacheRead = normalizeCounter(usage.cacheReadTokens)
  const reportedContext = normalizeCounter(usage.contextTokens)
  const totalInput = reportedContext > 0
    ? reportedContext
    : normalizeCounter(usage.inputTokens) + cacheRead
  if (totalInput <= 0) return undefined
  return Math.min(1, cacheRead / totalInput)
}

export function normalizeContextBreakdown(
  breakdown: AgentEventUsage['contextBreakdown'],
): AgentEventUsage['contextBreakdown'] | undefined {
  if (!breakdown) return undefined
  const systemPrompt = normalizeCounter(breakdown.systemPrompt)
  const tools = normalizeCounter(breakdown.tools)
  const messages = normalizeCounter(breakdown.messages)
  if (systemPrompt + tools + messages <= 0) return undefined
  return { systemPrompt, tools, messages }
}

export function applyContextUsageFields(
  tokenUsage: { cacheHitRate?: number; contextBreakdown?: AgentEventUsage['contextBreakdown'] },
  usage: AgentEventUsage,
): void {
  if (typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)) {
    tokenUsage.cacheHitRate = Math.min(1, Math.max(0, usage.cacheHitRate))
  } else if (usage.cacheReadTokens != null) {
    const rate = cacheHitRateFromUsage(usage)
    if (rate != null) tokenUsage.cacheHitRate = rate
  }

  if (!Object.hasOwn(usage, 'contextBreakdown')) return
  const next = normalizeContextBreakdown(usage.contextBreakdown)
  if (next) tokenUsage.contextBreakdown = next
  else delete tokenUsage.contextBreakdown
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
  options: { countModelCall?: boolean } = {},
): { accumulator: TurnUsageAccumulator; lastCall: SessionModelCallUsage } {
  const lastCall = normalizeModelCallUsage(usage)
  const countModelCall = options.countModelCall ?? true
  return {
    lastCall,
    accumulator: {
      inputTokens: accumulator.inputTokens + lastCall.inputTokens,
      outputTokens: accumulator.outputTokens + lastCall.outputTokens,
      totalTokens: accumulator.totalTokens + lastCall.totalTokens,
      cacheReadTokens: accumulator.cacheReadTokens + lastCall.cacheReadTokens,
      cacheCreationTokens: accumulator.cacheCreationTokens + lastCall.cacheCreationTokens,
      costUsd: accumulator.costUsd + lastCall.costUsd,
      modelCallCount: accumulator.modelCallCount + (countModelCall ? 1 : 0),
      startedAt: accumulator.startedAt,
    },
  }
}

/** Count an attempted provider call before usage exists. */
export function recordModelCallStart(accumulator: TurnUsageAccumulator): TurnUsageAccumulator {
  return {
    ...accumulator,
    modelCallCount: accumulator.modelCallCount + 1,
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
