/**
 * Strip internal artifacts that must never appear in the user-facing transcript.
 *
 * - `<system-reminder>…</system-reminder>` is injected for the model only
 *   (e.g. previous-turn interruption context). It must not be stored or shown.
 * - Trailing `[slug activated]` is an auto-retry marker; keep it out of display
 *   so activation feedback can live in status/events instead of polluting bubbles.
 */

export const INTERRUPTION_SYSTEM_REMINDER =
  '<system-reminder>The previous assistant response was interrupted by the user and may be incomplete. Do not repeat or continue the interrupted response unless asked. Focus on the new message above.</system-reminder>'

const SYSTEM_REMINDER_RE = /\n*\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/gi
const SOURCE_ACTIVATED_SUFFIX_RE = /\n*\[[^\n\]]+ activated\]\s*$/i

/** Remove all <system-reminder> blocks (case-insensitive, multiline). */
export function stripSystemReminderBlocks(text: string): string {
  if (!text || !text.includes('system-reminder')) return text
  return text.replace(SYSTEM_REMINDER_RE, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Remove trailing `[source-slug activated]` auto-retry marker. */
export function stripSourceActivationSuffix(text: string): string {
  if (!text || !text.includes('activated]')) return text
  return text.replace(SOURCE_ACTIVATED_SUFFIX_RE, '').trim()
}

/**
 * Sanitize user message content for UI / transcript.
 * Does not remove intentional user text that happens to look similar unless it
 * matches the exact internal patterns above.
 */
export function sanitizeUserMessageForDisplay(text: string): string {
  return stripSourceActivationSuffix(stripSystemReminderBlocks(text))
}

/**
 * Content that should be captured for source-activation auto-retry:
 * user intent only — no system reminders, no prior activation suffixes.
 */
export function sanitizeUserMessageForRetry(text: string): string {
  return sanitizeUserMessageForDisplay(text)
}
