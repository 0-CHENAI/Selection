import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  PROGRAMMATIC_SMOOTH_SCROLL_MS,
  SHOW_SCROLL_BUTTON_THRESHOLD_PX,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  FOLLOW_PAINT_SHIFT_MAX_STEP_PX,
  applyFollowPaintTransform,
  compensateFollowPaintShift,
  decayFollowPaintShift,
  forceStickToBottomState,
  isProgrammaticScrollLocked,
  resolveStickToBottomState,
  shouldApplyUserScroll,
  shouldLoadEarlierTurns,
  followStickyViewportToBottom,
  snapStickyViewportToBottom,
  type ScrollMetrics,
} from '../ChatDisplay.scroll-to-bottom'

describe('streaming resize follows frames and reader intent (#328)', () => {
  const source = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf8')
  const body = source.match(/const resizeObserver = new ResizeObserver\(\(\) => \{([\s\S]*?)\n    \}\)/)?.[1]

  test('upward wheel input suspends follow before native scrolling fires', () => {
    const wheelBody = source.match(/const handleWheel = \(event: WheelEvent\) => \{([\s\S]*?)\n    \}/)?.[1]
    expect(wheelBody).toBeDefined()
    const sticky = { current: true }
    let unlocks = 0
    const wheel = new Function('event', 'isStickToBottomRef', 'cancelProgrammaticLock', wheelBody!)
    wheel({ deltaY: 20 }, sticky, () => unlocks++)
    expect(sticky.current).toBe(true)
    wheel({ deltaY: -1 }, sticky, () => unlocks++)
    expect(sticky.current).toBe(false)
    expect(unlocks).toBe(2)
  })

  test('resize follows until reader pauses, including when the panel loses focus', () => {
    const resize = new Function('isStickToBottomRef', 'snapStickyViewportToBottom', 'viewport', 'isFocusedPanelRef', body!)
    const sticky = { current: true }
    const focused = { current: true }
    const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 600 }
    resize(sticky, snapStickyViewportToBottom, viewport, focused)
    expect(viewport.scrollTop).toBe(600)
    viewport.clientHeight = 400
    resize(sticky, snapStickyViewportToBottom, viewport, focused)
    expect(viewport.scrollTop).toBe(800)
    sticky.current = false
    focused.current = false
    viewport.scrollTop = 300
    viewport.scrollHeight = 1500
    resize(sticky, snapStickyViewportToBottom, viewport, focused)
    expect(viewport.scrollTop).toBe(300)
  })

  test('pins growth before paint without translating the transcript', () => {
    expect(body).toBeDefined()
    expect(source).toContain('snapStickyViewportToBottom')
    expect(body).toContain('snapStickyViewportToBottom')
    expect(body).not.toContain('requestAnimationFrame')
    expect(body).not.toContain('applyFollowPaintTransform')
    expect(body).not.toContain('compensateFollowPaintShift')
    expect(source).not.toContain('applyFollowPaintTransform')
  })
})

describe('followStickyViewportToBottom', () => {
  test('approaches the bottom over several frames instead of snapping', () => {
    const viewport = { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 }
    expect(followStickyViewportToBottom(viewport, {
      focused: true, sticky: true, reduceMotion: false, elapsedMs: 16, target: 1200,
    })).toBe(true)
    expect(viewport.scrollTop).toBeGreaterThan(0)
    expect(viewport.scrollTop).toBeLessThan(400)
  })

  test('snaps when motion is reduced and leaves a reader who scrolled away', () => {
    const reduced = { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 }
    expect(followStickyViewportToBottom(reduced, {
      focused: true, sticky: true, reduceMotion: true, elapsedMs: 16,
    })).toBe(false)
    expect(reduced.scrollTop).toBe(1200)

    const away = { scrollTop: 100, scrollHeight: 2000, clientHeight: 800 }
    expect(followStickyViewportToBottom(away, {
      focused: true, sticky: false, reduceMotion: false, elapsedMs: 16,
    })).toBe(false)
    expect(away.scrollTop).toBe(100)
  })
})

describe('follow paint shift', () => {
  test('compensates a wrap in full then decays at most 8px per frame', () => {
    const compensated = compensateFollowPaintShift({ shift: 0, velocity: 0 }, 24)
    expect(compensated.shift).toBe(24)
    const next = decayFollowPaintShift(compensated, 16.67, false)
    expect(compensated.shift - next.shift).toBeLessThanOrEqual(FOLLOW_PAINT_SHIFT_MAX_STEP_PX + 0.01)
    expect(next.shift).toBeGreaterThan(14)
    expect(next.more).toBe(true)
  })

  test('clears the compositor layer when motion is reduced or lag is gone', () => {
    expect(decayFollowPaintShift({ shift: 24, velocity: 0 }, 16, true)).toEqual({
      shift: 0, velocity: 0, more: false,
    })
    const element = { style: { transform: 'translate3d(0, 12px, 0)', willChange: 'transform' } }
    applyFollowPaintTransform(element, 12)
    expect(element.style.transform).toBe('translate3d(0, 12px, 0)')
    applyFollowPaintTransform(element, 0)
    expect(element.style.transform).toBe('')
    expect(element.style.willChange).toBe('')
  })
})

describe('snapStickyViewportToBottom', () => {
  test('snaps immediately when the reader is sticky or the panel is unfocused', () => {
    const viewport = { scrollTop: 100, scrollHeight: 2000, clientHeight: 800 }
    expect(snapStickyViewportToBottom(viewport, { focused: true, sticky: true })).toBe(true)
    expect(viewport.scrollTop).toBe(1200)
  })

  test('leaves the viewport alone when the focused reader has scrolled away', () => {
    const viewport = { scrollTop: 100, scrollHeight: 2000, clientHeight: 800 }
    expect(snapStickyViewportToBottom(viewport, { focused: true, sticky: false })).toBe(false)
    expect(viewport.scrollTop).toBe(100)
  })
})

function metrics(overrides: Partial<ScrollMetrics> = {}): ScrollMetrics {
  return {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 800,
    ...overrides,
  }
}

/** scrollTop that leaves `distance` pixels above the bottom of a 2000/800 viewport. */
function away(distance: number): ScrollMetrics {
  return metrics({ scrollTop: 2000 - 800 - distance })
}

describe('resolveStickToBottomState — leave / return / send / click (#73)', () => {
  test('shows the button after leaving the bottom of an overflowing thread', () => {
    const next = resolveStickToBottomState(away(80))
    expect(next.isStickToBottom).toBe(false)
    expect(next.showButton).toBe(true)
  })

  test('hides the button after scrolling back to the bottom', () => {
    const next = resolveStickToBottomState(away(10), true)
    expect(next.isStickToBottom).toBe(true)
    expect(next.showButton).toBe(false)
  })

  test('does not flash the button in the 20–40px hysteresis band', () => {
    const mid = away((STICK_TO_BOTTOM_THRESHOLD_PX + SHOW_SCROLL_BUTTON_THRESHOLD_PX) / 2)
    const first = resolveStickToBottomState(mid, false)
    expect(first.isStickToBottom).toBe(false)
    expect(first.showButton).toBe(false)

    const stillShowing = resolveStickToBottomState(mid, true)
    expect(stillShowing.isStickToBottom).toBe(false)
    expect(stillShowing.showButton).toBe(true)
  })

  test('clicking or sending force-sticks and hides the button', () => {
    expect(forceStickToBottomState()).toEqual({ isStickToBottom: true, showButton: false })
    expect(resolveStickToBottomState(away(200), true).showButton).toBe(true)
  })

  test('stays visible while new streaming content arrives away from the bottom', () => {
    const before = resolveStickToBottomState(metrics({ scrollTop: 200, scrollHeight: 2000 }), true)
    const after = resolveStickToBottomState(metrics({ scrollTop: 200, scrollHeight: 2600 }), true)
    expect(before.showButton).toBe(true)
    expect(after.showButton).toBe(true)
    expect(after.isStickToBottom).toBe(false)
  })

  test('does not show the button when content does not overflow', () => {
    const next = resolveStickToBottomState({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 800,
    })
    expect(next.isStickToBottom).toBe(true)
    expect(next.showButton).toBe(false)
  })
})

describe('shouldApplyUserScroll — programmatic scroll lock', () => {
  test('does not unstick while a smooth scroll-to-bottom is in flight', () => {
    const now = 1_000
    expect(shouldApplyUserScroll(now, now + PROGRAMMATIC_SMOOTH_SCROLL_MS, false)).toBe(false)
  })

  test('applies the arrived-at-bottom update even during the lock', () => {
    const now = 1_000
    expect(shouldApplyUserScroll(now, now + PROGRAMMATIC_SMOOTH_SCROLL_MS, true)).toBe(true)
  })

  test('resumes normal unstick after the lock expires', () => {
    const now = 1_000
    expect(shouldApplyUserScroll(now + PROGRAMMATIC_SMOOTH_SCROLL_MS, now + PROGRAMMATIC_SMOOTH_SCROLL_MS - 1, false)).toBe(true)
  })
})

describe('shouldLoadEarlierTurns — do not fight scroll-to-bottom', () => {
  test('loads older turns when the user is near the top', () => {
    expect(shouldLoadEarlierTurns(40, false)).toBe(true)
  })

  test('skips lazy-load while a programmatic scroll-to-bottom is locked', () => {
    expect(shouldLoadEarlierTurns(40, true)).toBe(false)
    expect(isProgrammaticScrollLocked(1_000, 1_200)).toBe(true)
  })

  test('does not load when the user is away from the top', () => {
    expect(shouldLoadEarlierTurns(400, false)).toBe(false)
  })
})

 test('response bottom remains fixed through successive paragraph growth; scrolling up interrupts it', () => {
   const viewport = { scrollTop: 400, scrollHeight: 1000, clientHeight: 600 }
   for (const growth of [24, 160, 480, 32]) {
     viewport.scrollHeight += growth
     snapStickyViewportToBottom(viewport, { focused: true, sticky: true })
     expect(viewport.scrollHeight - viewport.scrollTop).toBe(viewport.clientHeight)
   }
   viewport.scrollTop -= 200
   const readingPosition = viewport.scrollTop
   viewport.scrollHeight += 300
   snapStickyViewportToBottom(viewport, { focused: true, sticky: false })
   expect(viewport.scrollTop).toBe(readingPosition)
 })
