import { describe, expect, it } from 'bun:test'
import {
  breakdownShare,
  cacheHitRateFromTokenUsage,
  contextBarShares,
  contextUsagePercent,
  contextUsageRatio,
  contextUsageRows,
  contextUsageTone,
  formatCacheHitRate,
  formatContextTokenCount,
  resolveContextUsageTokens,
  shouldShowContextUsage,
} from '../context-usage'

describe('context usage display', () => {
  it('hides the indicator until provider input tokens exist', () => {
    expect(shouldShowContextUsage(undefined)).toBe(false)
    expect(shouldShowContextUsage({ inputTokens: 0 })).toBe(false)
    expect(shouldShowContextUsage({ inputTokens: 12 })).toBe(true)
  })

  it('falls back to last-turn occupancy when the live counter was wiped to 0', () => {
    expect(resolveContextUsageTokens({
      inputTokens: 0,
      contextTokens: 0,
      lastCall: { inputTokens: 0, cacheReadTokens: 0 },
      lastTurn: { inputTokens: 180_774 },
    })).toBe(180_774)
    expect(resolveContextUsageTokens({
      inputTokens: 12_000,
      lastTurn: { inputTokens: 180_774 },
    })).toBe(12_000)
  })

  it('measures the ring against the model window, not a compaction threshold', () => {
    expect(contextUsageRatio(27_700, 262_144)).toBeCloseTo(27_700 / 262_144)
    expect(contextUsagePercent(contextUsageRatio(27_700, 262_144))).toBe(11)
    expect(contextUsageRatio(1_000)).toBeUndefined()
    expect(contextUsagePercent(undefined)).toBeUndefined()
  })

  it('uses existing theme grades near the window limit', () => {
    expect(contextUsageTone(0.2)).toBe('default')
    expect(contextUsageTone(0.7)).toBe('info')
    expect(contextUsageTone(0.9)).toBe('critical')
    expect(contextUsageTone(undefined)).toBe('default')
  })

  it('formats cache hit rate and breakdown shares', () => {
    expect(formatCacheHitRate(0.428)).toBe('43%')
    expect(formatCacheHitRate(undefined)).toBeUndefined()
    expect(breakdownShare(20, 80)).toBe(0.25)
    expect(breakdownShare(10, 0)).toBe(0)
  })

  it('falls back to last-call cache reads for sessions that predate cacheHitRate', () => {
    expect(cacheHitRateFromTokenUsage({
      lastCall: { inputTokens: 200, cacheReadTokens: 150 },
    })).toBe(150 / 350)
    expect(cacheHitRateFromTokenUsage({
      cacheHitRate: 0.8,
      lastCall: { inputTokens: 200, cacheReadTokens: 150 },
    })).toBe(0.8)
    expect(cacheHitRateFromTokenUsage({
      lastCall: { inputTokens: 200 },
    })).toBeUndefined()
  })

  it('formats card token counts and hides empty composition rows', () => {
    expect(formatContextTokenCount(1_100)).toBe('1.1K')
    expect(formatContextTokenCount(222_400)).toBe('222.4K')
    expect(formatContextTokenCount(262_144, 'window')).toBe('256K')
    expect(contextUsageRows({
      systemPrompt: 12,
      tools: 0,
      messages: 80,
      skills: 9,
    }).map((row) => row.id)).toEqual(['systemPrompt', 'skills', 'messages'])
  })

  it('sizes the bar against the model window and keeps unused room', () => {
    const rows = contextUsageRows({
      systemPrompt: 25,
      tools: 25,
      messages: 50,
    })
    const shares = contextBarShares(rows, 80, 100)
    expect(shares.used.reduce((sum, share) => sum + share, 0)).toBeCloseTo(0.8)
    expect(shares.remaining).toBeCloseTo(0.2)
  })
})
