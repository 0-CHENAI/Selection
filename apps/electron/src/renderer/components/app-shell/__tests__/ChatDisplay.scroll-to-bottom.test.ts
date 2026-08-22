import { describe, expect, test } from 'bun:test'
import {
  PROGRAMMATIC_SMOOTH_SCROLL_MS,
  SHOW_SCROLL_BUTTON_THRESHOLD_PX,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  forceStickToBottomState,
  isProgrammaticScrollLocked,
  resolveStickToBottomState,
  shouldApplyUserScroll,
  shouldLoadEarlierTurns,
  type ScrollMetrics,
} from '../ChatDisplay.scroll-to-bottom'

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
