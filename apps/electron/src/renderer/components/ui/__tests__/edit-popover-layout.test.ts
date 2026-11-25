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
  POPOVER_HEADER_HEIGHT,
  POPOVER_INPUT_CHROME,
  VIEWPORT_MARGIN,
  VIEWPORT_MARGIN_TOP,
  clampPopoverOrigin,
  clampPopoverSize,
  clampPopoverSizeFromOrigin,
  getCompactInputMaxHeight,
  getInitialPopoverOrigin,
  hasPopoverDragMoved,
  popoverBodyClassName,
  readEditPopoverTriggerAnchor,
  resolveEditPopoverJobStatus,
  resolveEditPopoverOpenChange,
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

describe('clampPopoverOrigin', () => {
  const expanded = { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT }
  const collapsed = { width: COLLAPSED_POPOVER_WIDTH, height: COLLAPSED_POPOVER_HEIGHT }

  it('keeps the same fractional origin through repeated collapse and expand', () => {
    const origin = { x: 520.25, y: 200.75 }
    let current = origin
    for (let cycle = 0; cycle < 5; cycle++) {
      current = clampPopoverOrigin(current, collapsed, desktop)
      current = clampPopoverOrigin(current, expanded, desktop)
    }
    expect(current).toBe(origin)
  })

  it('only moves the title bar when an expansion would overflow', () => {
    const edge = { x: desktop.width - VIEWPORT_MARGIN - collapsed.width, y: 100 }
    expect(clampPopoverOrigin(edge, collapsed, desktop)).toBe(edge)
    const fitted = clampPopoverOrigin(edge, expanded, desktop)
    expect(fitted).toEqual({ x: desktop.width - VIEWPORT_MARGIN - expanded.width, y: edge.y })
    expect(clampPopoverOrigin(fitted, collapsed, desktop)).toBe(fitted)
  })

  it('keeps the window clear of the app title bar during drag', () => {
    expect(clampPopoverOrigin({ x: -400, y: -400 }, expanded, desktop))
      .toEqual({ x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN_TOP })
  })

  it('keeps the origin inside the app even when the viewport is smaller than the card', () => {
    expect(clampPopoverOrigin({ x: 200, y: 200 }, expanded, tiny))
      .toEqual({ x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN_TOP })
  })
})

describe('getInitialPopoverOrigin', () => {
  const size = { width: DEFAULT_POPOVER_WIDTH, height: DEFAULT_POPOVER_HEIGHT }

  it('centers the add-source window under the trigger', () => {
    expect(getInitialPopoverOrigin(
      { left: 362, right: 390, top: 60, bottom: 88 }, size, desktop, 'bottom', 'center',
    )).toEqual({ x: 176, y: 92 })
  })

  it('flips above a trigger near the bottom and clamps horizontal overflow', () => {
    expect(getInitialPopoverOrigin(
      { left: 1340, right: 1370, top: 820, bottom: 850 }, size, desktop, 'bottom', 'start',
    )).toEqual({ x: 1024, y: 336 })
  })

  it('keeps the end alignment of a side-anchored window', () => {
    expect(getInitialPopoverOrigin(
      { left: 440, right: 468, top: 640, bottom: 668 }, size, desktop, 'right', 'end',
    )).toEqual({ x: 472, y: 188 })
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

  it('resizes from invisible borders', () => {
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
    expect(source).toContain('data-testid="edit-popover-status"')
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
