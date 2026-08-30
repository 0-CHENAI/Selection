import { isImeComposingEvent } from '@/components/ui/ime-input-guards'

interface ProjectNameKeyEvent {
  key?: string
  isComposing?: boolean
  keyCode?: number
  which?: number
}

/**
 * Project creation accepts Enter only after IME composition has fully ended.
 * The explicit composition state covers React/browser event-order differences,
 * while native isComposing and keyCode 229 cover the platform fallbacks.
 */
export function shouldSubmitProjectNameOnKeyDown(
  event: ProjectNameKeyEvent,
  canSubmit: boolean,
  isComposing: boolean,
): boolean {
  return event.key === 'Enter'
    && canSubmit
    && !isImeComposingEvent(event, isComposing)
}
