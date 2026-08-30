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
/** Matches the `h-10` title bar. */
export const COLLAPSED_POPOVER_HEIGHT = 40
/** Hug the title + header buttons; ignore the 320 expanded minimum. */
export const COLLAPSED_POPOVER_WIDTH = 240
export const VIEWPORT_MARGIN = 16
export const VIEWPORT_MARGIN_TOP = 52
export const POPOVER_HEADER_HEIGHT = 40
export const POPOVER_INPUT_CHROME = 56
export const POPOVER_MESSAGE_RESERVE = 64
/** Clicks on the drag handle must not start a drag or flip Radix collision. */
export const POPOVER_DRAG_THRESHOLD = 4

/** Keep Radix collision padding aligned with the app title-bar inset. */
export const POPOVER_COLLISION_PADDING = {
  top: VIEWPORT_MARGIN_TOP,
  right: VIEWPORT_MARGIN,
  bottom: VIEWPORT_MARGIN,
  left: VIEWPORT_MARGIN,
} as const

/**
 * Collapsed body must not keep `flex`. Tailwind's `flex` and `hidden` both set
 * `display`, and `flex` wins in the generated sheet — #122 empty-state leak.
 */
export function popoverBodyClassName(collapsed: boolean): string {
  return collapsed ? 'hidden' : 'flex min-h-0 min-w-0 flex-1 flex-col'
}

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Viewport = { width: number; height: number }

export function hasPopoverDragMoved(
  start: Point,
  current: Point,
  threshold = POPOVER_DRAG_THRESHOLD,
): boolean {
  const dx = current.x - start.x
  const dy = current.y - start.y
  return dx * dx + dy * dy >= threshold * threshold
}

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
    width: collapsed
      ? Math.min(COLLAPSED_POPOVER_WIDTH, max.width)
      : Math.min(Math.max(size.width, minWidth), Math.max(minWidth, max.width)),
    height: collapsed
      ? Math.min(COLLAPSED_POPOVER_HEIGHT, Math.max(max.height, COLLAPSED_POPOVER_HEIGHT))
      : Math.min(Math.max(size.height, minHeight), Math.max(minHeight, max.height)),
  }
}

/**
 * `base` is the popover's untranslated origin (current rect minus drag offset).
 */
function clampAxis(value: number, min: number, max: number): number {
  if (min <= max) return Math.max(min, Math.min(max, value))
  return min
}

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
    x: clampAxis(offset.x, minX, maxX),
    y: clampAxis(offset.y, minY, maxY),
  }
}

/**
 * Clamp using the painted box (getBoundingClientRect, includes translate).
 * After collapse/expand Radix may move the untranslated origin; re-run this
 * so the card cannot cover the app title bar (#123).
 */
export function clampVisualPopoverOffset(
  offset: Point,
  visual: { left: number; top: number },
  size: Size,
  viewport: Viewport,
): Point {
  return clampPopoverOffset(
    offset,
    size,
    viewport,
    { x: visual.left - offset.x, y: visual.top - offset.y },
  )
}

/**
 * Collapse/expand changes the box size. Radix may also re-place the
 * untranslated origin while avoidCollisions is still on. Shift the drag
 * offset so the top-left the user last saw stays put, then clamp.
 */
export function offsetToPinVisualOrigin(
  offset: Point,
  previousVisual: { left: number; top: number },
  currentVisual: { left: number; top: number },
  nextSize: Size,
  viewport: Viewport,
): Point {
  const pinned = {
    x: offset.x + previousVisual.left - currentVisual.left,
    y: offset.y + previousVisual.top - currentVisual.top,
  }
  return clampVisualPopoverOffset(pinned, previousVisual, nextSize, viewport)
}

/**
 * Bottom-right resize. Cap width/height by the remaining space from the
 * current top-left so growing the window cannot cross the viewport edge.
 */
export function clampPopoverSizeFromOrigin(
  size: Size,
  viewport: Viewport,
  origin: Point,
): Size {
  const fitted = clampPopoverSize(size, viewport)
  const maxWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN - origin.x)
  const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN - origin.y)
  return {
    width: Math.min(fitted.width, maxWidth),
    height: Math.min(fitted.height, maxHeight),
  }
}

/** Textarea cap so the send row stays on-screen inside the popover. */
export function getCompactInputMaxHeight(popoverHeight: number): number {
  const available = popoverHeight - POPOVER_HEADER_HEIGHT - POPOVER_INPUT_CHROME
  return Math.max(48, Math.min(160, available - POPOVER_MESSAGE_RESERVE))
}
