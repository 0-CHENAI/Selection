import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

export const COMPLETION_ACTION_DELAY_MS = 600

/** Delay only a live turn's controls, never restored history. */
export function useCompletionActions(complete: boolean): boolean {
  const sawPending = useRef(!complete)
  const [ready, setReady] = useState(complete)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    if (!complete) {
      sawPending.current = true
      setReady(false)
      return
    }
    if (!sawPending.current || reduceMotion) {
      setReady(true)
      return
    }
    const timer = setTimeout(() => setReady(true), COMPLETION_ACTION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [complete, reduceMotion])
  return complete && ready
}
