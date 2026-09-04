import { useEffect, useMemo, useState } from 'react'

/** Leave scheduling headroom while keeping the user-visible reveal under 2s. */
export const COMPLETED_REVEAL_MAX_MS = 1_800
export const COMPLETED_REVEAL_MIN_MS = 160
export const COMPLETED_REVEAL_MS_PER_UNIT = 2
export const COMPLETED_REVEAL_FRAME_MS = 40

export function getCompletedRevealDurationMs(unitCount: number): number {
  if (unitCount <= 0) return 0
  return Math.min(
    COMPLETED_REVEAL_MAX_MS,
    Math.max(COMPLETED_REVEAL_MIN_MS, unitCount * COMPLETED_REVEAL_MS_PER_UNIT),
  )
}

export function getCompletedRevealUnitCount(
  totalUnits: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (totalUnits <= 0) return 0
  if (durationMs <= 0 || elapsedMs >= durationMs) return totalUnits
  if (elapsedMs <= 0) return 1
  return Math.min(totalUnits, Math.max(1, Math.ceil(totalUnits * elapsedMs / durationMs)))
}

export interface CompletedResponseReveal {
  text: string
  isRevealing: boolean
  durationMs: number
}

/**
 * Reveal a fully received response in quick, Unicode-safe batches.
 * A persisted/old response has no recent start window and renders immediately.
 */
export function useCompletedResponseReveal(
  text: string,
  revealStartTime: number | undefined,
  reduceMotion: boolean,
): CompletedResponseReveal {
  const units = useMemo(() => Array.from(text), [text])
  const durationMs = getCompletedRevealDurationMs(units.length)
  const [now, setNow] = useState(() => Date.now())
  const elapsedMs = revealStartTime == null ? durationMs : Math.max(0, now - revealStartTime)
  const isRevealing = !reduceMotion
    && revealStartTime != null
    && elapsedMs < durationMs
    && units.length > 1
  const visibleUnits = isRevealing
    ? getCompletedRevealUnitCount(units.length, elapsedMs, durationMs)
    : units.length

  useEffect(() => {
    if (!isRevealing || revealStartTime == null) return
    const remainingMs = Math.max(0, durationMs - (Date.now() - revealStartTime))
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(COMPLETED_REVEAL_FRAME_MS, remainingMs)),
    )
    return () => window.clearTimeout(timer)
  }, [durationMs, isRevealing, revealStartTime, now])

  return {
    text: visibleUnits === units.length ? text : units.slice(0, visibleUnits).join(''),
    isRevealing,
    durationMs,
  }
}
