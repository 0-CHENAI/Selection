import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COLLAPSED_POPOVER_HEIGHT,
  COLLAPSED_POPOVER_WIDTH,
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
  hasPopoverDragMoved,
  offsetToPinVisualOrigin,
  popoverBodyClassName,
  readEditPopoverTriggerAnchor,
  resolveEditPopoverJobStatus,
  resolveEditPopoverOpenChange,
  resolveEditPopoverPositioningSize,
  shouldAvoidEditPopoverCollisions,
  sizeFromResizeEdge,
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

  it('collapses to a compact title-bar strip', () => {
    const next = clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      desktop,
      true,
    )
    expect(next.height).toBe(COLLAPSED_POPOVER_HEIGHT)
    expect(next.width).toBe(COLLAPSED_POPOVER_WIDTH)
    expect(next.width).toBeLessThan(MIN_POPOVER_WIDTH)
  })

  it('caps the collapsed strip to a very small viewport', () => {
    const narrow = { width: 200, height: 280 }
    const next = clampPopoverSize(
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      narrow,
      true,
    )
    expect(next.width).toBe(narrow.width - VIEWPORT_MARGIN * 2)
    expect(next.width).toBeLessThan(COLLAPSED_POPOVER_WIDTH)
    expect(next.height).toBe(COLLAPSED_POPOVER_HEIGHT)
  })
})

describe('hasPopoverDragMoved', () => {
  const start = { x: 100, y: 80 }

  it('ignores a click with no movement', () => {
    expect(hasPopoverDragMoved(start, start)).toBe(false)
  })

  it('ignores jitter below the drag threshold', () => {
    expect(hasPopoverDragMoved(start, { x: 102, y: 81 })).toBe(false)
  })

  it('starts a drag once the pointer leaves the threshold', () => {
    expect(hasPopoverDragMoved(start, { x: 104, y: 80 })).toBe(true)
    expect(hasPopoverDragMoved(start, { x: 100, y: 85 })).toBe(true)
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

describe('offsetToPinVisualOrigin', () => {
  it('does not invent an offset when the painted origin did not move', () => {
    const visual = { left: 520, top: 200 }
    expect(offsetToPinVisualOrigin(
      { x: 0, y: 0 },
      visual,
      visual,
      { width: COLLAPSED_POPOVER_WIDTH, height: COLLAPSED_POPOVER_HEIGHT },
      desktop,
    )).toEqual({ x: 0, y: 0 })
  })

  it('undoes a Radix re-center after collapse so the title stays put', () => {
    const previous = { left: 520, top: 200 }
    const recentered = { left: 600, top: 200 }
    expect(offsetToPinVisualOrigin(
      { x: 0, y: 0 },
      previous,
      recentered,
      { width: COLLAPSED_POPOVER_WIDTH, height: COLLAPSED_POPOVER_HEIGHT },
      desktop,
    )).toEqual({ x: -80, y: 0 })
  })

  it('keeps the top-left pinned when a centered popover grows (#382)', () => {
    const origin = { left: 200, top: 120 }
    const recentered = { left: 160, top: 100 }
    expect(offsetToPinVisualOrigin(
      { x: 0, y: 0 },
      origin,
      recentered,
      { width: 480, height: 520 },
      desktop,
    )).toEqual({ x: 40, y: 20 })
  })

  it('pulls an expanded window back when the pinned origin would overflow', () => {
    const previous = { left: 1184, top: 80 }
    const next = offsetToPinVisualOrigin(
      { x: 0, y: 0 },
      previous,
      previous,
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
      desktop,
    )
    expect(1184 + next.x).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
    expect(1184 + next.x + DEFAULT_POPOVER_WIDTH).toBeLessThanOrEqual(desktop.width - VIEWPORT_MARGIN)
    expect(next.x).toBeLessThan(0)
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

describe('sizeFromResizeEdge (#385)', () => {
  const start = { width: 400, height: 480 }

  it('grows only width from the east edge', () => {
    expect(sizeFromResizeEdge(start, { x: 80, y: 40 }, 'e')).toEqual({ width: 480, height: 480 })
  })

  it('grows only height from the south edge', () => {
    expect(sizeFromResizeEdge(start, { x: 80, y: 40 }, 's')).toEqual({ width: 400, height: 520 })
  })

  it('grows both from the south-east corner', () => {
    expect(sizeFromResizeEdge(start, { x: 80, y: 40 }, 'se')).toEqual({ width: 480, height: 520 })
  })
})

describe('resolveEditPopoverOpenChange (#384)', () => {
  it('opens normally', () => {
    expect(resolveEditPopoverOpenChange(true, false)).toBe('open')
  })

  it('blurs instead of closing when dismiss was not requested', () => {
    expect(resolveEditPopoverOpenChange(false, false)).toBe('blur')
  })

  it('closes only when the title-bar close (or send leave) allowed it', () => {
    expect(resolveEditPopoverOpenChange(false, true)).toBe('close')
  })
})

describe('resolveEditPopoverJobStatus (#394)', () => {
  it('prefers waiting-for-input over an in-flight turn', () => {
    expect(resolveEditPopoverJobStatus({
      isProcessing: true,
      waitingInput: true,
      hasWork: true,
    })).toBe('waiting-input')
  })

  it('keeps a finished session visible as completed', () => {
    expect(resolveEditPopoverJobStatus({
      isProcessing: false,
      hasWork: true,
    })).toBe('completed')
  })

  it('surfaces error and cancelled creation as failed', () => {
    expect(resolveEditPopoverJobStatus({
      isProcessing: false,
      hasWork: true,
      lastMessageRole: 'error',
    })).toBe('failed')
    expect(resolveEditPopoverJobStatus({
      isProcessing: false,
      hasWork: true,
      creationStatus: 'cancelled',
    })).toBe('failed')
  })

  it('stays idle before any work starts', () => {
    expect(resolveEditPopoverJobStatus({ isProcessing: false })).toBe('idle')
  })
})

describe('collapsed popover placement (#394)', () => {
  it('collides the painted strip instead of the frozen 480px radix box', () => {
    expect(resolveEditPopoverPositioningSize(
      true,
      { width: COLLAPSED_POPOVER_WIDTH, height: COLLAPSED_POPOVER_HEIGHT },
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
    )).toEqual({ width: COLLAPSED_POPOVER_WIDTH, height: COLLAPSED_POPOVER_HEIGHT })
    expect(resolveEditPopoverPositioningSize(
      false,
      { width: 480, height: 520 },
      { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT },
    )).toEqual({ width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT })
  })

  it('stops following the trigger after collapse so page reflow cannot hide the strip', () => {
    expect(shouldAvoidEditPopoverCollisions(true)).toBe(false)
    expect(shouldAvoidEditPopoverCollisions(false)).toBe(true)
  })

  it('anchors a durable add-source trigger under the empty-state button', () => {
    expect(readEditPopoverTriggerAnchor({ left: 100, top: 80, width: 80, height: 28 }))
      .toEqual({ left: 140, top: 108 })
    expect(readEditPopoverTriggerAnchor(null)).toEqual({ left: 0, top: 0 })
  })
})

describe('EditPopover floating window (#384, #385)', () => {
  const source = readFileSync(join(import.meta.dir, '../EditPopover.tsx'), 'utf8')

  it('keeps the window on outside click and only closes explicitly', () => {
    expect(source).toContain('resolveEditPopoverOpenChange')
    expect(source).toContain('onPointerDownOutside={preventDismiss}')
    expect(source).toContain('onFocusOutside={preventDismiss}')
    expect(source).toContain('onClick={closePopover}')
    expect(source).toContain('data-focused={focused ? \'true\' : \'false\'}')
  })

  it('resizes from invisible borders and freezes the Radix box', () => {
    expect(source).toContain('radixBoxRef.current = next')
    expect(source).toContain('data-testid="edit-popover-resize-e"')
    expect(source).toContain('data-testid="edit-popover-resize-s"')
    expect(source).toContain('data-testid="edit-popover-resize-se"')
    expect(source).not.toMatch(/data-testid="edit-popover-resize"(?!-)/)
    expect(source).not.toContain('size-6 cursor-nwse-resize')
    expect(source).toContain('sizeFromResizeEdge')
  })
})

describe('EditPopover MCP/skill config (#394)', () => {
  const source = readFileSync(join(import.meta.dir, '../EditPopover.tsx'), 'utf8')
  const sourcesList = readFileSync(join(import.meta.dir, '../../app-shell/SourcesListPanel.tsx'), 'utf8')
  const skillsList = readFileSync(join(import.meta.dir, '../../app-shell/SkillsListPanel.tsx'), 'utf8')

  it('hides the record navigator and its placeholder column in compact config chats', () => {
    expect(source).toContain('showRecordNavigation={false}')
  })

  it('keeps the collapsed strip after completion and shows the job status', () => {
    expect(source).toContain('resolveEditPopoverJobStatus')
    expect(source).toContain('avoidCollisions={shouldAvoidEditPopoverCollisions(collapsed)}')
    expect(source).toContain('data-testid="edit-popover-status"')
    expect(source).toContain('resolveEditPopoverPositioningSize')
    expect(source).toContain('clampVisualPopoverOffset')
  })

  it('does not replace a loaded skill page with not-found during a config rewrite', () => {
    const skillInfo = readFileSync(join(import.meta.dir, '../../../pages/SkillInfoPage.tsx'), 'utf8')
    expect(skillInfo).toContain('else if (!skillRef.current)')
  })

  it('does not unmount add-source/add-skill popovers when the empty list fills', () => {
    expect(sourcesList).toContain('addSourceOpen && (')
    expect(sourcesList).toContain('openAddSource')
    expect(sourcesList).not.toMatch(/emptyState=\{[\s\S]*<EditPopover/)
    expect(skillsList).toContain('addSkillOpen && (')
    expect(skillsList).toContain('openAddSkill')
    expect(skillsList).not.toMatch(/emptyState=\{[\s\S]*<EditPopover/)
  })
})
