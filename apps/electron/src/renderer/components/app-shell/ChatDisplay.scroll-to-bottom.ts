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
