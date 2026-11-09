import type { AnnotationV1 } from '@craft-agent/core'
import { asRecord, getAnnotationFollowUpState, type AnnotationFollowUpState } from './follow-up-state'

export type AnnotationChipInteraction = {
  state: AnnotationFollowUpState
  clickable: boolean
  tooltipOnly: boolean
  openMode: 'view'
}

/**
 * Unified annotation chip behavior:
 * - legacy sent follow-up chips are tooltip-only
 * - tracked feedback stays accessible for its revision result
 * - pending/unsent chips open annotation detail in view mode
 */
export function getAnnotationChipInteraction(annotation?: AnnotationV1 | null): AnnotationChipInteraction {
  const state = annotation ? getAnnotationFollowUpState(annotation) : 'none'
  const followUp = asRecord(annotation?.meta?.followUp)
  const tracked = typeof followUp?.requestMessageId === 'string' && followUp.requestMessageId.length > 0
  const isSent = state === 'sent' && !tracked

  return {
    state,
    clickable: !isSent,
    tooltipOnly: isSent,
    openMode: 'view',
  }
}

export function isAnnotationChipClickable(annotation?: AnnotationV1 | null): boolean {
  return getAnnotationChipInteraction(annotation).clickable
}

export function getAnnotationChipOpenMode(): 'view' {
  return 'view'
}

/**
 * Mouse-up events that originate from annotation index badges must not trigger
 * text-selection follow-up flows. This keeps chip clicks and text selection
 * behavior consistent across inline and fullscreen renderers.
 */
export function shouldIgnoreSelectionMouseUpTarget(target: EventTarget | null): boolean {
  const targetElement = target instanceof Element ? target : null
  return Boolean(targetElement?.closest('[data-ca-annotation-index]'))
}
