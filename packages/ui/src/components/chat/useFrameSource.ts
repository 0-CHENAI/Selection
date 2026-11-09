import { useEffect, useRef, useState } from 'react'

/**
 * Publish at most one source string per animation frame.
 * Fast token storms then cost one Markdown parse, not one parse per delta.
 */
export function useFrameSource(target: string, enabled: boolean): string {
  const [source, setSource] = useState(target)
  const targetRef = useRef(target)
  const rafRef = useRef<number | null>(null)
  targetRef.current = target

  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame === 'undefined') {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      setSource(target)
      return
    }
    if (target === source || rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setSource(targetRef.current)
    })
  }, [target, enabled, source])

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  return enabled ? source : target
}
