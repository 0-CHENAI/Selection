import * as React from 'react'
import { createSemanticReveal, SEMANTIC_REVEAL_MAX_MS } from './semantic-reveal'
export { getRevealUnits, SEMANTIC_REVEAL_MS, SEMANTIC_REVEAL_MAX_MS } from './semantic-reveal'

const played = new Set<string>()
const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

export function useSemanticReveal(
  root: React.RefObject<HTMLDivElement>,
  content: string,
  startTime: number | undefined,
  streaming: boolean,
  identity?: string,
) {
  const controller = React.useRef<ReturnType<typeof createSemanticReveal>>()
  const liveIdentity = React.useRef<string | undefined>()
  const sawLive = React.useRef(false)
  if (liveIdentity.current !== identity) {
    liveIdentity.current = identity
    sawLive.current = false
  }
  if (streaming) sawLive.current = true
  const admission = React.useRef<{ identity?: string; initial: boolean }>()
  useBrowserLayoutEffect(() => {
    if (!root.current) return
    if (!admission.current || admission.current.identity !== identity) {
      const key = identity ?? (startTime != null ? `time:${startTime}` : undefined)
      // Only the renderer supplies this clock, at live completion. A burst may
      // commit before React ever paints a streaming frame. Never use message time.
      const age = startTime == null ? Infinity : Date.now() - startTime
      const fresh = streaming || (age >= 0 && age < SEMANTIC_REVEAL_MAX_MS)
      admission.current = { identity, initial: fresh && (key == null || !played.has(key)) }
      if (fresh && key != null) {
        played.add(key)
        if (played.size > 512) played.delete(played.values().next().value!)
      }
    }
    // Restored history needs neither geometry reads nor animation observers.
    // If it later resumes streaming, the update effect creates a controller
    // with animateInitial=false to seed existing text without replaying it.
    if (admission.current.initial) controller.current = createSemanticReveal(root.current, true)
    return () => {
      controller.current?.dispose()
      controller.current = undefined
    }
    // Admission belongs to the message lifetime; content updates use the effect below.
  }, [root, identity])
  useBrowserLayoutEffect(() => {
    // A live response retains its admission through completion so the last
    // paragraph can finish fading. Restored history remains immediate.
    const enabled = streaming || sawLive.current || !!admission.current?.initial
    if (enabled && !controller.current && root.current) {
      controller.current = createSemanticReveal(root.current, !!admission.current?.initial)
    }
    controller.current?.update(streaming, enabled)
  }, [root, content, startTime, streaming, identity])
}
