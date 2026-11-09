import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * One process-chain row is a 13px line plus py-0.5 and the WorkChainRow
 * py-px wrapper. Slightly taller than SIZE_CONFIG.activityRowHeight so the
 * spacer overestimates instead of collapsing the card while scrolling.
 */
export const PROCESS_CHAIN_ROW_PX = 26
export const PROCESS_CHAIN_OVERSCAN = 12
export const PROCESS_CHAIN_WINDOW_THRESHOLD = 20
export const PROCESS_CHAIN_EXPAND_MS = 250

export type ProcessChainWindow = {
  start: number
  end: number
  padTop: number
  padBottom: number
  count: number
}

export function shouldWindowProcessChain(count: number, uniform: boolean): boolean {
  return uniform && count > PROCESS_CHAIN_WINDOW_THRESHOLD
}

export function clampProcessChainIndex(value: number, max: number): number {
  if (value < 0) return 0
  if (value > max) return max
  return value
}

export function processChainWindowFromRange(
  start: number,
  end: number,
  count: number,
  rowHeight = PROCESS_CHAIN_ROW_PX,
): ProcessChainWindow {
  const safeStart = clampProcessChainIndex(start, count)
  const safeEnd = clampProcessChainIndex(Math.max(end, safeStart), count)
  return {
    start: safeStart,
    end: safeEnd,
    padTop: safeStart * rowHeight,
    padBottom: (count - safeEnd) * rowHeight,
    count,
  }
}

/** First paint / SSR: keep a short top slice instead of mounting every row. */
export function initialProcessChainWindow(
  count: number,
  rowHeight = PROCESS_CHAIN_ROW_PX,
): ProcessChainWindow | null {
  if (count <= PROCESS_CHAIN_WINDOW_THRESHOLD) return null
  const span = PROCESS_CHAIN_WINDOW_THRESHOLD + PROCESS_CHAIN_OVERSCAN
  return processChainWindowFromRange(0, Math.min(count, span), count, rowHeight)
}

export function processChainWindow(args: {
  containerTop: number
  viewportHeight: number
  count: number
  rowHeight?: number
  overscan?: number
}): ProcessChainWindow {
  const rowHeight = args.rowHeight ?? PROCESS_CHAIN_ROW_PX
  const overscan = args.overscan ?? PROCESS_CHAIN_OVERSCAN
  if (args.count <= 0) return processChainWindowFromRange(0, 0, 0, rowHeight)
  const firstVisible = Math.floor(-args.containerTop / rowHeight)
  const visibleCount = Math.max(1, Math.ceil(args.viewportHeight / rowHeight))
  return processChainWindowFromRange(
    firstVisible - overscan,
    firstVisible + visibleCount + overscan,
    args.count,
    rowHeight,
  )
}

/**
 * Live rows append at the tail. If the last window already showed the end,
 * stay pinned there so stick-to-bottom does not wait for a scroll event.
 */
export function reconcileProcessChainWindow(
  previous: ProcessChainWindow | null,
  count: number,
  rowHeight = PROCESS_CHAIN_ROW_PX,
): ProcessChainWindow | null {
  if (count <= PROCESS_CHAIN_WINDOW_THRESHOLD) return null
  if (!previous) return initialProcessChainWindow(count, rowHeight)
  const pinnedToEnd = previous.end >= previous.count
  if (pinnedToEnd) {
    const span = Math.max(previous.end - previous.start, PROCESS_CHAIN_WINDOW_THRESHOLD)
    return processChainWindowFromRange(count - span, count, count, rowHeight)
  }
  return processChainWindowFromRange(previous.start, previous.end, count, rowHeight)
}

export function sameProcessChainWindow(
  left: ProcessChainWindow | null,
  right: ProcessChainWindow | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.start === right.start
    && left.end === right.end
    && left.padTop === right.padTop
    && left.padBottom === right.padBottom
    && left.count === right.count
}

export function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current) {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(current) : undefined
    const overflowY = style?.overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return current
    current = current.parentElement
  }
  return typeof document === 'undefined' ? null : document.documentElement
}

function readViewport(scrollParent: HTMLElement): { top: number; height: number } {
  if (scrollParent === document.documentElement || scrollParent === document.body) {
    return { top: 0, height: window.innerHeight || 0 }
  }
  const rect = scrollParent.getBoundingClientRect?.()
  return { top: rect?.top ?? 0, height: rect?.height ?? 0 }
}

export function measureProcessChainWindow(
  container: HTMLElement,
  scrollParent: HTMLElement,
  count: number,
  rowHeight = PROCESS_CHAIN_ROW_PX,
): ProcessChainWindow {
  const containerRect = container.getBoundingClientRect?.()
  const viewport = readViewport(scrollParent)
  if (!containerRect) return initialProcessChainWindow(count, rowHeight) ?? processChainWindowFromRange(0, count, count, rowHeight)
  return processChainWindow({
    containerTop: containerRect.top - viewport.top,
    viewportHeight: viewport.height,
    count,
    rowHeight,
  })
}

export function useProcessChainWindow(
  containerRef: { readonly current: HTMLElement | null },
  count: number,
  enabled: boolean,
): ProcessChainWindow | null {
  const [windowState, setWindowState] = useState<ProcessChainWindow | null>(
    () => enabled ? initialProcessChainWindow(count) : null,
  )

  const enabledRef = useRef(enabled)
  const countRef = useRef(count)
  if (enabled !== enabledRef.current || count !== countRef.current) {
    enabledRef.current = enabled
    countRef.current = count
    const next = enabled ? reconcileProcessChainWindow(windowState, count) : null
    if (!sameProcessChainWindow(windowState, next)) setWindowState(next)
  }

  useIsoLayoutEffect(() => {
    if (!enabled) {
      setWindowState(null)
      return
    }
    const container = containerRef.current
    if (!container || typeof container.getBoundingClientRect !== 'function') {
      setWindowState(current => {
        const next = reconcileProcessChainWindow(current, count)
        return sameProcessChainWindow(current, next) ? current : next
      })
      return
    }
    const scrollParent = findScrollParent(container)
    if (!scrollParent || typeof scrollParent.addEventListener !== 'function') {
      setWindowState(current => {
        const next = reconcileProcessChainWindow(current, count)
        return sameProcessChainWindow(current, next) ? current : next
      })
      return
    }

    let frame = 0
    const apply = () => {
      const next = measureProcessChainWindow(container, scrollParent, count)
      setWindowState(current => sameProcessChainWindow(current, next) ? current : next)
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        apply()
      })
    }

    apply()
    scrollParent.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // Expansion and layout changes can resize the viewport without a scroll
    // event. Reconcile the slice, not scrollTop: manual reading stays put.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll)
    observer?.observe(container)
    observer?.observe(scrollParent)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      scrollParent.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [containerRef, count, enabled])

  return enabled ? (windowState ?? initialProcessChainWindow(count)) : null
}
