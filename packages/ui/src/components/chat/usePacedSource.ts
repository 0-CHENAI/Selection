import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { advanceSourceReveal, revealBoundaries, SOURCE_REVEAL_FRAME_MS } from './source-reveal'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const played = new Set<string>()

/** Keep received text moving through completion; history is never queued. */
export function usePacedSource(target: string, streaming: boolean, completedAt?: number, identity?: string) {
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const admitted = useRef<{ identity?: string; live: boolean }>()
  if (!admitted.current || admitted.current.identity !== identity) {
    const age = completedAt == null ? Infinity : Date.now() - completedAt
    admitted.current = { identity, live: typeof window !== 'undefined' && (streaming || (age >= 0 && age < 1600)) && !reduced() && (identity == null || !played.has(identity)) }
  }
  const live = admitted.current.live
  const [visible, setVisible] = useState(() => live ? '' : target)
  const visibleRef = useRef(visible)
  const progress = useRef(0)
  const lastFrame = useRef(0)
  const boundaries = useMemo(() => live ? revealBoundaries(target) : [], [target, live])
  const [bypassed, setBypassed] = useState(false)
  // A corrected answer is authoritative immediately; never play a stale prefix.
  const compatible = target.startsWith(visible)
  const text = live && !bypassed && compatible ? visible : target

  useBrowserLayoutEffect(() => {
    if (!live) return
    if (identity != null) {
      played.add(identity)
      if (played.size > 512) played.delete(played.values().next().value!)
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { if (motion.matches) setBypassed(true) }
    motion.addEventListener('change', change)
    return () => motion.removeEventListener('change', change)
  }, [identity, live])

  useEffect(() => {
    if (!live || bypassed || !compatible) {
      visibleRef.current = target
      setVisible(target)
      progress.current = boundaries.length
      return
    }
    if (visibleRef.current === target) { lastFrame.current = 0; return }
    let frame = 0
    if (!lastFrame.current) lastFrame.current = performance.now()
    const tick = (now: number) => {
      if (now - lastFrame.current < SOURCE_REVEAL_FRAME_MS) { frame = requestAnimationFrame(tick); return }
      progress.current = advanceSourceReveal(progress.current, boundaries.length, now - lastFrame.current)
      lastFrame.current = now
      const count = Math.floor(progress.current)
      const next = target.slice(0, count ? boundaries[count - 1] : 0)
      visibleRef.current = next
      setVisible(next)
      if (count < boundaries.length) frame = requestAnimationFrame(tick)
      else lastFrame.current = 0
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, boundaries, live, bypassed, compatible])

  return { text, revealing: text !== target }
}
