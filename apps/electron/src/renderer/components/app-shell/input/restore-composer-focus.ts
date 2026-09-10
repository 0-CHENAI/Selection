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
 * close sequence, so the caret is handed back one task later. That timer cannot
 * outrun every trigger restore: Radix runs `onCloseAutoFocus` when the exit
 * animation unmounts the content, which happens after this callback. Overlays
 * that close that late must block their own restore with
 * `keepComposerFocusOnPickerClose`.
 */
export function restoreComposerFocus(
  targetRef: FocusTargetRef,
  schedule: ScheduleFocus = scheduleAfterOverlayFocus,
): void {
  schedule(() => targetRef.current?.focus())
}

/**
 * Keep typing focus in the composer when an overlay-backed picker closes.
 *
 * Radix menus and popovers hand focus back to their trigger from
 * `onCloseAutoFocus`. That runs once the exit animation unmounts the content —
 * later than the deferred hand-off above — and it costs twice in the composer:
 * the trigger takes the caret out of the input (#26), and `TooltipTrigger`
 * opens the trigger's tooltip from that same focus event. The pointer has left
 * the button by then, so no pointer-leave or blur event remains to close the
 * tooltip and it stays on screen (#332). The picker's close handler already owns
 * the caret, so refuse the trigger's restore.
 */
export function keepComposerFocusOnPickerClose(event: { preventDefault: () => void }): void {
  event.preventDefault()
}
