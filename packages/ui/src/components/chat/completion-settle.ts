export const COMPLETION_ACTION_DELAY_MS = 600
const SETTLE_GAP_MS = 120
const MAX_WAIT_MS = 3000

/** Wait for finite body animations, including CSS height transitions, to settle. */
export function waitForResponseSettled(root: HTMLElement | null, done: () => void) {
  const start = performance.now()
  let quietSince: number | undefined
  let frame: number
  const check = () => {
    const now = performance.now()
    const running = root?.getAnimations?.({ subtree: true }).some(animation => {
      const timing = animation.effect?.getComputedTiming()
      return (animation.pending || animation.playState === 'running')
        && timing != null && Number.isFinite(timing.endTime)
    }) ?? false
    if (running) quietSince = undefined
    else quietSince ??= now
    if (now - start >= MAX_WAIT_MS || (
      now - start >= COMPLETION_ACTION_DELAY_MS
      && quietSince != null && now - quietSince >= SETTLE_GAP_MS
    )) {
      done()
      return
    }
    frame = requestAnimationFrame(check)
  }
  frame = requestAnimationFrame(check)
  return () => cancelAnimationFrame(frame)
}
