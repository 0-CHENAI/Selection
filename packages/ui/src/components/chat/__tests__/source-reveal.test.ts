import { describe, expect, it } from 'bun:test'
import { advanceSourceReveal, revealBoundaries, SOURCE_REVEAL_WINDOW_MS } from '../source-reveal'

describe('continuous source presentation', () => {
  it('spreads a burst over many frames, finishing without needing another network event', () => {
    let shown = 0
    const lengths: number[] = []
    for (let elapsed = 0; elapsed < SOURCE_REVEAL_WINDOW_MS + 64; elapsed += 32) {
      shown = advanceSourceReveal(shown, 2000, 32)
      lengths.push(Math.floor(shown))
    }
    expect(lengths[0]).toBeGreaterThan(0)
    expect(lengths[0]).toBeLessThan(40)
    expect(new Set(lengths).size).toBeGreaterThan(60)
    expect(lengths.at(-1)).toBe(2000)
    expect(lengths.every((n, i) => i === 0 || n >= lengths[i - 1]!)).toBe(true)
  })
  it('does not split emoji, combining marks or CJK graphemes', () => {
    const text = '中👨‍👩‍👧‍👦e\u0301🙂文'
    const ends = revealBoundaries(text)
    expect(ends).toHaveLength(5)
    expect(ends.map((end, i) => text.slice(i ? ends[i - 1] : 0, end))).toEqual(['中', '👨‍👩‍👧‍👦', 'e\u0301', '🙂', '文'])
    expect(text.slice(0, ends.at(-1))).toBe(text)
  })
  it('paces small deltas without waiting for a paragraph or whole response', () => {
    expect(advanceSourceReveal(0, 20, 32)).toBeGreaterThan(0)
    expect(advanceSourceReveal(0, 20, 32)).toBeLessThan(4)
    expect(advanceSourceReveal(20, 25, 100)).toBe(25)
  })
})
