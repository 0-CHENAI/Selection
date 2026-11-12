import * as React from 'react'
import { revealStreamingText, STREAM_PACE_MAX_DT_MS } from './stream-pace'

const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/**
 * Coalesce live deltas at the paint boundary, then leak the backlog over a
 * few frames so IPC bursts do not grow the transcript by whole lines at once.
 * History, completion, edits and a new stream flush synchronously.
 */
type FrameContent = { content: string; identity?: string }

export function useFrameContent(content: string, streaming: boolean, identity?: string): string {
  const [painted, setPainted] = React.useState<FrameContent>({ content, identity })
  const latest = React.useRef<FrameContent>({ content, identity })
  const shown = React.useRef<FrameContent>({ content, identity })
  const frame = React.useRef<number>()
  const lastTime = React.useRef<number | undefined>(undefined)

  const stop = () => {
    if (frame.current != null) cancelAnimationFrame(frame.current)
    frame.current = undefined
    lastTime.current = undefined
  }

  const publish = (next: FrameContent) => {
    shown.current = next
    setPainted(next)
  }

  useBrowserLayoutEffect(() => {
    // A suspended/abandoned render must not become the pending frame's input.
    latest.current = { content, identity }
    if (!streaming || painted.identity !== identity || !content.startsWith(painted.content)) {
      stop()
      if (painted.content !== content || painted.identity !== identity) publish({ content, identity })
    } else if (painted.content !== content && frame.current == null) {
      frame.current = requestAnimationFrame((time) => {
        frame.current = undefined
        const incoming = latest.current
        if (
          shown.current.identity !== incoming.identity
          || !incoming.content.startsWith(shown.current.content)
        ) {
          lastTime.current = undefined
          publish(incoming)
          return
        }
        const rawDt = lastTime.current == null ? 16.67 : time - lastTime.current
        const dt = Math.min(STREAM_PACE_MAX_DT_MS, rawDt > 0 ? rawDt : 16.67)
        lastTime.current = time
        const nextContent = revealStreamingText(shown.current.content, incoming.content, dt, true)
        if (nextContent !== shown.current.content || incoming.identity !== shown.current.identity) {
          publish({ content: nextContent, identity: incoming.identity })
        }
        if (nextContent === incoming.content) lastTime.current = undefined
      })
    }
  }, [content, streaming, identity, painted])
  useBrowserLayoutEffect(() => () => {
    stop()
  }, [])
  return !streaming || painted.identity !== identity || !content.startsWith(painted.content)
    ? content : painted.content
}
