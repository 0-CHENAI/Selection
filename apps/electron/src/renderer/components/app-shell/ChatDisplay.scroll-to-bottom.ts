/**
 * Pure helpers for chat stick-to-bottom + the "back to bottom" control.
 *
 * Kept out of `ChatDisplay.tsx` so leave / return / send / click / lock
 * rules can be unit-tested without mounting the renderer.
 */

export const STICK_TO_BOTTOM_THRESHOLD_PX = 20
/** Show the button farther than the stick threshold so it does not flicker at the edge. */
export const SHOW_SCROLL_BUTTON_THRESHOLD_PX = 40
export const LOAD_MORE_TOP_PX = 100
export const PROGRAMMATIC_SMOOTH_SCROLL_MS = 1200
export const PROGRAMMATIC_INSTANT_SCROLL_MS = 500

export type ScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type StickToBottomState = {
  isStickToBottom: boolean
  showButton: boolean
}

export function readScrollMetrics(
  node: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
): ScrollMetrics {
  return {
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }
}

export function getDistanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
}

/**
 * Pin the viewport before paint, including streaming growth, so the response
 * bottom stays against the composer. A reader who scrolled up keeps control.
 */
export function snapStickyViewportToBottom(
  viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  options: { focused: boolean; sticky: boolean },
): boolean {
  if (options.focused && !options.sticky) return false
  viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  return true
}

/** One display frame. Longer dt after a hitch reads as a dropped-frame jump. */
export const STICKY_FOLLOW_MAX_DT_MS = 24
/** Track the bottom every frame. 220ms felt like a low-fps slide. */
export const STICKY_FOLLOW_MS = 80
/** Same spring as dsh-smooth-stream: visual lag lives on a compositor layer. */
export const FOLLOW_SPRING_STIFFNESS = 130
export const FOLLOW_SPRING_DAMPING = 24
export const FOLLOW_SPRING_MASS = 1
export const FOLLOW_SPRING_SUBSTEPS = 4
export const FOLLOW_MAX_FRAME_MS = 32
/** A 24px wrap must glide; never paint the whole line in one frame. */
export const FOLLOW_PAINT_SHIFT_MAX_STEP_PX = 8

export type FollowPaintState = {
  shift: number
  velocity: number
}

/**
 * Ease toward the true bottom while content grows. Returns whether another
 * animation frame is needed. Prefer a cached `target` so the rAF loop only writes.
 */
export function followStickyViewportToBottom(
  viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  options: { focused: boolean; sticky: boolean; reduceMotion: boolean; elapsedMs: number; target?: number },
): boolean {
  if (options.focused && !options.sticky) return false
  const target = options.target ?? Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const distance = target - viewport.scrollTop
  if (options.reduceMotion || Math.abs(distance) < 0.75) {
    viewport.scrollTop = target
    return false
  }
  viewport.scrollTop += distance * (1 - Math.exp(-options.elapsedMs / STICKY_FOLLOW_MS))
  if (Math.abs(target - viewport.scrollTop) < 0.75) {
    viewport.scrollTop = target
    return false
  }
  return true
}

/** Growth is added in full so a same-frame pin + transform cancel the wrap jump. */
export function compensateFollowPaintShift(state: FollowPaintState, growthPx: number): FollowPaintState {
  if (growthPx <= 0) return state
  return { shift: state.shift + growthPx, velocity: state.velocity }
}

/**
 * Spring the compositor lag toward 0. Decay is capped at 8px per 16.67ms so
 * a wrap glides instead of hopping. Does not read or write layout.
 */
export function decayFollowPaintShift(
  state: FollowPaintState,
  elapsedMs: number,
  reduceMotion: boolean,
): FollowPaintState & { more: boolean } {
  if (reduceMotion || Math.abs(state.shift) < 0.25) {
    return { shift: 0, velocity: 0, more: false }
  }
  const dt = Math.min(FOLLOW_MAX_FRAME_MS, Math.max(0, elapsedMs)) / 1000
  if (dt <= 0) return { ...state, more: true }

  let x = state.shift
  let v = state.velocity
  const step = dt / FOLLOW_SPRING_SUBSTEPS
  for (let i = 0; i < FOLLOW_SPRING_SUBSTEPS; i++) {
    const accel = (-FOLLOW_SPRING_STIFFNESS * x - FOLLOW_SPRING_DAMPING * v) / FOLLOW_SPRING_MASS
    v += accel * step
    x += v * step
  }
  if (x < 0) {
    x = 0
    v = 0
  }
  const maxDecay = FOLLOW_PAINT_SHIFT_MAX_STEP_PX * (Math.min(FOLLOW_MAX_FRAME_MS, Math.max(0, elapsedMs)) / 16.67)
  if (state.shift - x > maxDecay) {
    x = state.shift - maxDecay
  }
  if (x < 0.25) return { shift: 0, velocity: 0, more: false }
  return { shift: x, velocity: v, more: true }
}

export function applyFollowPaintTransform(
  element: { style: { transform: string; willChange: string } },
  shiftPx: number,
): void {
  if (Math.abs(shiftPx) < 0.25) {
    element.style.transform = ''
    element.style.willChange = ''
    return
  }
  element.style.willChange = 'transform'
  element.style.transform = `translate3d(0, ${shiftPx}px, 0)`
}

export function contentOverflows(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight > metrics.clientHeight + 1
}

export function isAtBottom(
  metrics: ScrollMetrics,
  threshold = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return getDistanceFromBottom(metrics) < threshold
}

export function forceStickToBottomState(): StickToBottomState {
  return { isStickToBottom: true, showButton: false }
}

/**
 * Stick uses the existing 20px edge. The button uses hysteresis: appear only
 * after 40px away, then stay until the 20px stick edge so near-bottom
 * streaming / input-height jitter does not flash it.
 */
export function resolveStickToBottomState(
  metrics: ScrollMetrics,
  wasShowing = false,
): StickToBottomState {
  const stuck = isAtBottom(metrics)
  if (stuck || !contentOverflows(metrics)) {
    return { isStickToBottom: stuck, showButton: false }
  }

  const distance = getDistanceFromBottom(metrics)
  const showButton = wasShowing
    ? distance >= STICK_TO_BOTTOM_THRESHOLD_PX
    : distance >= SHOW_SCROLL_BUTTON_THRESHOLD_PX

  return { isStickToBottom: false, showButton }
}

/**
 * During a programmatic scroll-to-bottom, ignore user-unstick until we
 * actually arrive (or the lock expires). Otherwise `handleScroll` would
 * flip stick off mid-animation and flash the button back.
 */
export function shouldApplyUserScroll(
  now: number,
  ignoreUntil: number,
  atBottom: boolean,
): boolean {
  if (now >= ignoreUntil) return true
  return atBottom
}

export function isProgrammaticScrollLocked(now: number, ignoreUntil: number): boolean {
  return now < ignoreUntil
}

/** Lazy-loading older turns must not run while we are animating back to the bottom. */
export function shouldLoadEarlierTurns(scrollTop: number, programmaticLockActive: boolean): boolean {
  return !programmaticLockActive && scrollTop < LOAD_MORE_TOP_PX
}

export function programmaticScrollLockMs(behavior: ScrollBehavior): number {
  return behavior === 'smooth' ? PROGRAMMATIC_SMOOTH_SCROLL_MS : PROGRAMMATIC_INSTANT_SCROLL_MS
}
