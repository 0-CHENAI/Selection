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

/**
 * First paint of the live work-header row (“1 思考中…”).
 *
 * Height stays reserved (#805); this is opacity + 4px rise + 2px blur only.
 * The instance that mounts with the chrome plays `start` → `run` → `rest`.
 * History, reduced motion, and a later preview/text swap stay `rest`.
 */
export const WORK_CHROME_ENTER_MS = 220
export const WORK_CHROME_ENTER_Y_MS = 280
export const WORK_CHROME_ENTER_DELAY_MS = 60
export const WORK_CHROME_ENTER_DISTANCE_PX = 4
export const WORK_CHROME_ENTER_BLUR_PX = 2

export type WorkChromeEnterPose = 'start' | 'run' | 'rest'

export function initialWorkChromeEnterPose(
  live: boolean,
  reduceMotion: boolean,
): WorkChromeEnterPose {
  return live && !reduceMotion ? 'start' : 'rest'
}

export function workChromeEnterClassName(pose: WorkChromeEnterPose): string | undefined {
  if (pose === 'rest') return undefined
  return pose === 'start' ? 'work-chrome-enter is-enter-start' : 'work-chrome-enter'
}

export function useWorkChromeEnter(live: boolean, reduceMotion: boolean | null) {
  const [pose, setPose] = useState<WorkChromeEnterPose>(() =>
    initialWorkChromeEnterPose(live, !!reduceMotion),
  )
  const ref = useRef<HTMLButtonElement>(null)

  // First paint must flush `start` (hidden). Scheduling from useLayoutEffect
  // would setState before paint and skip the enter pose entirely.
  useEffect(() => {
    if (pose !== 'start') return
    const id = requestAnimationFrame(() => setPose('run'))
    return () => cancelAnimationFrame(id)
  }, [pose])

  useEffect(() => {
    if (pose !== 'run') return
    const node = ref.current
    const finish = () => setPose(current => (current === 'run' ? 'rest' : current))
    if (!node) {
      finish()
      return
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== node) return
      // Filter finishes first; transform is the long axis of the enter.
      if (event.propertyName !== 'transform') return
      finish()
    }
    node.addEventListener('transitionend', onEnd)
    const ms = readCssMs('--work-chrome-enter-y', WORK_CHROME_ENTER_Y_MS)
      + readCssMs('--work-chrome-enter-delay', WORK_CHROME_ENTER_DELAY_MS)
    const fallback = window.setTimeout(finish, ms + 50)
    return () => {
      node.removeEventListener('transitionend', onEnd)
      window.clearTimeout(fallback)
    }
  }, [pose])

  return {
    ref,
    pose,
    className: workChromeEnterClassName(pose),
  }
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
