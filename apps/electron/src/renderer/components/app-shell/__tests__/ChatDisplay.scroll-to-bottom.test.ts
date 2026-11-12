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
  createStickyScrollFollow,
  readScrollMetrics,
  isAtBottom,
  stepSmoothDamp,
  type ScrollMetrics,
} from '../ChatDisplay.scroll-to-bottom'

describe('virtual history preserves reader intent and streaming', () => {
  const source = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf8')
  const body = source.match(/const handleScroll = React.useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[applyStickState\]\)/)?.[1]
  function scroll(sticky: boolean, atBottom: boolean) {
    expect(body).toBeDefined()
    const viewport = { scrollTop: atBottom ? 4600 : 1000, scrollHeight: 5000, clientHeight: 400 }
    const stickyRef = { current: sticky }
    let updates = 0
    let resumes = 0
    const scope = {
      scrollViewportRef: { current: viewport }, readScrollMetrics, isAtBottom,
      ignoreScrollUnstickUntilRef: { current: 0 }, isStickToBottomRef: stickyRef, shouldApplyUserScroll,
      applyStickState: () => { updates++; stickyRef.current = isAtBottom(viewport) },
      stickyFollowRef: { current: { resize() { resumes++ } } },
    }
    new Function(...Object.keys(scope), body!)(...Object.values(scope))
    return { sticky: stickyRef.current, updates, resumes }
  }
  test('layout growth alone cannot release the sticky bottom', () => {
    expect(scroll(true, false)).toEqual({ sticky: true, updates: 0, resumes: 0 })
  })
  test('reader scrolling away keeps control of the full history', () => {
    expect(scroll(false, false)).toEqual({ sticky: false, updates: 1, resumes: 0 })
  })
  test('returning to the actual bottom resumes following', () => {
    expect(scroll(false, true)).toEqual({ sticky: true, updates: 1, resumes: 1 })
  })
})

/**
 * Frame rate is not asserted in CI. Hand test: open a session of about 100 long
 * replies, start a long answer, and scroll in the Performance panel. A single
 * reply should not keep one span[data-stream-chunk] per token, and scrolling
 * should not show a forced layout on every token.
 */
describe('streaming resize follows frames and reader intent (#328)', () => {
  const source = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf8')

  test('upward wheel input suspends follow before native scrolling fires', () => {
    const wheelBody = source.match(/const handleWheel = \(event: WheelEvent\) => \{([\s\S]*?)\n    \}/)?.[1]
    expect(wheelBody).toBeDefined()
    const sticky = { current: true }
    let unlocks = 0
    let cancelled = 0
    const stickyFollowRef = { current: { cancel() { cancelled++ } } }
    const wheel = new Function('event', 'isStickToBottomRef', 'cancelProgrammaticLock', 'stickyFollowRef', wheelBody!)
    wheel({ deltaY: 20 }, sticky, () => unlocks++, stickyFollowRef)
    expect(sticky.current).toBe(true)
    expect(cancelled).toBe(1)
    wheel({ deltaY: -1 }, sticky, () => unlocks++, stickyFollowRef)
    expect(sticky.current).toBe(false)
    expect(unlocks).toBe(2)
    expect(cancelled).toBe(2)
  })

  test('resize follows until reader pauses, including when the panel loses focus', () => {
    let sticky = true
    let id = 0
    const frames = new Map<number, FrameRequestCallback>()
    const viewport = { scrollTop: 550, scrollHeight: 1200, clientHeight: 600 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => sticky, reduceMotion: () => false,
      requestFrame: callback => { frames.set(++id, callback); return id },
      cancelFrame: frame => { frames.delete(frame) },
    })
    follow.resize()
    follow.resize()
    expect(frames.size).toBe(1)
    let time = 0
    const tick = () => {
      const [frame, callback] = frames.entries().next().value!
      frames.delete(frame)
      callback(time += 16.67)
    }
    tick()
    expect(viewport.scrollTop).toBeGreaterThan(550)
    expect(viewport.scrollTop).toBeLessThan(600)
    viewport.scrollHeight += 24
    follow.resize()
    expect(frames.size).toBe(1)
    for (let i = 0; frames.size && i < 100; i++) tick()
    expect(viewport.scrollTop).toBe(624)
    viewport.clientHeight = 400
    follow.resize()
    sticky = false
    viewport.scrollTop = 300
    tick()
    expect(viewport.scrollTop).toBe(300)
    expect(frames.size).toBe(0)
    sticky = true
    follow.resize()
    follow.dispose()
    expect(frames.size).toBe(0)
  })

  test('a streaming row reports its real height instead of an estimated box', () => {
    const history = readFileSync(new URL('../ChatVirtualHistory.tsx', import.meta.url), 'utf8')
    expect(history).toContain('data-chat-virtual-streaming')
    expect(history).toContain('const layOutRow = active || (streaming && visible)')
    expect(history).toContain("...(layOutRow ? {} : { contentVisibility: 'auto'")
    expect(history).toContain('shouldMeasureVirtualScrollMargin')
  })

  test('follow frames write scrollTop from a cached target without rereading scrollHeight', () => {
    let reads = 0
    const viewport = {
      scrollTop: 560,
      get scrollHeight() { reads += 1; return 1000 },
      clientHeight: 400,
    }
    let next: FrameRequestCallback | undefined
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true,
      reduceMotion: () => false,
      requestFrame: callback => { next = callback; return 1 },
      cancelFrame: () => { next = undefined },
    })
    follow.resize()
    const afterSchedule = reads
    expect(afterSchedule).toBeGreaterThan(0)
    expect(next).toBeTypeOf('function')
    next!(16.67)
    expect(reads).toBe(afterSchedule)
    follow.resize()
    expect(reads).toBeGreaterThan(afterSchedule)
    const afterSecondResize = reads
    next!(33.34)
    expect(reads).toBe(afterSecondResize)
    follow.dispose()
  })

  test('uses one follow controller without translating the transcript', () => {
    expect(source).toContain('follow.resize()')
    expect(source).toContain('follow.dispose()')
    expect(source).toContain('stickyFollowRef.current?.cancel()')
    expect(source).not.toContain('applyFollowPaintTransform')
    expect(source).toContain('stickyFollowRef.current.resize(resolved)')
  })

  test('explicit smooth scrolling shares the follow loop, and instant requests cancel it', () => {
    let nextFrame: FrameRequestCallback | undefined
    let cancelled = 0
    const viewport = { scrollTop: 0, scrollHeight: 4000, clientHeight: 600 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => false,
      requestFrame: callback => { nextFrame = callback; return 1 },
      cancelFrame: () => { nextFrame = undefined; cancelled++ },
    })
    follow.resize('smooth')
    expect(viewport.scrollTop).toBe(0)
    nextFrame!(16.67)
    expect(viewport.scrollTop).toBeGreaterThan(0)
    expect(viewport.scrollTop).toBeLessThan(3400)
    viewport.scrollHeight += 24
    const before = viewport.scrollTop
    follow.resize()
    expect(viewport.scrollTop).toBe(before)
    follow.resize('instant')
    expect(viewport.scrollTop).toBe(3424)
    expect(nextFrame).toBeUndefined()
    expect(cancelled).toBe(1)
    follow.dispose()
  })

  test('follow frames use the ResizeObserver target, not a per-frame scrollHeight read', () => {
    let nextFrame: FrameRequestCallback | undefined
    const viewport = { scrollTop: 1190, scrollHeight: 2000, clientHeight: 800 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => false,
      requestFrame: callback => { nextFrame = callback; return 1 },
      cancelFrame: () => { nextFrame = undefined },
    })
    follow.resize()
    nextFrame!(16.67)
    const afterFirst = viewport.scrollTop
    expect(afterFirst).toBeGreaterThan(1190)
    expect(afterFirst).toBeLessThan(1200)
    viewport.scrollHeight = 4000
    nextFrame!(33.34)
    expect(viewport.scrollTop).toBeLessThan(afterFirst + 20)
    follow.resize()
    nextFrame!(50)
    expect(viewport.scrollTop).toBeGreaterThan(afterFirst)
    follow.dispose()
  })

  test('reduced motion snaps without scheduling work', () => {
    let scheduled = 0
    const viewport = { scrollTop: 500, scrollHeight: 1200, clientHeight: 600 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => true,
      requestFrame: () => { scheduled++; return 1 }, cancelFrame: () => {},
    })
    follow.resize()
    expect(viewport.scrollTop).toBe(600)
    expect(scheduled).toBe(0)
    follow.dispose()
  })

  test('viewport-sized streaming bursts ease instead of snapping', () => {
    let nextFrame: FrameRequestCallback | undefined
    const viewport = { scrollTop: 500, scrollHeight: 1200, clientHeight: 600 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => false,
      requestFrame: callback => { nextFrame = callback; return 1 },
      cancelFrame: () => { nextFrame = undefined },
    })
    viewport.scrollHeight += 2000
    follow.resize()
    expect(nextFrame).toBeTypeOf('function')
    expect(viewport.scrollTop).toBe(500)
    nextFrame!(16.67)
    expect(viewport.scrollTop).toBeGreaterThan(500)
    expect(viewport.scrollTop).toBeLessThan(2600)
    follow.dispose()
  })

  test('bursty line growth keeps one follow instead of staircase snaps', () => {
    let now = 0
    let nextFrame: FrameRequestCallback | undefined
    const viewport = { scrollTop: 920, scrollHeight: 1200, clientHeight: 280 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => false,
      requestFrame: callback => { nextFrame = callback; return 1 },
      cancelFrame: () => { nextFrame = undefined },
    })
    const samples: number[] = []
    const tick = (ms: number) => {
      now += ms
      nextFrame!(now)
      samples.push(viewport.scrollTop)
    }
    follow.resize()
    for (let burst = 0; burst < 6; burst++) {
      viewport.scrollHeight += 24
      follow.resize()
      tick(16.67)
      tick(16.67)
      tick(16.67)
      const target = viewport.scrollHeight - viewport.clientHeight
      expect(viewport.scrollTop).toBeLessThan(target)
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
      expect(samples[i] - samples[i - 1]).toBeLessThan(28)
    }
    follow.dispose()
  })

  test('cancel drops the follow frame immediately and resize resumes it', () => {
    let nextFrame: FrameRequestCallback | undefined
    let cancelled = 0
    const viewport = { scrollTop: 500, scrollHeight: 1200, clientHeight: 600 }
    const follow = createStickyScrollFollow(viewport, {
      sticky: () => true, reduceMotion: () => false,
      requestFrame: callback => { nextFrame = callback; return 1 },
      cancelFrame: () => { nextFrame = undefined; cancelled++ },
    })
    follow.resize()
    expect(nextFrame).toBeTypeOf('function')
    follow.cancel()
    expect(nextFrame).toBeUndefined()
    expect(cancelled).toBe(1)
    const frozen = viewport.scrollTop
    viewport.scrollHeight += 80
    follow.resize()
    expect(nextFrame).toBeTypeOf('function')
    nextFrame!(16.67)
    expect(viewport.scrollTop).toBeGreaterThan(frozen)
    follow.dispose()
  })
})

describe('stepSmoothDamp', () => {
  test('approaches without overshooting and is frame-rate independent', () => {
    let position = 0
    let velocity = 0
    for (let i = 0; i < 8; i++) {
      const next = stepSmoothDamp(position, 24, velocity, 0.016)
      expect(next.position).toBeGreaterThanOrEqual(position)
      expect(next.position).toBeLessThanOrEqual(24)
      position = next.position
      velocity = next.velocity
    }
    expect(position).toBeGreaterThan(8)
    const coarse = stepSmoothDamp(0, 24, 0, 0.032)
    const a = stepSmoothDamp(0, 24, 0, 0.016)
    const b = stepSmoothDamp(a.position, 24, a.velocity, 0.016)
    expect(Math.abs(coarse.position - b.position)).toBeLessThan(1.5)
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
