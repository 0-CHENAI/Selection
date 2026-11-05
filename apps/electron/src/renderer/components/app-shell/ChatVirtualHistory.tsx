import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Turn } from '@craft-agent/ui'

export interface ChatVirtualHistoryHandle {
  scrollToTurn: (index: number) => void
  scrollToLatest: () => void
  cancelScroll: () => void
}

interface Props {
  turns: Turn[]
  /** Current request must mount even before the estimated window catches up. */
  activeTurnStartIndex?: number
  viewportRef: React.RefObject<HTMLDivElement>
  getTurnKey: (turn: Turn, index: number) => string
  onWindowChange: (start: number, end: number) => void
  children: (turn: Turn, index: number) => React.ReactNode
}

/**
 * Streaming growth resizes the virtual list every token. That does not move
 * the list inside the scrollport, and measuring it forces layout of the live row.
 */
export function shouldMeasureVirtualScrollMargin(
  entries: ReadonlyArray<{ target: unknown }>,
  list: unknown,
): boolean {
  return entries.some(entry => entry.target !== list)
}

/**
 * Standalone tail status covers the gap after send, before an assistant card
 * exists. Do not key this on the virtual window: retained rows can sit on
 * screen while start/end still exclude them, which toggles height and makes
 * sticky follow oscillate. Once a processing turn exists, the in-card status
 * is the only running timer.
 */
export function shouldShowTailProcessingIndicator(processingTurnIndex: number): boolean {
  return processingTurnIndex === -1
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
  turns, activeTurnStartIndex, viewportRef, getTurnKey, onWindowChange, children,
}, ref) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const retainedKeys = React.useRef(new Set<string>())
  const estimateCache = React.useRef(new WeakMap<Turn, number>())
  const [initialWidth] = React.useState(() => viewportRef.current?.clientWidth || 680)
  const [scrollMargin, setScrollMargin] = React.useState(0)
  const estimates = React.useMemo(() => turns.map(turn => {
    const cached = estimateCache.current.get(turn)
    if (cached != null) return cached
    const height = estimateChatTurnHeight(turn, initialWidth)
    estimateCache.current.set(turn, height)
    return height
  }), [turns, initialWidth])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: turns.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: index => getTurnKey(turns[index]!, index),
    estimateSize: index => estimates[index]!,
    initialRect: { width: initialWidth, height: viewportRef.current?.clientHeight || 600 },
    initialOffset: () => Math.max(0, estimates.reduce((sum, height) => sum + height, 0) - (viewportRef.current?.clientHeight || 600)),
    scrollMargin,
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
  // Reconcile the tail once, on mount. The list is keyed by session, so a
  // conversation switch remounts. Repeating this whenever the virtualizer
  // identity changes snaps the viewport on send.
  const didMountScrollRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (didMountScrollRef.current) return
    didMountScrollRef.current = true
    virtualizer.scrollToEnd({ behavior: 'auto' })
  }, [virtualizer])

  React.useLayoutEffect(() => {
    const list = listRef.current, viewport = viewportRef.current
    if (!list || !viewport) return
    const measure = () => {
      const margin = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      setScrollMargin(previous => Math.abs(previous - margin) < 1 ? previous : margin)
    }
    measure()
    const observer = new ResizeObserver(entries => {
      if (!shouldMeasureVirtualScrollMargin(entries, list)) return
      measure()
    })
    const watchAbove = () => {
      const above = list.previousElementSibling
      if (above) observer.observe(above)
    }
    watchAbove()
    observer.observe(viewport)
    // A sibling can appear after mount (handover). Child-list changes are not
    // the streaming row growing inside the list.
    const parent = list.parentElement
    const mutations = parent ? new MutationObserver(() => {
      watchAbove()
      measure()
    }) : undefined
    mutations?.observe(parent!, { childList: true })
    return () => {
      observer.disconnect()
      mutations?.disconnect()
    }
  }, [viewportRef])

  // Each mounted row already reports wrapping changes through measureElement's
  // ResizeObserver. Clearing the entire cache on every width change throws away
  // those measurements, changes the visible range and remounts expensive cards.
  // Unvisited rows keep their estimates until they enter the viewport.

  React.useImperativeHandle(ref, () => ({
    scrollToTurn: index => virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' }),
    scrollToLatest: () => virtualizer.scrollToEnd({ behavior: 'auto' }),
    cancelScroll: () => virtualizer.cancelScroll(),
  }), [virtualizer])
  const rows = virtualizer.getVirtualItems()
  for (const row of rows) retainedKeys.current.add(String(row.key))
  // The running status moves inside the assistant card as soon as its data
  // arrives. Mount the whole current request independently of the virtual
  // window, including initially empty/animated rows and tool-only turns.
  if (activeTurnStartIndex != null && activeTurnStartIndex >= 0) {
    for (let index = activeTurnStartIndex; index < turns.length; index++) {
      retainedKeys.current.add(getTurnKey(turns[index]!, index))
    }
  }
  const retainedRows = virtualizer.measurementsCache.filter(row => retainedKeys.current.has(String(row.key)))
  const start = rows[0]?.index ?? 0
  const end = rows.length ? rows[rows.length - 1]!.index + 1 : 0
  React.useLayoutEffect(() => onWindowChange(start, end), [start, end, onWindowChange])

  return (
    <div ref={listRef} data-chat-virtual-history data-chat-virtual-scrolling={virtualizer.isScrolling} className="relative min-w-0">
      <div ref={virtualizer.containerRef} className="relative w-full">
        {retainedRows.map(row => {
          const turn = turns[row.index]!
          // A live row must report its real height. content-visibility keeps the
          // estimated box, so growth paints past the viewport and the stick
          // follow never sees a taller transcript until the stream ends.
          const streaming = turn.type === 'assistant' && turn.isStreaming
          const visible = row.index >= start && row.index < end
          const active = activeTurnStartIndex != null && activeTurnStartIndex >= 0 && row.index >= activeTurnStartIndex
          // Current-request rows must measure actual content, even when an old
          // estimate places them outside the window. Otherwise follow-scroll
          // and visibility can wait on each other indefinitely.
          const layOutRow = active || (streaming && visible)
          return (
          <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
            data-chat-virtual-visible={visible}
            data-chat-virtual-streaming={streaming ? '' : undefined}
            className="absolute left-0 top-0 w-full min-w-0"
            style={{
              // directDomUpdates positions window rows only on commit. Newly
              // pinned rows also need their position on their very first paint.
              transform: `translate3d(0, ${row.start - scrollMargin}px, 0)`,
              ...(layOutRow ? {} : { contentVisibility: 'auto', containIntrinsicSize: `auto ${row.size}px` }),
            }}>
            {children(turn, row.index)}
          </div>
          )
        })}
      </div>
    </div>
  )
})
