/**
 * Viewport placement for header-button tooltips.
 *
 * Radix Popper measures a trigger inside a transformed Popover (EditPopover
 * placement + drag translate) and then paints the portaled tooltip in
 * viewport space. The collapse label then appears on the app title bar.
 * Anchor with getBoundingClientRect instead.
 */

import { VIEWPORT_MARGIN_TOP } from './edit-popover-layout'

export type TooltipRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export type TooltipViewport = {
  width: number
  height: number
}

export type TooltipPlacement = {
  left: number
  top: number
  placement: 'below' | 'above'
}

const DEFAULT_TOOLTIP_SIZE = { width: 48, height: 28 }
const VIEWPORT_PAD = 8
const GAP = 6

export function placeViewportTooltip(
  trigger: TooltipRect,
  viewport: TooltipViewport,
  tooltipSize: { width: number; height: number } = DEFAULT_TOOLTIP_SIZE,
  gap = GAP,
): TooltipPlacement {
  const left = trigger.left + trigger.width / 2
  const above = trigger.top - gap - tooltipSize.height
  if (above >= VIEWPORT_MARGIN_TOP) {
    return { left, top: above, placement: 'above' }
  }
  const below = trigger.bottom + gap
  if (below + tooltipSize.height <= viewport.height - VIEWPORT_PAD) {
    return { left, top: below, placement: 'below' }
  }
  return {
    left,
    top: Math.max(VIEWPORT_PAD, above),
    placement: 'above',
  }
}
