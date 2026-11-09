import { useState, useEffect, type RefObject } from 'react'

/** Only publish breakpoint crossings, not every pixel of a window resize. */
export function useContainerBreakpoint(ref: RefObject<HTMLElement | null>, threshold: number): boolean {
  const [below, setBelow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Keep repeated observer notifications out of React altogether. Calling a
    // setter with the same value can still schedule a render after a change.
    let previous: boolean | undefined
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width
      const next = width > 0 && width < threshold
      if (next === previous) return
      previous = next
      setBelow(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])

  return below
}
