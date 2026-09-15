export interface ContextUsageBreakdown {
  systemPrompt: number
  tools: number
  messages: number
}

export interface ContextStatus {
  isCompacting?: boolean
  inputTokens?: number
  contextWindow?: number
  cacheHitRate?: number
  contextBreakdown?: ContextUsageBreakdown
}

export type ContextUsageTone = 'default' | 'info' | 'critical'

export function shouldShowContextUsage(
  status?: ContextStatus,
): status is ContextStatus & { inputTokens: number } {
  return status?.inputTokens != null && Number.isFinite(status.inputTokens) && status.inputTokens > 0
}

export function cacheHitRateFromTokenUsage(usage?: {
  cacheHitRate?: number
  lastCall?: { inputTokens: number; cacheReadTokens?: number }
}): number | undefined {
  if (usage?.cacheHitRate != null && Number.isFinite(usage.cacheHitRate)) {
    return Math.min(1, Math.max(0, usage.cacheHitRate))
  }
  const call = usage?.lastCall
  if (!call || call.cacheReadTokens == null) return undefined
  const total = Math.max(0, call.inputTokens) + Math.max(0, call.cacheReadTokens)
  if (total <= 0) return undefined
  return Math.min(1, Math.max(0, call.cacheReadTokens) / total)
}

/** Share of the model window, not the compaction threshold. */
export function contextUsageRatio(inputTokens: number, contextWindow?: number): number | undefined {
  if (contextWindow == null || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined
  if (!Number.isFinite(inputTokens) || inputTokens < 0) return 0
  return inputTokens / contextWindow
}

export function contextUsagePercent(ratio: number | undefined): number | undefined {
  if (ratio == null || !Number.isFinite(ratio)) return undefined
  return Math.max(0, Math.round(ratio * 100))
}

export function contextUsageTone(ratio: number | undefined): ContextUsageTone {
  if (ratio == null) return 'default'
  if (ratio >= 0.9) return 'critical'
  if (ratio >= 0.7) return 'info'
  return 'default'
}

export function contextUsageRingColor(tone: ContextUsageTone): string {
  if (tone === 'critical') return 'var(--destructive)'
  if (tone === 'info') return 'var(--info)'
  return 'currentColor'
}

export function formatCacheHitRate(rate: number | undefined): string | undefined {
  if (rate == null || !Number.isFinite(rate)) return undefined
  return `${Math.round(Math.min(1, Math.max(0, rate)) * 100)}%`
}

export function breakdownTotal(breakdown: ContextUsageBreakdown): number {
  return Math.max(0, breakdown.systemPrompt) + Math.max(0, breakdown.tools) + Math.max(0, breakdown.messages)
}

export function breakdownShare(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, value) / total
}
