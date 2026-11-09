import { navigate, routes } from '@/lib/navigate'
import { dispatchFocusInputEvent } from '@/components/app-shell/input/focus-input-events'
import type { Message } from '../../../shared/types'

export type ErrorMessageAction = NonNullable<Message['errorActions']>[number]

export interface HandleErrorMessageActionOptions {
  sessionId?: string
  onOpenUrl?: (url: string) => void
  onOpenSettings?: () => void
  onRetryFocus?: (detail?: { sessionId?: string }) => void
  onRetry?: () => void
}

export function canRetryErrorInPlace(messages: Message[], errorMessageId: string): boolean {
  const errorIndex = messages.findIndex(message => message.id === errorMessageId)
  if (errorIndex === -1) return false

  const userIndex = messages.findLastIndex((message, index) => (
    index < errorIndex && message.role === 'user' && !message.hidden
  ))
  return userIndex !== -1 && userIndex === messages.findLastIndex(message => message.role === 'user')
}

/**
 * Execute an error-message action using the app's canonical handlers.
 *
 * Retry intentionally routes through the session-scoped focus event system
 * instead of querying the DOM, which is fragile in multi-panel mode and
 * no longer matches the RichTextInput implementation.
 */
export function handleErrorMessageAction(
  action: ErrorMessageAction,
  {
    sessionId,
    onOpenUrl,
    onOpenSettings = () => navigate(routes.view.settings()),
    onRetryFocus = dispatchFocusInputEvent,
    onRetry,
  }: HandleErrorMessageActionOptions = {},
): void {
  if (action.action === 'open_url') {
    if (action.url && onOpenUrl) {
      onOpenUrl(action.url)
    }
    return
  }

  if (action.action === 'settings') {
    onOpenSettings()
    return
  }

  if (action.action === 'retry') {
    if (onRetry) {
      onRetry()
    } else {
      onRetryFocus({ sessionId })
    }
  }
}
