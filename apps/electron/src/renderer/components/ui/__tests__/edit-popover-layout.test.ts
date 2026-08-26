import { describe, expect, it } from 'bun:test'
import {
  COLLAPSED_POPOVER_HEIGHT,
  DEFAULT_POPOVER_HEIGHT,
  DEFAULT_POPOVER_WIDTH,
  MIN_POPOVER_HEIGHT,
  MIN_POPOVER_WIDTH,
  POPOVER_COLLISION_PADDING,
  POPOVER_HEADER_HEIGHT,
  POPOVER_INPUT_CHROME,
  VIEWPORT_MARGIN,
  VIEWPORT_MARGIN_TOP,
  clampPopoverOffset,
  clampPopoverSize,
  clampPopoverSizeFromOrigin,
  clampVisualPopoverOffset,
  getCompactInputMaxHeight,
  popoverBodyClassName,
} from '../edit-popover-layout'

const desktop = { width: 1440, height: 900 }
const small = { width: 800, height: 500 }
const tiny = { width: 360, height: 280 }

describe('clampPopoverSize (#8)', () => {
  it('keeps the default create window inside a desktop viewport', () => {
    expect(clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      desktop,
    )).toEqual({ width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT })
  })

  it('does not grow past the app viewport when content is huge', () => {
    const next = clampPopoverSize({ width: 4000, height: 8000 }, desktop)
    expect(next.width).toBeLessThanOrEqual(desktop.width)
    expect(next.height).toBeLessThanOrEqual(desktop.height)
    expect(next.width).toBeLessThan(desktop.width)
    expect(next.height).toBeLessThan(desktop.height)
  })

  it('shrinks to fit a short window so chrome stays reachable', () => {
    const next = clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      small,
    )
    expect(next.height).toBeLessThan(DEFAULT_POPOVER_HEIGHT)
    expect(next.height).toBeLessThanOrEqual(small.height - VIEWPORT_MARGIN_TOP - VIEWPORT_MARGIN)
    expect(next.width).toBe(DEFAULT_POPOVER_WIDTH)
  })

  it('never exceeds a very small viewport', () => {
    const next = clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      tiny,
    )
    expect(next.width).toBeLessThanOrEqual(tiny.width - VIEWPORT_MARGIN * 2)
    expect(next.height).toBeLessThanOrEqual(tiny.height - VIEWPORT_MARGIN_TOP - VIEWPORT_MARGIN)
  })

  it('does not shrink below the minimum on a large viewport', () => {
    expect(clampPopoverSize({ width: 100, height: 80 }, desktop)).toEqual({
      width: MIN_POPOVER_WIDTH,
      height: MIN_POPOVER_HEIGHT,
    })
  })

  it('collapses to the title-bar height', () => {
    expect(clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      desktop,
      true,
    ).height).toBe(COLLAPSED_POPOVER_HEIGHT)
  })
})

describe('popoverBodyClassName (#122)', () => {
  it('drops flex when collapsed so hidden can actually hide the empty state', () => {
    expect(popoverBodyClassName(true)).toBe('hidden')
    expect(popoverBodyClassName(true)).not.toMatch(/\bflex\b/)
    expect(popoverBodyClassName(false)).toMatch(/\bflex\b/)
    expect(popoverBodyClassName(false)).not.toMatch(/\bhidden\b/)
  })
})

describe('POPOVER_COLLISION_PADDING (#123)', () => {
  it('reserves the app title bar, not the Radix 20px default', () => {
    expect(POPOVER_COLLISION_PADDING.top).toBe(VIEWPORT_MARGIN_TOP)
    expect(POPOVER_COLLISION_PADDING.top).toBeGreaterThan(20)
  })
})

describe('clampPopoverOffset (#8)', () => {
  it('keeps the window inside the viewport after a drag', () => {
    const size = { width: 400, height: 480 }
    const base = { x: 100, y: 80 }
    const next = clampPopoverOffset({ x: 4000, y: 4000 }, size, desktop, base)
    expect(base.x + next.x + size.width).toBeLessThanOrEqual(desktop.width - VIEWPORT_MARGIN)
    expect(base.y + next.y + size.height).toBeLessThanOrEqual(desktop.height - VIEWPORT_MARGIN)
  })

  it('keeps the title bar below the app chrome', () => {
    const next = clampPopoverOffset(
      { x: 0, y: -400 },
      { width: 400, height: 280 },
      desktop,
      { x: 40, y: 40 },
    )
    expect(40 + next.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_TOP)
  })

  it('does not invert the clamp when the window is larger than the viewport', () => {
    const next = clampPopoverOffset(
      { x: 200, y: 200 },
      { width: 2000, height: 2000 },
      tiny,
      { x: 0, y: 0 },
    )
    expect(next.x).toBe(VIEWPORT_MARGIN)
    expect(next.y).toBe(VIEWPORT_MARGIN_TOP)
  })
})

describe('clampVisualPopoverOffset (#123)', () => {
  it('keeps expand-from-top below the app chrome after the origin jumps', () => {
    // Collapsed bar was dragged to y=52 (offset -348, base 400). Expand to 480.
    // Radix then shifts the untranslated origin 400 → 300, painting at y=-48.
    const offset = { x: 0, y: -348 }
    const shiftedBaseY = 300
    const visual = { left: 100, top: shiftedBaseY + offset.y }
    expect(visual.top).toBeLessThan(VIEWPORT_MARGIN_TOP)

    const next = clampVisualPopoverOffset(
      offset,
      visual,
      { width: 400, height: 480 },
      desktop,
    )
    expect(shiftedBaseY + next.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_TOP)
    expect(shiftedBaseY + next.y + 480).toBeLessThanOrEqual(desktop.height - VIEWPORT_MARGIN)
  })

  it('keeps the title bar pinned when expanding a collapsed strip at the top', () => {
    const offset = { x: 0, y: -348 }
    const visual = { left: 100, top: VIEWPORT_MARGIN_TOP }
    const next = clampVisualPopoverOffset(
      offset,
      visual,
      { width: 400, height: DEFAULT_POPOVER_HEIGHT },
      desktop,
    )
    expect(visual.top - offset.y + next.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_TOP)
    expect(visual.top - offset.y + next.y + DEFAULT_POPOVER_HEIGHT)
      .toBeLessThanOrEqual(desktop.height - VIEWPORT_MARGIN)
  })

  it('does not move a window that already clears the title bar', () => {
    const offset = { x: 12, y: -40 }
    const visual = { left: 120, top: 80 }
    expect(clampVisualPopoverOffset(
      offset,
      visual,
      { width: 400, height: 480 },
      desktop,
    )).toEqual(offset)
  })
})

describe('clampPopoverSizeFromOrigin (#8)', () => {
  it('does not grow past the right or bottom edge', () => {
    const next = clampPopoverSizeFromOrigin(
      { width: 800, height: 800 },
      desktop,
      { x: 1200, y: 700 },
    )
    expect(1200 + next.width).toBeLessThanOrEqual(desktop.width - VIEWPORT_MARGIN)
    expect(700 + next.height).toBeLessThanOrEqual(desktop.height - VIEWPORT_MARGIN)
  })
})

describe('getCompactInputMaxHeight (#8)', () => {
  it('caps the composer so it cannot fill the create window', () => {
    const max = getCompactInputMaxHeight(DEFAULT_POPOVER_HEIGHT)
    expect(max).toBeLessThan(DEFAULT_POPOVER_HEIGHT / 2)
    expect(max).toBeGreaterThanOrEqual(72)
  })

  it('still leaves a usable composer in a short popover', () => {
    expect(getCompactInputMaxHeight(280)).toBeGreaterThanOrEqual(48)
  })

  it('leaves room for the title bar and send row', () => {
    const height = DEFAULT_POPOVER_HEIGHT
    const input = getCompactInputMaxHeight(height)
    expect(POPOVER_HEADER_HEIGHT + POPOVER_INPUT_CHROME + input).toBeLessThan(height)
  })
})
