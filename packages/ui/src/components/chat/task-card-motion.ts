export interface TaskCardBox {
  width: number
  height: number
}

export type TaskCardMotionDirection = 'collapse' | 'expand'

const PANEL_SHIFT_PX = 8
const CAPSULE_SHIFT_PX = 8

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * Progress is 1 at the panel and 0 at the capsule.
 * The shell height is `capsule + progress * (panel - capsule)`.
 * Panel text is down to 0.2 once a single line would be clipped, and fully
 * gone once the shell reaches 60% of the panel height. It is also gone before
 * the capsule starts to appear (the last 20% of the travel).
 */
export function panelContentOpacity(progress: number, panelHeight: number, capsuleHeight: number): number {
  const span = panelHeight - capsuleHeight
  const atSixtyPercentHeight = span > 1 ? clamp01((panelHeight * 0.6 - capsuleHeight) / span) : 0
  const atLineClip = span > 1 ? clamp01(1 - 16 / span) : 0.85
  const gone = Math.max(atSixtyPercentHeight, 0.2)
  const faint = Math.max(atLineClip, gone)
  const value = clamp01(progress)
  if (value <= gone) return 0
  if (value >= faint) {
    if (faint >= 1) return value >= 1 ? 1 : 0.2
    return 0.2 + 0.8 * (value - faint) / (1 - faint)
  }
  return 0.2 * (value - gone) / (faint - gone)
}

/** Capsule content stays invisible until the shell is 80% of the way to the capsule. */
export function capsuleContentOpacity(progress: number): number {
  const value = clamp01(progress)
  if (value >= 0.2) return 0
  return (0.2 - value) / 0.2
}

export function taskCardShellSize(progress: number, panel: TaskCardBox, capsule: TaskCardBox): TaskCardBox {
  const value = clamp01(progress)
  return {
    width: capsule.width + value * (panel.width - capsule.width),
    height: capsule.height + value * (panel.height - capsule.height),
  }
}

/**
 * Resting shell when the step count changes width.
 * Linear in the measured box. Clamped so a spring sample cannot overshoot into a scaled pill.
 */
export function taskCardRestingBox(from: TaskCardBox, to: TaskCardBox, t: number): TaskCardBox {
  const value = clamp01(t)
  return {
    width: from.width + (to.width - from.width) * value,
    height: from.height + (to.height - from.height) * value,
  }
}

/**
 * Scroll button growing out from behind a pill that is already on screen.
 * t = 0 is a zero-width clip on the pill's right edge, fully transparent.
 * That pose matches "no button": nothing sticks out, and the group center
 * does not move. t = 1 is the full control plus the gap.
 * `span` is the clip width (control + gap). A circle pinned to the clip's
 * right edge therefore starts tucked behind the pill and slides out.
 * `pillShift` is how far translateX(-50%) on that live span moves the pill
 * left — half the added width — so the group stays centered on the same spring.
 */
export function taskCardScrollDockFrame(t: number, button: number, gap: number): {
  width: number
  opacity: number
  margin: number
  span: number
  pillShift: number
} {
  const value = clamp01(t)
  const width = button * value
  const margin = gap * value
  const span = width + margin
  return {
    width,
    opacity: value,
    margin,
    span,
    pillShift: span === 0 ? 0 : -span / 2,
  }
}

export function taskCardContentMotion(input: {
  progress: number
  panel: TaskCardBox
  capsule: TaskCardBox
  direction: TaskCardMotionDirection
  reduceMotion?: boolean
}): {
  width: number
  height: number
  panelOpacity: number
  capsuleOpacity: number
  panelY: number
  capsuleY: number
  panelBlur: number
  capsuleBlur: number
} {
  const progress = input.reduceMotion ? (input.progress >= 0.5 ? 1 : 0) : clamp01(input.progress)
  const size = taskCardShellSize(progress, input.panel, input.capsule)
  const panelOpacity = input.reduceMotion
    ? (progress >= 0.5 ? 1 : 0)
    : panelContentOpacity(progress, input.panel.height, input.capsule.height)
  const capsuleOpacity = input.reduceMotion
    ? (progress >= 0.5 ? 0 : 1)
    : capsuleContentOpacity(progress)
  if (input.reduceMotion) {
    return { ...size, panelOpacity, capsuleOpacity, panelY: 0, capsuleY: 0, panelBlur: 0, capsuleBlur: 0 }
  }
  const panelFade = 1 - panelOpacity
  const capsuleFade = 1 - capsuleOpacity
  if (input.direction === 'collapse') {
    return {
      ...size,
      panelOpacity,
      capsuleOpacity,
      panelY: panelFade * PANEL_SHIFT_PX,
      capsuleY: 0,
      panelBlur: panelFade * 4,
      capsuleBlur: capsuleFade * 4,
    }
  }
  return {
    ...size,
    panelOpacity,
    capsuleOpacity,
    panelY: 0,
    capsuleY: -capsuleFade * CAPSULE_SHIFT_PX,
    panelBlur: panelFade * 4,
    capsuleBlur: capsuleFade * 4,
  }
}
