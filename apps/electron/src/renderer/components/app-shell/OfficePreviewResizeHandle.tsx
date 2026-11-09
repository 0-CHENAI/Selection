import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { OFFICE_PANEL_RESIZE_EVENT, officePanelWidthBasis } from '@/lib/office-panel-resize'
import { officeLeadingWidthPx, officePanelLimits } from '@/lib/office-panel-width'
import { PanelResizeHandle } from './PanelResizeHandle'
import { PANEL_GAP, PANEL_SASH_HALF_HIT_WIDTH, PANEL_SASH_HIT_WIDTH } from './panel-constants'

/** Resize only the panel's CSS width; the document stays frozen until release. */
export function OfficePreviewResizeHandle() {
  const { t } = useTranslation()
  const handleRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const handle = handleRef.current
    // The parent's React ref is not attached yet during child layout effects.
    const panel = handle?.closest<HTMLElement>('[data-office-panel]')
    if (!panel || !handle) return

    let drag: { pointerId: number; x: number; width: number; total: number } | undefined
    let nextX = 0
    let animationFrame = 0
    let previousCursor = ''
    let previousSelection = ''
    const limits = (total: number) => officePanelLimits(total, officeLeadingWidthPx(panel))
    const announce = (width: number, total: number) => {
      const { min, max } = limits(total)
      handle.setAttribute('aria-valuemin', String(Math.round(min)))
      handle.setAttribute('aria-valuemax', String(Math.round(max)))
      handle.setAttribute('aria-valuenow', String(Math.round(width)))
    }
    const applyWidth = (width: number, total: number) => {
      if (total <= 0) return
      const { min, max } = limits(total)
      const clamped = Math.min(max, Math.max(min, width))
      panel.style.setProperty('--office-panel-preferred-width', `${100 * clamped / total}cqw`)
      announce(clamped, total)
    }
    const signal = (resizing: boolean) => {
      if (resizing) panel.dataset.officePanelResizing = 'true'
      else delete panel.dataset.officePanelResizing
      panel.dispatchEvent(new Event(OFFICE_PANEL_RESIZE_EVENT))
    }
    const flush = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = 0
      if (drag) applyWidth(drag.width + drag.x - nextX, drag.total)
    }
    const end = () => {
      if (!drag) return
      flush()
      const { pointerId } = drag
      drag = undefined
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelection
      signal(false)
    }
    const basis = () => officePanelWidthBasis(panel)
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || drag) return
      event.preventDefault()
      // Pointer gestures must not leave the keyboard focus indicator behind.
      // Tab navigation still focuses the separator for keyboard resizing.
      handle.blur()
      const target = basis()
      if (!target) return
      const total = target.getBoundingClientRect().width
      if (total <= 0) return
      handle.setPointerCapture(event.pointerId)
      drag = { pointerId: event.pointerId, x: event.clientX, width: panel.getBoundingClientRect().width, total }
      nextX = event.clientX
      previousCursor = document.body.style.cursor
      previousSelection = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      signal(true)
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      nextX = event.clientX
      if (!animationFrame) animationFrame = requestAnimationFrame(flush)
    }
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (event.type === 'pointerup') nextX = event.clientX
      end()
    }
    const focus = () => {
      const target = basis()
      if (target) announce(panel.getBoundingClientRect().width, target.getBoundingClientRect().width)
    }
    const reset = () => {
      end()
      panel.style.removeProperty('--office-panel-preferred-width')
      focus()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { end(); return }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Enter') { reset(); return }
      const target = basis()
      if (!target) return
      const total = target.getBoundingClientRect().width
      const { min, max } = limits(total)
      const width = panel.getBoundingClientRect().width
      const step = event.shiftKey ? 64 : 32
      applyWidth(event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? step : -step), total)
    }
    const seam = (event: PointerEvent) => {
      if (panel.dataset.officePanel !== 'open' || getComputedStyle(panel).pointerEvents === 'none') return false
      const rect = panel.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      return event.clientX >= rect.left - PANEL_SASH_HALF_HIT_WIDTH
        && event.clientX <= rect.left + PANEL_SASH_HIT_WIDTH
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    }
    focus()
    // Capture on the window so a loading card, or the chat column overlapping
    // the seam, cannot swallow the drag. The hit target itself stays the sash.
    const pointerDown = (event: PointerEvent) => { if (seam(event)) down(event) }
    handle.addEventListener('pointerdown', down)
    window.addEventListener('pointerdown', pointerDown, true)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    handle.addEventListener('lostpointercapture', end)
    handle.addEventListener('keydown', key)
    handle.addEventListener('dblclick', reset)
    handle.addEventListener('focus', focus)
    window.addEventListener('blur', end)
    return () => {
      end()
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.removeEventListener('lostpointercapture', end)
      handle.removeEventListener('keydown', key)
      handle.removeEventListener('dblclick', reset)
      handle.removeEventListener('focus', focus)
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('blur', end)
    }
  }, [])

  return <PanelResizeHandle ref={handleRef} role="separator" tabIndex={0}
    data-office-resize-handle aria-orientation="vertical" aria-label={t('chat.officePreview.resizeWidth')}
    className="z-[80] [-webkit-app-region:no-drag] focus-visible:after:absolute focus-visible:after:inset-y-2 focus-visible:after:w-0.5 focus-visible:after:bg-accent"
    style={{ position: 'absolute', left: PANEL_GAP / 2, top: 0, margin: 0 }} />
}
