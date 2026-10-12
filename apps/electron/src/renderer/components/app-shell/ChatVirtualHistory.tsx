import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Turn } from '@craft-agent/ui'

export interface ChatVirtualHistoryHandle {
  scrollToTurn: (index: number) => void
  scrollToLatest: () => void
}

interface Props {
  turns: Turn[]
  viewportRef: React.RefObject<HTMLDivElement>
  getTurnKey: (turn: Turn, index: number) => string
  onWindowChange: (start: number, end: number) => void
  children: (turn: Turn, index: number) => React.ReactNode
}

/** Estimates only seed the scrollbar; ResizeObserver caches actual row heights. */
export function estimateChatTurnHeight(turn: Turn, width: number): number {
  const text = turn.type === 'assistant' ? turn.response?.text ?? '' : turn.message.content
  const columns = Math.max(16, Math.floor((width - 64) / 10))
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0)
  const activities = turn.type === 'assistant' && turn.activities.length > 0 ? 40 : 0
  return Math.max(72, lines * 20 + 48 + activities)
}

/** Load viewport neighbours once; release visited rows only on session unmount. */
export const ChatVirtualHistory = React.forwardRef<ChatVirtualHistoryHandle, Props>(function ChatVirtualHistory({
  turns, viewportRef, getTurnKey, onWindowChange, children,
}, ref) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const retainedKeys = React.useRef(new Set<string>())
  const [geometry, setGeometry] = React.useState({ width: 680, margin: 0 })
  const estimates = React.useMemo(() => turns.map(turn => estimateChatTurnHeight(turn, geometry.width)), [turns, geometry.width])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: turns.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: index => getTurnKey(turns[index]!, index),
    estimateSize: index => estimates[index]!,
    initialRect: { width: geometry.width, height: viewportRef.current?.clientHeight || 600 },
    initialOffset: () => Math.max(0, estimates.reduce((sum, height) => sum + height, 0) - (viewportRef.current?.clientHeight || 600)),
    scrollMargin: geometry.margin,
    overscan: 1,
    // Let React batch scroll work instead of synchronously committing long cards.
    useFlushSync: false,
    directDomUpdates: true,
    useAnimationFrameWithResizeObserver: true,
    onChange: instance => {
      // Retained offscreen rows also move when an earlier estimate is corrected.
      // Only write styles here; asking their children for geometry would wake
      // content-visibility and defeat the offscreen layout saving.
      instance.getVirtualItems()
      for (const item of instance.measurementsCache) {
        const node = instance.elementsCache.get(item.key)
        if (!node) continue
        const transform = `translate3d(0, ${item.start - instance.options.scrollMargin}px, 0)`
        if (node.style.transform !== transform) node.style.transform = transform
      }
    },
  })
  // Reconcile the tail as estimated heights become measured on first mount.
  // This also resets a reused scroll viewport when switching conversations.
  React.useLayoutEffect(() => {
    virtualizer.scrollToEnd({ behavior: 'auto' })
  }, [virtualizer])

  React.useLayoutEffect(() => {
    const list = listRef.current, viewport = viewportRef.current
    if (!list || !viewport) return
    const measure = () => {
      const width = list.clientWidth
      const margin = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      setGeometry(previous => previous.width === width && Math.abs(previous.margin - margin) < 1 ? previous : { width, margin })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef])

  // A panel width change invalidates wrapping heights, but ordinary scrolling
  // retains the measured cache and all previously visited rows.
  const previousWidth = React.useRef(geometry.width)
  React.useLayoutEffect(() => {
    if (previousWidth.current === geometry.width) return
    previousWidth.current = geometry.width
    virtualizer.measure()
  }, [geometry.width, virtualizer])

  React.useImperativeHandle(ref, () => ({
    scrollToTurn: index => virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' }),
    scrollToLatest: () => virtualizer.scrollToEnd({ behavior: 'auto' }),
  }), [virtualizer])
  const rows = virtualizer.getVirtualItems()
  for (const row of rows) retainedKeys.current.add(String(row.key))
  const retainedRows = virtualizer.measurementsCache.filter(row => retainedKeys.current.has(String(row.key)))
  const start = rows[0]?.index ?? 0
  const end = rows.length ? rows[rows.length - 1]!.index + 1 : 0
  React.useLayoutEffect(() => onWindowChange(start, end), [start, end, onWindowChange])

  return (
    <div ref={listRef} data-chat-virtual-history data-chat-virtual-scrolling={virtualizer.isScrolling} className="relative min-w-0">
      <div ref={virtualizer.containerRef} className="relative w-full">
        {retainedRows.map(row => (
          <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
            data-chat-virtual-visible={row.index >= start && row.index < end}
            className="absolute left-0 top-0 w-full min-w-0"
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${row.size}px` }}>
            {children(turns[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  )
})
