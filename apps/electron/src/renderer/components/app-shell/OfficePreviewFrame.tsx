import { forwardRef, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, MoveDiagonal } from 'lucide-react'
import { OFFICE_PANEL_RESIZE_EVENT } from '@/lib/office-panel-resize'

const RESIZE_SETTLE_MS = 160

type Layer = { id: number; doc: string }
export type OfficePreviewFrameProps = ComponentPropsWithoutRef<'iframe'>

/** Keep the document viewport stable while its outer panel is being resized. */
export const OfficePreviewFrame = forwardRef<HTMLIFrameElement, OfficePreviewFrameProps>(function OfficePreviewFrame(props, forwardedRef) {
  const { t } = useTranslation()
  const { srcDoc, onLoad, style, ...frameProps } = props
  const viewportRef = useRef<HTMLDivElement>(null)
  const revealed = useRef(new Set<number>())
  const newest = useRef(srcDoc ? 1 : 0)
  const [layers, setLayers] = useState<Layer[]>(() => srcDoc ? [{ id: 1, doc: srcDoc }] : [])
  const [visibleId, setVisibleId] = useState<number | null>(() => srcDoc ? 1 : null)
  const visibleRef = useRef(visibleId)
  visibleRef.current = visibleId

  useLayoutEffect(() => {
    if (!srcDoc) return
    setLayers(current => {
      if (current.some(layer => layer.doc === srcDoc)) return current
      const id = current.reduce((max, layer) => Math.max(max, layer.id), 0) + 1
      newest.current = id
      const shown = current.filter(item => item.id === visibleRef.current)
      return [...shown, { id, doc: srcDoc }]
    })
  }, [srcDoc])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const frontFrame = viewport.querySelector<HTMLIFrameElement>('[data-office-preview-layer="front"]')
    if (!frontFrame?.style.width) return
    for (const frame of Array.from(viewport.querySelectorAll<HTMLIFrameElement>('[data-office-preview-layer="back"]'))) {
      frame.style.width = frontFrame.style.width
      frame.style.height = frontFrame.style.height
    }
  }, [layers])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let rendered: { width: number; height: number } | undefined
    let pending: { width: number; height: number } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let nativeResizing = false
    const panel = viewport.closest<HTMLElement>('[data-office-panel]')
    let panelResizing = panel?.dataset.officePanelResizing === 'true'
    const frames = () => Array.from(viewport.querySelectorAll('iframe'))
    const endResize = () => {
      for (const frame of frames()) frame.style.visibility = ''
      viewport.style.pointerEvents = ''
      delete viewport.dataset.officeResizing
    }
    const paint = (width: number, height: number) => {
      for (const frame of frames()) {
        frame.style.width = `${width}px`
        frame.style.height = `${height}px`
      }
    }
    const commit = () => {
      timer = undefined
      if (!pending || nativeResizing || panelResizing) return
      rendered = pending
      paint(rendered.width, rendered.height)
      endResize()
    }
    const beginResize = () => {
      if (!pending) return
      clearTimeout(timer)
      for (const frame of frames()) frame.style.visibility = 'hidden'
      viewport.style.pointerEvents = 'none'
      viewport.dataset.officeResizing = 'true'
      // A quiet pointer is not a released pointer. Native gestures finish only
      // on Electron's resized event; debounce is for web/container-only changes.
      if (!nativeResizing && !panelResizing) timer = setTimeout(commit, RESIZE_SETTLE_MS)
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) {
        // Cached sessions can be display:none. Never resize their document to
        // zero or leave a delayed commit running after they become hidden.
        clearTimeout(timer)
        pending = undefined
        endResize()
        return
      }
      if (pending?.width === width && pending.height === height) return
      clearTimeout(timer)
      pending = { width, height }
      if (nativeResizing || panelResizing) {
        // A newly mounted preview also needs a fixed viewport during the hold.
        if (!rendered) {
          rendered = pending
          paint(width, height)
        }
        beginResize()
        return
      }
      if (!rendered || (!viewport.dataset.officeResizing && rendered.width === width && rendered.height === height)) {
        commit()
        return
      }
      // Keep the mounted document at its previous size and skip painting it.
      // Only the lightweight placeholder follows the panel while dragging.
      beginResize()
    })
    observer.observe(viewport)
    // Native window resizing can leave the preview width unchanged at its
    // minimum. Still show the placeholder until the whole window settles.
    window.addEventListener('resize', beginResize, { passive: true })
    const onPanelResize = () => {
      panelResizing = panel?.dataset.officePanelResizing === 'true'
      beginResize()
    }
    panel?.addEventListener(OFFICE_PANEL_RESIZE_EVENT, onPanelResize)
    const unsubscribe = window.electronAPI?.onWindowResizeStateChange?.(resizing => {
      nativeResizing = resizing
      if (resizing) beginResize()
      // Allow the final layout/ResizeObserver update to arrive before restoring.
      else if (viewport.dataset.officeResizing) beginResize()
    })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', beginResize)
      panel?.removeEventListener(OFFICE_PANEL_RESIZE_EVENT, onPanelResize)
      unsubscribe?.()
      clearTimeout(timer)
      endResize()
    }
  }, [])

  const assignFront = (element: HTMLIFrameElement | null) => {
    if (typeof forwardedRef === 'function') forwardedRef(element)
    else if (forwardedRef) forwardedRef.current = element
  }
  const reveal = (layer: Layer, frame: HTMLIFrameElement) => {
    if (revealed.current.has(layer.id) || layer.id !== newest.current) return
    revealed.current.add(layer.id)
    const frontFrame = viewportRef.current?.querySelector<HTMLIFrameElement>('[data-office-preview-layer="front"]')
    if (frontFrame?.style.width) {
      frame.style.width = frontFrame.style.width
      frame.style.height = frontFrame.style.height
    }
    // Keep the loaded document where it is. Moving an iframe in the DOM reloads it
    // and flashes white. Scroll restoration runs on DOMContentLoaded; paint after it.
    requestAnimationFrame(() => {
      if (!frame.isConnected || newest.current !== layer.id) return
      setVisibleId(layer.id)
      setLayers(current => current.some(item => item.id === layer.id) ? current.filter(item => item.id === layer.id) : current)
    })
  }

  return <div ref={viewportRef} data-office-preview-viewport className="peer/office-viewport group/office-viewport relative min-h-0 w-full flex-1 overflow-hidden bg-background">
    {layers.map(layer => {
      const front = layer.id === visibleId
      return <iframe {...frameProps} key={layer.id} ref={front ? assignFront : undefined} srcDoc={layer.doc}
        data-office-preview-layer={front ? 'front' : 'back'} aria-hidden={front ? undefined : true}
        style={{ ...style, ...(front ? {} : { pointerEvents: 'none' }) }}
        onLoad={event => { if (!front) reveal(layer, event.currentTarget); onLoad?.(event) }}
        className={front
          ? 'absolute left-0 top-0 z-[1] h-full w-full border-0 bg-background'
          : 'pointer-events-none absolute left-0 top-0 z-0 h-full w-full border-0 bg-background opacity-0'} />
    })}
    <div role="status" data-office-resize-placeholder className="pointer-events-none absolute inset-0 z-[2] hidden items-center justify-center bg-foreground/[0.02] px-6 pb-12 text-center group-data-[office-resizing=true]/office-viewport:flex">
      <div className="flex max-w-64 flex-col items-center">
        <div aria-hidden="true" className="relative mb-5 h-12 w-12 shrink-0 text-muted-foreground/60">
          <FileText size={40} strokeWidth={1.5} className="absolute left-0 top-0" />
          <span className="absolute bottom-0 right-0 rounded bg-background">
            <span className="flex bg-foreground/[0.02]">
              <MoveDiagonal size={20} strokeWidth={1.5} />
            </span>
          </span>
        </div>
        <p className="text-sm font-medium text-foreground/70">{t('chat.officePreview.resizingTitle')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('chat.officePreview.resizePaused')}</p>
      </div>
    </div>
  </div>
})
