import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function hasHorizontalOverflow(
  metrics: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>,
): boolean {
  return metrics.scrollWidth > metrics.clientWidth
}

export function buildFadeMask(fadeWidth: number, trailingGap: number): string {
  if (trailingGap <= 0) {
    return `linear-gradient(to right, black calc(100% - ${fadeWidth}px), transparent)`
  }

  return `linear-gradient(to right, black 0, black calc(100% - ${fadeWidth + trailingGap}px), transparent calc(100% - ${trailingGap}px), transparent 100%)`
}

interface FadingTextProps {
  children: ReactNode
  className?: string
  /** Width of the fade gradient in pixels (default: 24) */
  fadeWidth?: number
  /** Transparent space kept after the fade, in pixels. */
  trailingGap?: number
  /** Native tooltip shown only when the content is clipped. */
  overflowTitle?: string
}

/**
 * FadingText - Text that fades with gradient only when overflowing
 *
 * Uses CSS mask-image to create a gradient fade effect on the right edge
 * when the text content overflows its container. Only applies the mask
 * when overflow is detected.
 *
 * @example
 * <FadingText>Long text that might overflow</FadingText>
 * <FadingText fadeWidth={36}>Custom fade width</FadingText>
 */
export function FadingText({
  children,
  className,
  fadeWidth = 24,
  trailingGap = 0,
  overflowTitle,
}: FadingTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    setIsOverflowing(hasHorizontalOverflow(element))
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)

    let active = true
    void document.fonts?.ready.then(() => {
      if (active) measure()
    })

    return () => {
      active = false
      observer.disconnect()
    }
  }, [children, measure])

  const maskImage = buildFadeMask(fadeWidth, trailingGap)

  return (
    <span
      ref={ref}
      className={cn('overflow-hidden whitespace-nowrap min-w-0', className)}
      data-overflowing={isOverflowing ? 'true' : undefined}
      title={isOverflowing ? overflowTitle : undefined}
      style={isOverflowing ? {
        maskImage,
        WebkitMaskImage: maskImage,
      } : undefined}
    >
      {children}
    </span>
  )
}
