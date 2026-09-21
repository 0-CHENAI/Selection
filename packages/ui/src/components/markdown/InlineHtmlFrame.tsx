import * as React from 'react'

const previewViewportHeight = () => Math.min(400, window.innerHeight * 0.5)

/** Size short documents naturally; leave long documents clipped by the outer preview. */
export function InlineHtmlFrame({ html, title, active }: { html: string; title: string; active: boolean }) {
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const cleanupRef = React.useRef<(() => void) | undefined>(undefined)
  const loadedRef = React.useRef(false)
  const [height, setHeight] = React.useState(() => typeof window === 'undefined' ? 400 : previewViewportHeight())

  const observeDocument = React.useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = undefined
    if (!loadedRef.current) return
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!frame || !doc?.body || !active) return
    let animationFrame = 0
    const measure = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        if (!frame.clientWidth) return
        const body = doc.body
        const style = frame.contentWindow!.getComputedStyle(body)
        // Unlike documentElement.scrollHeight, this can shrink below the previous frame height.
        const contentHeight = Math.max(body.scrollHeight, body.getBoundingClientRect().height)
          + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
        // Bound the frame itself too: 100vh/percentage-height documents must not
        // create an unbounded iframe → document → iframe resize feedback loop.
        // Two extra pixels let the outer preview detect actual clipping.
        const limit = Math.min(400, window.innerHeight * 0.5)
        setHeight(Math.max(1, Math.min(Math.ceil(contentHeight), limit + 2)))
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(doc.body)
    observer.observe(doc.documentElement)
    doc.addEventListener('load', measure, true)
    const resize = () => { setHeight(previewViewportHeight()); measure() }
    window.addEventListener('resize', resize)
    measure()
    cleanupRef.current = () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      doc.removeEventListener('load', measure, true)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  React.useLayoutEffect(() => {
    loadedRef.current = false
    setHeight(previewViewportHeight())
    cleanupRef.current?.()
  }, [html])

  React.useLayoutEffect(() => {
    observeDocument()
    return () => cleanupRef.current?.()
  }, [observeDocument, html])

  return (
    <iframe
      ref={frameRef}
      sandbox="allow-same-origin allow-top-navigation-by-user-activation"
      srcDoc={html}
      title={title}
      className="w-full border-0 bg-white"
      scrolling="no"
      onLoad={() => { loadedRef.current = true; observeDocument() }}
      style={{ height, display: active ? 'block' : 'none' }}
    />
  )
}
