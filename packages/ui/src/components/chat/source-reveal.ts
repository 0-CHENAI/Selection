/** Presentation pacing only: never changes the authoritative answer or tool state. */
export const SOURCE_REVEAL_WINDOW_MS = 2400
export const SOURCE_REVEAL_FRAME_MS = 32
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function revealBoundaries(text: string): number[] {
  return Array.from(segmenter.segment(text), part => part.index + part.segment.length)
}

/** Bound a burst's visual backlog, while small deltas advance in small text runs. */
export function advanceSourceReveal(shown: number, total: number, elapsed: number): number {
  const rate = Math.max(80, total * 1000 / SOURCE_REVEAL_WINDOW_MS)
  return Math.min(total, shown + rate * Math.max(0, elapsed) / 1000)
}
