export type CompletionVisibleMessage = {
  role: string
  hidden?: boolean
  isQueued?: boolean
  isIntermediate?: boolean
}

/**
 * A trailing `complete` event is not always success. Pi still emits
 * `agent_end` after a terminal `message_end` error; only this turn's
 * last visible message (after the latest user prompt) decides the outcome.
 */
export function completionStopReason(
  messages: readonly CompletionVisibleMessage[],
): 'complete' | 'error' {
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.hidden || message.isQueued) continue
    if (message.role === 'user') {
      lastUserIndex = i
      break
    }
  }

  for (let i = messages.length - 1; i > lastUserIndex; i--) {
    const message = messages[i]
    if (message.hidden || message.isQueued || message.isIntermediate) continue
    return message.role === 'error' ? 'error' : 'complete'
  }
  return 'complete'
}
