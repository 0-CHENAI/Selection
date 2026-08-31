/**
 * HeaderIconButton
 *
 * Unified icon button for panel headers (Navigator and Detail panels).
 * Provides consistent styling for all header action buttons.
 */

import * as React from 'react'
import { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { mergeRefs } from '@/lib/merge-refs'
import {
  placeViewportTooltip,
  shouldShowHeaderTooltipOnFocus,
} from './header-icon-tooltip'

interface HeaderIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon as React element - caller controls size/styling */
  icon: React.ReactNode
  /** Optional tooltip text */
  tooltip?: string
}

export const HeaderIconButton = forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
  (
    {
      icon,
      tooltip,
      className,
      onBlur,
      onFocus,
      onMouseDown,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref,
  ) => {
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const tooltipId = useId()
    const [open, setOpen] = useState(false)
    const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

    const updatePosition = useCallback(() => {
      const el = buttonRef.current
      if (!el) return
      setCoords(placeViewportTooltip(el.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }))
    }, [])

    const show = useCallback(() => {
      if (!tooltip) return
      updatePosition()
      setOpen(true)
    }, [tooltip, updatePosition])

    const hide = useCallback(() => {
      setOpen(false)
    }, [])

    useLayoutEffect(() => {
      if (!open || !tooltip) return
      updatePosition()
      const onReposition = () => updatePosition()
      window.addEventListener('resize', onReposition)
      window.addEventListener('scroll', onReposition, true)
      return () => {
        window.removeEventListener('resize', onReposition)
        window.removeEventListener('scroll', onReposition, true)
      }
    }, [open, tooltip, updatePosition])

    const button = (
      <button
        ref={mergeRefs(buttonRef, ref)}
        type="button"
        aria-describedby={open && tooltip ? tooltipId : undefined}
        className={cn(
          "header-icon-btn inline-flex items-center justify-center",
          "h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag",
          "text-muted-foreground hover:text-foreground hover:bg-foreground/3",
          "data-[state=open]:text-foreground data-[state=open]:bg-foreground/3",
          "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
        onMouseEnter={(event) => {
          onMouseEnter?.(event)
          show()
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event)
          hide()
        }}
        onFocus={(event) => {
          onFocus?.(event)
          if (shouldShowHeaderTooltipOnFocus(event.currentTarget)) show()
        }}
        onBlur={(event) => {
          onBlur?.(event)
          hide()
        }}
        onMouseDown={(event) => {
          hide()
          onMouseDown?.(event)
        }}
      >
        {icon}
      </button>
    )

    if (!tooltip) {
      return button
    }

    return (
      <>
        {button}
        {open && coords && typeof document !== 'undefined' && createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            data-testid="header-icon-tooltip"
            className={cn(
              "z-tooltip pointer-events-none fixed -translate-x-1/2 whitespace-nowrap",
              "overflow-hidden rounded-[8px] px-2.5 py-1.5 text-xs",
              "dark bg-background/80 backdrop-blur-xl backdrop-saturate-150 border border-border/50 text-foreground shadow-modal-small",
              "animate-in fade-in-0 duration-100",
            )}
            style={{ left: coords.left, top: coords.top }}
          >
            {tooltip}
          </span>,
          document.body,
        )}
      </>
    )
  }
)
HeaderIconButton.displayName = 'HeaderIconButton'
