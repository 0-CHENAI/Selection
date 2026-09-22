/** Convert iframe viewport coordinates to the preview's viewport after scaling. */
export function iframePoint(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
) {
  return {
    clientX: rect.left + point.clientX * rect.width / Math.max(1, size.width),
    clientY: rect.top + point.clientY * rect.height / Math.max(1, size.height),
  }
}

/** Bridge a script-disabled, same-origin document to the existing preview gestures. */
export function bindHtmlPreviewInteractions(iframe: HTMLIFrameElement, container: HTMLDivElement, didDrag: () => boolean, readingMode = false) {
  const doc = iframe.contentDocument
  if (!doc) return () => {}
  const point = (e: MouseEvent) => iframePoint(e, iframe.getBoundingClientRect(), { width: iframe.offsetWidth, height: iframe.offsetHeight })
  const interactive = (e: Event) => (e.target as Element | null)?.closest?.('a, button, input, textarea, select, [contenteditable]')
  const wheel = (e: WheelEvent) => {
    if (readingMode) {
      let scroll: HTMLElement | null = container
      while (scroll && !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
      if (scroll) {
        e.preventDefault()
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroll.clientHeight : 1
        scroll.scrollBy({ top: e.deltaY * unit, left: e.deltaX * unit })
      }
      return
    }
    e.preventDefault()
    container.dispatchEvent(new WheelEvent('wheel', {
      ...point(e), deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey, bubbles: true, cancelable: true,
    }))
  }
  const mouse = (e: MouseEvent) => {
    if (readingMode) return
    if ((e.type === 'mousedown' || e.type === 'dblclick') && interactive(e)) return
    const target = e.type === 'mousemove' || e.type === 'mouseup' ? window : container
    const accepted = target.dispatchEvent(new MouseEvent(e.type, {
      ...point(e), button: e.button, buttons: e.buttons, bubbles: true, cancelable: true,
    }))
    if (!accepted) e.preventDefault()
  }
  const click = (e: MouseEvent) => {
    if (!readingMode && didDrag() && !interactive(e)) { e.preventDefault(); e.stopPropagation() }
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && !((e.metaKey || e.ctrlKey) && ['=', '+', '-', '0'].includes(e.key))) return
    if (!document.dispatchEvent(new KeyboardEvent('keydown', {
      key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true,
    }))) e.preventDefault()
  }
  doc.addEventListener('wheel', wheel, { passive: false })
  for (const name of ['mousedown', 'mousemove', 'mouseup', 'dblclick'] as const) doc.addEventListener(name, mouse)
  doc.addEventListener('click', click, true)
  doc.addEventListener('keydown', key)
  return () => {
    doc.removeEventListener('wheel', wheel)
    for (const name of ['mousedown', 'mousemove', 'mouseup', 'dblclick'] as const) doc.removeEventListener(name, mouse)
    doc.removeEventListener('click', click, true)
    doc.removeEventListener('keydown', key)
  }
}
