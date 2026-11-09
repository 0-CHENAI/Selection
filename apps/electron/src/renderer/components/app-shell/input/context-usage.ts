export interface ContextUsageBreakdown {
  systemPrompt: number
  tools: number
  messages: number
  rules?: number
  skills?: number
  mcpTools?: number
  subagents?: number
  summarized?: number
}

export interface ContextStatus {
  isCompacting?: boolean
  inputTokens?: number
  contextWindow?: number
  cacheHitRate?: number
  contextBreakdown?: ContextUsageBreakdown
}

export type ContextUsageTone = 'default' | 'info' | 'critical'

export const CONTEXT_USAGE_CATEGORIES = [
  { id: 'systemPrompt', color: '#A3A3A3', labelKey: 'chat.contextSystemPrompt' },
  { id: 'tools', color: '#A78BFA', labelKey: 'chat.contextTools' },
  { id: 'rules', color: '#4ADE80', labelKey: 'chat.contextRules' },
  { id: 'skills', color: '#FBBF24', labelKey: 'chat.contextSkills' },
  { id: 'mcpTools', color: '#E879F9', labelKey: 'chat.contextMcpTools' },
  { id: 'subagents', color: '#60A5FA', labelKey: 'chat.contextSubagents' },
  { id: 'summarized', color: '#FB7185', labelKey: 'chat.contextSummarized' },
  { id: 'messages', color: '#F87171', labelKey: 'chat.contextMessages' },
] as const

export type ContextUsageCategoryId = (typeof CONTEXT_USAGE_CATEGORIES)[number]['id']

function positiveTokens(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

/** Current context occupancy. Top-level inputTokens can be wiped to 0 after a turn. */
export function resolveContextUsageTokens(usage?: {
  inputTokens?: number
  contextTokens?: number
  lastCall?: { inputTokens?: number; cacheReadTokens?: number }
  lastTurn?: { inputTokens?: number }
}): number | undefined {
  return positiveTokens(usage?.inputTokens)
    ?? positiveTokens(usage?.contextTokens)
    ?? positiveTokens((usage?.lastCall?.inputTokens ?? 0) + (usage?.lastCall?.cacheReadTokens ?? 0))
    ?? positiveTokens(usage?.lastTurn?.inputTokens)
}

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
  return CONTEXT_USAGE_CATEGORIES.reduce((sum, category) => (
    sum + Math.max(0, breakdown[category.id] ?? 0)
  ), 0)
}

export function breakdownShare(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, value) / total
}

export function contextUsageRows(breakdown?: ContextUsageBreakdown) {
  if (!breakdown) return []
  return CONTEXT_USAGE_CATEGORIES
    .map((category) => ({
      ...category,
      tokens: Math.max(0, breakdown[category.id] ?? 0),
    }))
    .filter((row) => row.tokens > 0)
}

export function formatContextTokenCount(tokens: number, kind: 'used' | 'window' = 'used'): string {
  if (kind === 'window' && tokens >= 1024 && tokens % 1024 === 0) {
    const kib = tokens / 1024
    if (kib >= 1024 && kib % 1024 === 0) return `${kib / 1024}M`
    return `${kib}K`
  }
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000
    return Number.isInteger(thousands) ? `${thousands}K` : `${thousands.toFixed(1)}K`
  }
  return String(Math.round(tokens))
}

export function contextBarShares(
  rows: Array<{ tokens: number }>,
  inputTokens: number,
  contextWindow?: number,
): { used: number[]; remaining: number } {
  const rowTotal = rows.reduce((sum, row) => sum + row.tokens, 0)
  const usedRatio = contextWindow != null && Number.isFinite(contextWindow) && contextWindow > 0
    ? Math.min(1, Math.max(0, inputTokens / contextWindow))
    : 1
  if (rowTotal <= 0) {
    return { used: inputTokens > 0 ? [usedRatio] : [], remaining: 1 - usedRatio }
  }
  return {
    used: rows.map((row) => (row.tokens / rowTotal) * usedRatio),
    remaining: 1 - usedRatio,
  }
}
