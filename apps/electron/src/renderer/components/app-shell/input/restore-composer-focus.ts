import type * as React from 'react'

export interface ComposerFocusTarget {
  focus: () => void
}

type FocusTargetRef = React.RefObject<ComposerFocusTarget | null>
type ScheduleFocus = (callback: () => void) => void

const scheduleAfterOverlayFocus = (callback: () => void) => {
  window.setTimeout(callback, 0)
}

/**
 * Restore typing focus after a picker closes.
 *
 * Overlay libraries commonly restore focus to their trigger as part of the
 * close sequence. Deferring by one task lets that finish first, then moves
 * focus back to the composer so a focused trigger cannot reopen its tooltip.
 */
export function restoreComposerFocus(
  targetRef: FocusTargetRef,
  schedule: ScheduleFocus = scheduleAfterOverlayFocus,
): void {
  schedule(() => targetRef.current?.focus())
}
