import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { advanceSourceReveal, revealBoundaries, SOURCE_REVEAL_FRAME_MS } from './source-reveal'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const played = new Set<string>()

/** Keep received text moving through completion; history is never queued. */
export function usePacedSource(target: string, streaming: boolean, completedAt?: number, identity?: string) {
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const admitted = useRef<{ identity?: string; live: boolean; initialText: string; initialProgress: number }>()
  if (!admitted.current || admitted.current.identity !== identity) {
    const age = completedAt == null ? Infinity : Date.now() - completedAt
    const seen = identity != null && played.has(identity)
    const live = typeof window !== 'undefined' && !reduced() && (streaming || (!seen && age >= 0 && age < 1600))
    // Returning to an active answer skips its received prefix, not future deltas.
    const initialText = live && !seen ? '' : target
    admitted.current = { identity, live, initialText, initialProgress: live && seen ? revealBoundaries(target).length : 0 }
  }
  const { live, initialText, initialProgress } = admitted.current
  const [view, setView] = useState(() => ({ identity, text: initialText, bypassed: false }))
  const visible = view.identity === identity ? view.text : initialText
  const bypassed = view.identity === identity && view.bypassed
  const queueRef = useRef({ identity, visible: initialText, progress: initialProgress, lastFrame: 0 })
  if (queueRef.current.identity !== identity) {
    queueRef.current = { identity, visible: initialText, progress: initialProgress, lastFrame: 0 }
  }
  const queue = queueRef.current
  const boundaries = useMemo(() => live ? revealBoundaries(target) : [], [target, live])
  // A corrected answer is authoritative immediately; never play a stale prefix.
  const compatible = target.startsWith(visible)
  const text = live && !bypassed && compatible ? visible : target

  useBrowserLayoutEffect(() => {
    setView(previous => previous.identity === identity ? previous : { identity, text: initialText, bypassed: false })
    if (!live) return
    if (identity != null) {
      played.add(identity)
      if (played.size > 512) played.delete(played.values().next().value!)
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      if (motion.matches) setView(previous => previous.identity === identity ? { ...previous, bypassed: true } : previous)
    }
    motion.addEventListener('change', change)
    return () => motion.removeEventListener('change', change)
    // Admission is per identity, not per incoming text snapshot.
  }, [identity, live])

  useEffect(() => {
    const publish = (next: string) => setView(previous => previous.identity === identity && previous.text !== next ? { ...previous, text: next } : previous)
    if (!live || bypassed || !compatible) {
      queue.visible = target
      publish(target)
      queue.progress = boundaries.length
      queue.lastFrame = 0
      return
    }
    if (queue.visible === target) { queue.lastFrame = 0; return }
    let frame = 0
    if (!queue.lastFrame) queue.lastFrame = performance.now()
    const tick = (now: number) => {
      if (now - queue.lastFrame < SOURCE_REVEAL_FRAME_MS) { frame = requestAnimationFrame(tick); return }
      queue.progress = advanceSourceReveal(queue.progress, boundaries.length, now - queue.lastFrame)
      queue.lastFrame = now
      const count = Math.floor(queue.progress)
      queue.visible = target.slice(0, count ? boundaries[count - 1] : 0)
      publish(queue.visible)
      if (count < boundaries.length) frame = requestAnimationFrame(tick)
      else queue.lastFrame = 0
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, boundaries, live, bypassed, compatible, identity, queue])

  return { text, revealing: text !== target }
}
