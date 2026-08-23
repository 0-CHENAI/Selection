/**
 * Geometry for the MCP / Skill / automation create popover (#8).
 *
 * The floating window must stay inside the app viewport so the title bar
 * and send controls remain reachable when the user pastes long content.
 */

export const DEFAULT_POPOVER_WIDTH = 400
export const DEFAULT_POPOVER_HEIGHT = 480
export const MIN_POPOVER_WIDTH = 320
export const MIN_POPOVER_HEIGHT = 280
export const COLLAPSED_POPOVER_HEIGHT = 44
export const VIEWPORT_MARGIN = 16
export const VIEWPORT_MARGIN_TOP = 52
export const POPOVER_HEADER_HEIGHT = 40
export const POPOVER_INPUT_CHROME = 56

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Viewport = { width: number; height: number }

export function viewportMaxSize(viewport: Viewport): Size {
  return {
    width: Math.max(0, viewport.width - VIEWPORT_MARGIN * 2),
    height: Math.max(0, viewport.height - VIEWPORT_MARGIN - VIEWPORT_MARGIN_TOP),
  }
}

export function clampPopoverSize(
  size: Size,
  viewport: Viewport,
  collapsed = false,
): Size {
  const max = viewportMaxSize(viewport)
  const minWidth = Math.min(MIN_POPOVER_WIDTH, max.width)
  const minHeight = Math.min(MIN_POPOVER_HEIGHT, max.height)
  return {
    width: Math.min(Math.max(size.width, minWidth), Math.max(minWidth, max.width)),
    height: collapsed
      ? Math.min(COLLAPSED_POPOVER_HEIGHT, Math.max(max.height, COLLAPSED_POPOVER_HEIGHT))
      : Math.min(Math.max(size.height, minHeight), Math.max(minHeight, max.height)),
  }
}

/**
 * `base` is the popover's untranslated origin (current rect minus drag offset).
 */
export function clampPopoverOffset(
  offset: Point,
  size: Size,
  viewport: Viewport,
  base: Point,
): Point {
  const minX = VIEWPORT_MARGIN - base.x
  const maxX = viewport.width - VIEWPORT_MARGIN - size.width - base.x
  const minY = VIEWPORT_MARGIN_TOP - base.y
  const maxY = viewport.height - VIEWPORT_MARGIN - size.height - base.y
  return {
    x: Math.max(minX, Math.min(maxX, offset.x)),
    y: Math.max(minY, Math.min(maxY, offset.y)),
  }
}

/** Textarea cap so the send row stays on-screen inside the popover. */
export function getCompactInputMaxHeight(popoverHeight: number): number {
  const body = Math.max(0, popoverHeight - POPOVER_HEADER_HEIGHT)
  const cap = Math.floor(body * 0.4) - POPOVER_INPUT_CHROME
  return Math.max(72, Math.min(160, cap))
}
