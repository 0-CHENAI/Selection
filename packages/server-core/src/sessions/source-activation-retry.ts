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
  const text = sanitizeUserMessageForRetry(input.originalMessage || input.lastUserMessage || '').trim()
  const attachments = input.attachments?.length ? input.attachments : undefined
  if (!text && !attachments) return null
  return { text, attachments }
}

export function sourceActivationRetryMessage(text: string, sourceSlug: string): string {
  return text ? `${text}\n\n[${sourceSlug} activated]` : `[${sourceSlug} activated]`
}
