import { PANEL_SPRING } from '../../lib/panel-motion'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WebsiteIcon } from '../markdown/WebsiteIcon'
import type { ResponseSource } from './response-sources'
import { collectSourceMetadata, sourcePlainText, sourceUrlKey, type SourceToolMessage } from './source-metadata'

const SourcesPanelContext = React.createContext<((sources: ResponseSource[]) => void) | null>(null)
export const useSourcesPanel = () => React.useContext(SourcesPanelContext)

/** A sibling column in the chat layout, never an overlay over the conversation. */
export function ResponseSourcesLayout({ children, messages, onOpenUrl, renderHeader, resizeHandle: ResizeHandle = 'div' }: {
  children: React.ReactNode
  messages: SourceToolMessage[]
  onOpenUrl?: (url: string) => void
  resizeHandle?: React.ElementType<React.HTMLAttributes<HTMLDivElement>>
  renderHeader?: (title: string, onClose: () => void) => React.ReactNode
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
  const resizeTo = (width: number) => setWidthRatio(Math.min(maxWidth, Math.max(minWidth, width)) / Math.max(1, containerWidth))
  React.useEffect(() => {
    const element = layoutRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <SourcesPanelContext.Provider value={openSources}>
      <div ref={layoutRef} data-source-layout={panelPresent ? "open" : undefined} className="flex h-full min-h-0 min-w-0 overflow-x-auto">
        <div className={panelPresent ? "min-w-[320px] flex-1 overflow-hidden rounded-[10px] bg-foreground-2 shadow-middle" : "min-w-[320px] flex-1"}>{children}</div>
        <AnimatePresence initial={false} onExitComplete={() => { if (!sources) setPanelPresent(false) }}>
        {sources && (
          <motion.div key="reference-sources" className="flex h-full shrink-0 overflow-hidden"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelWidth + 6, opacity: 1 }}
            exit={{ width: 0, opacity: 0, transition: reduceMotion ? { duration: 0 } : PANEL_SPRING }}
            transition={reduceMotion || dragRef.current ? { duration: 0 } : PANEL_SPRING}
          >
          <ResizeHandle role="separator" aria-label={t('chat.sourcesTitle')} aria-orientation="vertical"
            aria-valuemin={Math.round(minWidth)} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(panelWidth)} tabIndex={0}
            className="group relative w-1.5 shrink-0 cursor-col-resize touch-none select-none focus-visible:outline-none"
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
          <aside aria-labelledby={headingId} style={{ width: panelWidth }} className="flex h-full shrink-0 flex-col overflow-hidden rounded-[10px] bg-foreground-2 shadow-middle" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSources(null) } }}>
            {renderHeader ? <div id={headingId}>{renderHeader(t('chat.sourcesTitle') + ' (' + sources.length + ')', () => setSources(null))}</div> : <div className="flex h-[42px] shrink-0 items-center justify-between px-3">
              <h2 id={headingId} className="text-sm font-semibold">{t('chat.sourcesTitle')} ({sources.length})</h2>
              <button type="button" aria-label={t('common.close')} onClick={() => setSources(null)} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>}
            <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {sources.map(source => {
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
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </SourcesPanelContext.Provider>
  )
}
