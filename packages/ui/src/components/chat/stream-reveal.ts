/**
 * Adaptive character reveal — same pressure curve as dsh-smooth-stream.
 *
 * Model chunks arrive in bursts. Bind the DOM to those arrivals and text
 * pops a paragraph at a time. This module decides how many code points to
 * release on one frame from the current backlog, carrying fractional debt
 * so a slow stream stays measured and a fast stream catches up.
 */

export const QUEUE_BASE_SPEED_CPS = 90
export const QUEUE_ACCEL_EXPONENT = 1.25
export const QUEUE_PRESSURE_FACTOR = 0.85
export const QUEUE_MAX_SPEED_CPS = 600
/** After a hitch, do not replay the missed interval in one paint. */
export const REVEAL_MAX_FRAME_MS = 32

export type AdaptiveQueueStep = {
  revealChars: number
  debt: number
  speedCps: number
}

export function countCodePoints(text: string): number {
  let count = 0
  for (const _ of text) {
    void _
    count += 1
  }
  return count
}

export function sliceCodePoints(text: string, count: number): string {
  if (count <= 0) return ''
  let taken = 0
  let end = 0
  for (const char of text) {
    if (taken >= count) break
    end += char.length
    taken += 1
  }
  return text.slice(0, end)
}

export function computeAdaptiveQueueStep(
  backlog: number,
  dtMs: number,
  debt: number,
): AdaptiveQueueStep {
  if (backlog <= 0 || dtMs <= 0) return { revealChars: 0, debt: 0, speedCps: 0 }
  const dt = Math.min(REVEAL_MAX_FRAME_MS, dtMs)
  const speedCps = Math.min(
    QUEUE_MAX_SPEED_CPS,
    QUEUE_BASE_SPEED_CPS + Math.pow(backlog, QUEUE_ACCEL_EXPONENT) * QUEUE_PRESSURE_FACTOR,
  )
  const accumulated = Math.max(0, debt) + speedCps * (dt / 1000)
  const revealChars = Math.min(backlog, Math.floor(accumulated))
  return {
    revealChars,
    debt: revealChars >= backlog ? 0 : accumulated - revealChars,
    speedCps,
  }
}

export function nextRevealedText(displayed: string, target: string, revealChars: number): string {
  if (!target.startsWith(displayed)) return target
  return displayed + sliceCodePoints(target.slice(displayed.length), revealChars)
}

/** Clip each text node to a shared code-point budget, in document order. */
export function applyRevealBudget(fulls: readonly string[], shown: number): string[] {
  let remaining = Math.max(0, shown)
  return fulls.map(full => {
    const slice = sliceCodePoints(full, remaining)
    remaining -= countCodePoints(slice)
    return slice
  })
}

/** The response card may grow with revealed text, but must not shrink mid-stream. */
export function nextHeightFloor(previous: number, measured: number): number {
  return measured + 0.5 >= previous ? measured : previous
}

/**
 * Keep the already-readable prefix when React remounts text nodes.
 * A rewrite that is not an append shrinks the budget to the common prefix.
 */
export function reconcileShown(previousRevealed: string, nextFull: string, shown: number): number {
  const limit = countCodePoints(nextFull)
  if (nextFull.startsWith(previousRevealed)) return Math.min(shown, limit)
  const prev = [...previousRevealed]
  const next = [...nextFull]
  let n = 0
  while (n < prev.length && n < next.length && prev[n] === next[n]) n += 1
  return n
}
