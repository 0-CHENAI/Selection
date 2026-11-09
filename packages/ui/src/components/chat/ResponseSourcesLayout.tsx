import { PANEL_SPRING } from '../../lib/panel-motion'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import * as React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WebsiteIcon } from '../markdown/WebsiteIcon'
import type { ResponseSource } from './response-sources'
import { collectSourceMetadata, sourcePlainText, sourceUrlKey, type SourceToolMessage } from './source-metadata'
import { SOURCE_PANEL_GAP_PX, isSourcesPanelShown, sourceColumnWidth } from './sources-panel'

const SourcesPanelContext = React.createContext<((sources: ResponseSource[]) => void) | null>(null)
export const useSourcesPanel = () => React.useContext(SourcesPanelContext)

/** A sibling column in the chat layout, never an overlay over the conversation. */
export function ResponseSourcesLayout({ children, messages, onOpenUrl, renderHeader, suspended = false, resizeHandle: ResizeHandle = 'div' }: {
  children: React.ReactNode
  messages: SourceToolMessage[]
  onOpenUrl?: (url: string) => void
  resizeHandle?: React.ElementType<React.HTMLAttributes<HTMLDivElement>>
  renderHeader?: (title: string, onClose: () => void) => React.ReactNode
  /** Hide the column without clearing its sources or width. */
  suspended?: boolean
}) {
  const { t } = useTranslation()
  const [sources, setSources] = React.useState<ResponseSource[] | null>(null)
  const reduceMotion = useReducedMotion()
  const [panelPresent, setPanelPresent] = React.useState(false)
  const openSources = React.useCallback((next: ResponseSource[]) => {
    setPanelPresent(true)
    setSources(next)
  }, [])
  const metadata = React.useMemo(() => collectSourceMetadata(messages), [messages])
  const headingId = React.useId()
  const layoutRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ x: number; width: number } | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(1360)
  const [widthRatio, setWidthRatio] = React.useState(0.25)
  const maxWidth = Math.min(560, containerWidth / 2)
  const minWidth = Math.min(220, maxWidth)
  const panelWidth = Math.min(maxWidth, Math.max(minWidth, containerWidth * widthRatio))
  const shown = isSourcesPanelShown(!!sources, suspended)
  const sourcesRef = React.useRef(sources)
  sourcesRef.current = sources
  const lastSourcesRef = React.useRef<ResponseSource[] | null>(null)
  if (sources) lastSourcesRef.current = sources
  const renderedSources = sources ?? lastSourcesRef.current
  const [columnMounted, setColumnMounted] = React.useState(false)
  const openFraction = useMotionValue(0)
  const pixelWidth = useMotionValue(0)
  // Pixel width is applied directly so dragging the separator does not spring.
  pixelWidth.set(sourceColumnWidth(panelWidth))
  const columnWidth = useTransform([openFraction, pixelWidth], ([fraction, pixels]) => Number(fraction) * Number(pixels))
  const resizeTo = (width: number) => setWidthRatio(Math.min(maxWidth, Math.max(minWidth, width)) / Math.max(1, containerWidth))
  React.useEffect(() => {
    const element = layoutRef.current
    if (!element || !panelPresent) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [panelPresent])
  React.useEffect(() => {
    if (!shown && !columnMounted) return
    const target = shown ? 1 : 0
    let cancelled = false
    const finishClosed = () => {
      if (cancelled || target !== 0) return
      setColumnMounted(false)
      if (!sourcesRef.current) setPanelPresent(false)
    }
    if (reduceMotion) {
      openFraction.set(target)
      finishClosed()
      return
    }
    const controls = animate(openFraction, target, { ...PANEL_SPRING, onComplete: finishClosed })
    return () => {
      cancelled = true
      controls.stop()
    }
  }, [shown, columnMounted, reduceMotion, openFraction])
  if (shown && !columnMounted) setColumnMounted(true)
  return (
    <SourcesPanelContext.Provider value={openSources}>
      <div ref={layoutRef} data-source-layout={panelPresent && !suspended ? "open" : undefined} className="flex h-full min-h-0 min-w-0 overflow-x-auto">
        <div className={panelPresent && !suspended ? "min-w-[320px] flex-1 overflow-hidden rounded-[10px] bg-foreground-2 shadow-middle" : "min-w-[320px] flex-1"}>{children}</div>
        {columnMounted && renderedSources && (
          <motion.div className="relative flex h-full min-w-0 shrink-0 overflow-hidden" style={{ width: columnWidth }}>
          {/* Out of flow so a standalone sash margin cannot widen the seam past SOURCE_PANEL_GAP_PX. */}
          <ResizeHandle role="separator" aria-label={t('chat.sourcesTitle')} aria-orientation="vertical"
            aria-valuemin={Math.round(minWidth)} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(panelWidth)} tabIndex={0}
            className="group absolute inset-y-0 z-10 cursor-col-resize touch-none select-none focus-visible:outline-none"
            style={{ position: 'absolute', left: 0, top: 0, width: SOURCE_PANEL_GAP_PX, height: '100%', margin: 0 }}
            onDoubleClick={() => setWidthRatio(0.25)}
            onPointerDown={event => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = { x: event.clientX, width: panelWidth }
            }}
            onPointerMove={event => { if (dragRef.current) resizeTo(dragRef.current.width + dragRef.current.x - event.clientX) }}
            onPointerUp={event => {
              dragRef.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => { dragRef.current = null }}
            onLostPointerCapture={() => { dragRef.current = null }}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              resizeTo(event.key === 'Home' ? minWidth : event.key === 'End' ? maxWidth : panelWidth + (event.key === 'ArrowLeft' ? 16 : -16))
            }}
          >{ResizeHandle === 'div' && <span className="absolute left-1/2 top-1/2 h-20 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}</ResizeHandle>
          <div className="relative h-full min-w-0 flex-1 overflow-hidden" style={{ marginLeft: SOURCE_PANEL_GAP_PX }}>
          <aside aria-labelledby={headingId} style={{ width: panelWidth }} className="absolute inset-y-0 right-0 flex h-full flex-col overflow-hidden rounded-[10px] bg-foreground-2 shadow-middle" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSources(null) } }}>
            {renderHeader ? <div id={headingId}>{renderHeader(t('chat.sourcesTitle') + ' (' + renderedSources.length + ')', () => setSources(null))}</div> : <div className="flex h-[42px] shrink-0 items-center justify-between px-3">
              <h2 id={headingId} className="text-sm font-semibold">{t('chat.sourcesTitle')} ({renderedSources.length})</h2>
              <button type="button" aria-label={t('common.close')} onClick={() => setSources(null)} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>}
            <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {renderedSources.map(source => {
                const detail = metadata.get(sourceUrlKey(source.url))
                return (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" onClick={event => { if (onOpenUrl) { event.preventDefault(); onOpenUrl(source.url) } }} className="block rounded-lg px-3 py-3 text-foreground no-underline transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      <span className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground"><WebsiteIcon href={source.url} /><span className="truncate">{source.hostname}</span></span>
                      <span className="mb-1.5 block truncate text-sm font-semibold" title={sourcePlainText(source.title) || detail?.title}>{detail?.title || sourcePlainText(source.title)}</span>
                      <span className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{source.description || detail?.description || t('chat.sourceSummaryUnavailable')}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
          </aside>
          </div>
          </motion.div>
        )}
      </div>
    </SourcesPanelContext.Provider>
  )
}
