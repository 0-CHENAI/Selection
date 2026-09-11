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
  const admission = React.useRef<{ identity?: string; initial: boolean }>()
  useBrowserLayoutEffect(() => {
    if (!root.current) return
    if (!admission.current || admission.current.identity !== identity) {
      const key = identity ?? (startTime != null ? `time:${startTime}` : undefined)
      const fresh = streaming || (startTime != null && Date.now() - startTime < SEMANTIC_REVEAL_MAX_MS)
      admission.current = { identity, initial: fresh && (key == null || !played.has(key)) }
      if (fresh && key != null) {
        played.add(key)
        if (played.size > 512) played.delete(played.values().next().value!)
      }
    }
    controller.current = createSemanticReveal(root.current, admission.current.initial)
    return () => controller.current?.dispose()
    // Admission belongs to the message lifetime; content updates use the effect below.
  }, [root, identity])
  useBrowserLayoutEffect(() => {
    controller.current?.update(streaming, streaming || !!admission.current?.initial)
  }, [root, content, startTime, streaming, identity])
}
