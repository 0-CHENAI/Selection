/**
 * Coerce untrusted composer/draft values into plain text.
 *
 * The renderer normally stores draft text as a string, but installed builds can
 * encounter stale or malformed persisted values (for example an entire draft
 * object, or an object in the `text` field). Keep input call sites defensive so
 * `.trim()` and rich-text rendering never receive a non-string value.
 */
export function coerceInputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value instanceof String) return value.toString()

  if (typeof value === 'object') {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text
  }

  return ''
}

/**
 * Combine an existing input draft with text being restored (e.g. the last
 * user message put back on Stop). Appends with a blank line so a half-typed
 * draft isn't clobbered; returns the non-empty side when the other is empty.
 */
export function appendRestoredInput(existing: string | undefined, restored: string | undefined): string {
  const existingText = coerceInputText(existing)
  const restoredText = coerceInputText(restored)
  if (!restoredText) return existingText
  return existingText ? `${existingText}\n\n${restoredText}` : restoredText
}

interface StoppedPromptCandidate {
  role: string
  content: unknown
  isQueued?: boolean
  hidden?: boolean
}

/**
 * Return the prompt that an explicit Stop should put back in the composer.
 *
 * A hidden non-queued user message means the active turn is an internal
 * continuation. In that case we intentionally return nothing instead of
 * skipping backward and restoring an older, already-submitted user prompt.
 */
interface LiveGenerationCandidate {
  role?: string
  hidden?: boolean
  isStreaming?: boolean
  isPending?: boolean
  isIntermediate?: boolean
  content?: unknown
}

/**
 * True while a visible turn is still generating. Composer submits in this
 * state belong in the queue, not the transcript (#22, #23).
 */
export function sessionHasLiveGeneration(
  session: { isProcessing?: boolean; messages?: readonly LiveGenerationCandidate[] } | null | undefined,
): boolean {
  if (!session) return false
  if (session.isProcessing) return true
  return (session.messages ?? []).some(message =>
    !message.hidden && (
      (message.role === 'assistant' && (message.isStreaming || message.isPending || message.isIntermediate))
      || message.role === 'status'
    ),
  )
}

export function getRestorableStoppedPrompt(messages: readonly StoppedPromptCandidate[]): string {
  const latestUserMessage = messages.findLast(message =>
    message.role === 'user' && !message.isQueued
  )
  if (!latestUserMessage || latestUserMessage.hidden) return ''
  return coerceInputText(latestUserMessage.content)
}
