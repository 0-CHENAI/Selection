import { describe, expect, it } from 'bun:test'
import { formatUsageCost, formatUsageDuration } from '../session-usage-format'

describe('session usage formatting', () => {
  it('formats wall-clock duration compactly', () => {
    expect(formatUsageDuration(0)).toBe('0s')
    expect(formatUsageDuration(59_400)).toBe('59s')
    expect(formatUsageDuration(60_000)).toBe('1m')
    expect(formatUsageDuration(909_000)).toBe('15m 9s')
  })

  it('keeps small costs visible without noisy precision', () => {
    expect(formatUsageCost(0)).toBe('$0.00')
    expect(formatUsageCost(0.00614)).toBe('$0.0061')
    expect(formatUsageCost(0.123)).toBe('$0.12')
  })
})
