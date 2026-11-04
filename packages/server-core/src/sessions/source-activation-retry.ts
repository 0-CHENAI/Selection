import { sanitizeUserMessageForRetry } from '@craft-agent/shared/agent'

export interface SourceActivationRetry {
  text: string
  attachments?: unknown[]
}

/**
 * Build the auto-retry payload after a mid-turn source activation.
 * Attachment-only turns have an empty originalMessage; fall back to the last
 * user text and the attachments from the turn that triggered activation.
 */
export function resolveSourceActivationRetry(input: {
  originalMessage?: string
  lastUserMessage?: string
  attachments?: unknown[]
}): SourceActivationRetry | null {
  const originalText = sanitizeUserMessageForRetry(input.originalMessage || '').trim()
  const text = originalText || sanitizeUserMessageForRetry(input.lastUserMessage || '').trim()
  // Re-attach only for attachment-only turns. Text turns already have the
  // images in history; repeating lastSentAttachments on every activation
  // resends them.
  const attachments = !originalText && input.attachments?.length ? input.attachments : undefined
  if (!text && !attachments) return null
  return { text, attachments }
}

export function sourceActivationRetryMessage(text: string, sourceSlug: string): string {
  return text ? `${text}\n\n[${sourceSlug} activated]` : `[${sourceSlug} activated]`
}
