import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Server renders (session replay, static tests) have no layout pass.
// The browser still flushes the enter pose before paint.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Live completion of a thinking row.
 *
 * A row that mounts already finished (history, reload, virtualization
 * remount) stays `settled` and must not replay the text swap. Only the
 * instance that observed `streaming` moves through `swapping`.
 *
 * Timings match transitions.dev Prototype 28. The CSS variables are the
 * source of truth; the constants are the fallback when the stylesheet
 * has not been applied.
 */
export const THINKING_SHIMMER_MS = 2000
export const THINKING_SWAP_MS = 150
export const THINKING_SWAP_GAP_MS = 50
export const THINKING_SWAP_DISTANCE_PX = 8
export const THINKING_SWAP_BLUR_PX = 2

export type ThinkingSwapPhase = 'streaming' | 'swapping' | 'settled'

export function initialThinkingSwapPhase(running: boolean): ThinkingSwapPhase {
  return running ? 'streaming' : 'settled'
}

export function nextThinkingSwapPhase(
  phase: ThinkingSwapPhase,
  running: boolean,
  reduceMotion: boolean,
): ThinkingSwapPhase {
  if (running) return 'streaming'
  if (phase === 'streaming') return reduceMotion ? 'settled' : 'swapping'
  if (phase === 'swapping') return 'swapping'
  return 'settled'
}

/** The incoming line is held in the enter pose for the swap gap. */
export function thinkingSwapEntering(
  shown: ThinkingSwapPhase,
  committed: ThinkingSwapPhase,
  entering: boolean,
): boolean {
  return shown === 'swapping' && (entering || committed === 'streaming')
}

/** Keep the wider label while this instance is live so the swap does not resize the row. */
export function thinkingLabelSizer(live: string, done: string, holdLiveWidth: boolean): string {
  if (!holdLiveWidth) return done
  return live.length >= done.length ? live : done
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function readCssMs(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const value = parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

export function useThinkingCompletionSwap(running: boolean) {
  const [phase, setPhase] = useState<ThinkingSwapPhase>(() => initialThinkingSwapPhase(running))
  const [entering, setEntering] = useState(false)
  const liveRef = useRef<HTMLSpanElement>(null)
  const sawStreaming = useRef(false)
  const reduceMotion = prefersReducedMotion()
  const next = nextThinkingSwapPhase(phase, running, reduceMotion)

  if (next !== phase) {
    setPhase(next)
    setEntering(next === 'swapping')
  }

  if (running || phase === 'streaming' || phase === 'swapping' || next === 'swapping') {
    sawStreaming.current = true
  }

  useIsoLayoutEffect(() => {
    if (phase !== 'swapping') return
    if (liveRef.current) void liveRef.current.offsetWidth
    const gap = readCssMs('--think-gap', THINKING_SWAP_GAP_MS)
    const swap = readCssMs('--think-swap', THINKING_SWAP_MS)
    const release = window.setTimeout(() => setEntering(false), gap)
    const done = window.setTimeout(() => {
      setEntering(false)
      setPhase(current => (current === 'swapping' ? 'settled' : current))
    }, swap + gap)
    return () => {
      window.clearTimeout(release)
      window.clearTimeout(done)
    }
  }, [phase])

  return {
    phase: next,
    entering: thinkingSwapEntering(next, phase, entering),
    holdLiveWidth: sawStreaming.current,
    liveRef,
  }
}
