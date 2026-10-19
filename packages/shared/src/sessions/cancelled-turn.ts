/** A persisted user turn plus the options that were active when it was sent. */
export interface CancelledTurnMessage {
  id: string
  role: string
  content?: unknown
  statusType?: string
  hidden?: boolean
  isQueued?: boolean
}

/**
 * Explicit Stop writes an info row. Older sessions only have the English
 * content; new ones also carry statusType so the UI can localize it.
 */
export function isCancelledTurnMarker(message: {
  role?: string
  content?: unknown
  statusType?: string
}): boolean {
  return message.role === 'info' && (
    message.statusType === 'turn_cancelled' || message.content === 'Response interrupted'
  )
}

/**
 * The latest visible user message can be retried only when Stop cancelled it
 * and nothing newer has been sent.
 */
export function findRetryableCancelledUser<T extends CancelledTurnMessage>(messages: readonly T[]): T | null {
  let lastUser: T | null = null
  let lastUserIndex = -1
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    if (message.hidden || message.role !== 'user' || message.isQueued) continue
    lastUser = message
    lastUserIndex = index
  }
  if (!lastUser || lastUserIndex < 0) return null
  for (let index = lastUserIndex + 1; index < messages.length; index++) {
    const message = messages[index]!
    if (message.hidden) continue
    if (isCancelledTurnMarker(message)) return lastUser
  }
  return null
}
