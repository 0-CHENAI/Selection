import * as React from 'react'

const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** Coalesce live deltas at the paint boundary, never pace/replay characters. */
export function useFrameContent(content: string, streaming: boolean, identity?: string): string {
  const [painted, setPainted] = React.useState({ content, identity })
  const latest = React.useRef({ content, identity })
  const frame = React.useRef<number>()
  useBrowserLayoutEffect(() => {
    // A suspended/abandoned render must not become the pending frame's input.
    latest.current = { content, identity }
    if (!streaming || painted.identity !== identity || !content.startsWith(painted.content)) {
      if (frame.current != null) cancelAnimationFrame(frame.current)
      frame.current = undefined
      if (painted.content !== content || painted.identity !== identity) setPainted({ content, identity })
    } else if (painted.content !== content && frame.current == null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined
        setPainted(latest.current)
      })
    }
  }, [content, streaming, identity, painted])
  useBrowserLayoutEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [])
  // History, completion, edits and a new stream are synchronous. Only appends
  // within an existing live stream wait at most one display frame.
  return !streaming || painted.identity !== identity || !content.startsWith(painted.content)
    ? content : painted.content
}
