import { useEffect, useRef, useState, type RefObject } from 'react'
import { waitForResponseSettled } from './completion-settle'

export { COMPLETION_ACTION_DELAY_MS } from './completion-settle'

/** Delay only a live turn's controls, never restored history. */
export function useCompletionActions(complete: boolean, body: RefObject<HTMLDivElement>, content: string): boolean {
  const sawPending = useRef(!complete)
  const [ready, setReady] = useState(complete)
  useEffect(() => {
    if (!complete) {
      sawPending.current = true
      setReady(false)
      return
    }
    if (!sawPending.current) {
      setReady(true)
      return
    }
    setReady(false)
    // Include the growth shell's CSS transition as
    // well as Markdown's staggered fades; transport completion is too early.
    return waitForResponseSettled(body.current?.closest<HTMLElement>('[data-response-body-growth]') ?? body.current, () => setReady(true))
  }, [complete, body, content])
  return complete && ready
}
