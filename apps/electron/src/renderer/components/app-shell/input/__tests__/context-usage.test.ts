import { describe, expect, it } from 'bun:test'
import {
  breakdownShare,
  contextUsagePercent,
  contextUsageRatio,
  contextUsageTone,
  formatCacheHitRate,
  shouldShowContextUsage,
} from '../context-usage'

describe('context usage display', () => {
  it('hides the indicator until provider input tokens exist', () => {
    expect(shouldShowContextUsage(undefined)).toBe(false)
    expect(shouldShowContextUsage({ inputTokens: 0 })).toBe(false)
    expect(shouldShowContextUsage({ inputTokens: 12 })).toBe(true)
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
})
