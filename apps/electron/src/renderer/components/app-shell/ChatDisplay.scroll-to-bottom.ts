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

/** Cap dt so a hitch does not jump the viewport. ~2 frames at 60Hz. */
export const STICKY_FOLLOW_MAX_DT_MS = 32
/** @deprecated SmoothDamp `smoothTime` replaced the exponential tau. */
export const STICKY_FOLLOW_MS = 80
/**
 * Unity-style SmoothDamp time. ~140ms to the bulk of a wrap, overlapping
 * 34–119ms stream bursts instead of settling into a staircase.
 */
export const STICKY_FOLLOW_SMOOTH_TIME_S = 0.14
export const STICKY_FOLLOW_SETTLE_PX = 0.35
export const STICKY_FOLLOW_SETTLE_VELOCITY = 12
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
 * Critically damped SmoothDamp (Unity Game Programming Gems). Frame-rate
 * independent, no overshoot. `smoothTime` is seconds to approach the target.
 */
export function stepSmoothDamp(
  current: number,
  target: number,
  currentVelocity: number,
  dtSeconds: number,
  smoothTime = STICKY_FOLLOW_SMOOTH_TIME_S,
): { position: number; velocity: number } {
  const omega = 2 / Math.max(0.0001, smoothTime)
  const dt = Math.max(0, dtSeconds)
  if (dt === 0) return { position: current, velocity: currentVelocity }
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (currentVelocity + omega * change) * dt
  let velocity = (currentVelocity - omega * temp) * exp
  let position = target + (change + temp) * exp
  if ((target > current) === (position > target)) {
    position = target
    velocity = 0
  }
  return { position, velocity }
}

function followSettled(position: number, target: number, velocity: number): boolean {
  return Math.abs(target - position) < STICKY_FOLLOW_SETTLE_PX
    && Math.abs(velocity) < STICKY_FOLLOW_SETTLE_VELOCITY
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
  if (options.reduceMotion) {
    viewport.scrollTop = target
    return false
  }
  const dt = Math.min(STICKY_FOLLOW_MAX_DT_MS, Math.max(0, options.elapsedMs)) / 1000
  const next = stepSmoothDamp(viewport.scrollTop, target, 0, dt)
  if (followSettled(next.position, target, next.velocity)) {
    viewport.scrollTop = target
    return false
  }
  viewport.scrollTop = next.position
  return true
}

/** One follow loop for all content/viewport resizes; never restart a tween per token. */
export function createStickyScrollFollow(
  viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  options: {
    sticky: () => boolean
    reduceMotion: () => boolean
    requestFrame?: (callback: FrameRequestCallback) => number
    cancelFrame?: (id: number) => void
  },
) {
  const request = options.requestFrame ?? requestAnimationFrame
  const cancelFn = options.cancelFrame ?? cancelAnimationFrame
  let frame: number | undefined
  let target = 0
  let position: number | undefined
  let velocity = 0
  let lastTime: number | undefined
  let disposed = false

  const stopFrame = () => {
    if (frame != null) cancelFn(frame)
    frame = undefined
    lastTime = undefined
  }

  const cacheTarget = () => {
    target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  }

  const write = (next: number) => {
    position = next
    viewport.scrollTop = next
  }

  const snap = () => {
    stopFrame()
    velocity = 0
    write(target)
  }

  const follow = (time: number) => {
    frame = undefined
    if (disposed || !options.sticky()) {
      stopFrame()
      position = undefined
      velocity = 0
      return
    }
    if (options.reduceMotion()) {
      cacheTarget()
      snap()
      return
    }
    const elapsedMs = lastTime == null ? 16.67 : Math.min(STICKY_FOLLOW_MAX_DT_MS, Math.max(0, time - lastTime))
    lastTime = time
    if (position == null) position = viewport.scrollTop
    const next = stepSmoothDamp(position, target, velocity, elapsedMs / 1000)
    velocity = next.velocity
    if (followSettled(next.position, target, velocity)) {
      snap()
      return
    }
    write(next.position)
    frame = request(follow)
  }

  const ensureRunning = () => {
    if (disposed || frame != null) return
    frame = request(follow)
  }

  return {
    resize(behavior?: ScrollBehavior) {
      if (disposed) return
      cacheTarget()
      if (!options.sticky()) {
        stopFrame()
        position = undefined
        velocity = 0
        return
      }
      if (options.reduceMotion() || behavior === 'instant' || behavior === 'auto') {
        snap()
        return
      }
      if (position == null) {
        position = viewport.scrollTop
        velocity = 0
      }
      ensureRunning()
    },
    /** Composer height animation: keep the pin without a scrollHeight read. */
    nudge(delta: number) {
      if (!Number.isFinite(delta) || delta === 0) return
      if (position != null) position += delta
      target = Math.max(0, target + delta)
      viewport.scrollTop += delta
    },
    /** Drop the rAF immediately so a wheel/touch/key does not fight follow. */
    cancel() {
      stopFrame()
      position = undefined
      velocity = 0
    },
    dispose() {
      disposed = true
      stopFrame()
      position = undefined
      velocity = 0
    },
  }
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
