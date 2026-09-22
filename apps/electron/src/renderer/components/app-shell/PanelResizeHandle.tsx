import * as React from 'react'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import { PANEL_GAP, PANEL_SASH_FLEX_MARGIN, PANEL_SASH_HALF_HIT_WIDTH, PANEL_SASH_LINE_WIDTH, PANEL_STACK_VERTICAL_OVERFLOW } from './panel-constants'

/** Shared panel seam: identical hit area, cursor-following gradient and spacing. */
export const PanelResizeHandle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { standalone?: boolean }>(
  function PanelResizeHandle({ standalone, onMouseDown, onMouseMove, onMouseLeave, style, ...props }, forwardedRef) {
    const { ref, handlers, gradientStyle } = useResizeGradient()
    return (
      <div {...props} ref={node => {
        ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
        className="relative w-0 h-full cursor-col-resize flex justify-center shrink-0 touch-none select-none focus-visible:outline-none"
        style={{ margin: `0 ${standalone ? PANEL_GAP / 2 : PANEL_SASH_FLEX_MARGIN}px`, ...style }}
        onMouseDown={event => { handlers.onMouseDown(); onMouseDown?.(event) }}
        onMouseMove={event => { handlers.onMouseMove(event); onMouseMove?.(event) }}
        onMouseLeave={event => { handlers.onMouseLeave(); onMouseLeave?.(event) }}
      >
        <div className="absolute inset-y-0 flex justify-center cursor-col-resize" style={{ left: -PANEL_SASH_HALF_HIT_WIDTH, right: -PANEL_SASH_HALF_HIT_WIDTH }}>
          <div className="absolute left-1/2 -translate-x-1/2" style={{ ...gradientStyle, width: PANEL_SASH_LINE_WIDTH, top: PANEL_STACK_VERTICAL_OVERFLOW, bottom: PANEL_STACK_VERTICAL_OVERFLOW }} />
        </div>
      </div>
    )
  },
)
