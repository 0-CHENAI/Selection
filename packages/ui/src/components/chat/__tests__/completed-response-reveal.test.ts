import { describe, expect, it } from 'bun:test'
import {
  COMPLETED_REVEAL_MAX_MS,
  COMPLETED_REVEAL_MIN_MS,
  getCompletedRevealDurationMs,
  getCompletedRevealUnitCount,
} from '../useCompletedResponseReveal'

describe('completed response pseudo-stream reveal', () => {
  it('keeps every reveal within the two-second contract', () => {
    expect(getCompletedRevealDurationMs(0)).toBe(0)
    expect(getCompletedRevealDurationMs(10)).toBe(COMPLETED_REVEAL_MIN_MS)
    expect(getCompletedRevealDurationMs(500)).toBe(1_000)
    expect(getCompletedRevealDurationMs(10_000)).toBe(COMPLETED_REVEAL_MAX_MS)
    expect(COMPLETED_REVEAL_MAX_MS).toBeLessThan(2_000)
  })

  it('reveals at least one unit immediately and all units at the deadline', () => {
    expect(getCompletedRevealUnitCount(100, 0, 1_000)).toBe(1)
    expect(getCompletedRevealUnitCount(100, 500, 1_000)).toBe(50)
    expect(getCompletedRevealUnitCount(100, 1_000, 1_000)).toBe(100)
    expect(getCompletedRevealUnitCount(100, 5_000, 1_000)).toBe(100)
  })

  it('never splits the surrogate pairs used by emoji', () => {
    const units = Array.from('结论🙂完成')
    const visibleUnits = getCompletedRevealUnitCount(units.length, 80, 160)

    expect(units.slice(0, visibleUnits).join('')).toBe('结论🙂')
  })
})
