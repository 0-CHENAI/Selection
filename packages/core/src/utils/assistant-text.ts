/**
 * Visible assistant-body helpers (#81).
 *
 * A truncated `text_complete` (often just `|`) must not replace a longer
 * streamed body, and a pipe-only stub must not render as a finished card.
 */

export function hasRenderableAssistantText(text: string | undefined | null): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return !/^[\s|]+$/.test(trimmed)
}

/**
 * Pick assistant body text from complete + streamed fallbacks.
 *
 * `candidates[0]` is the SDK complete payload and wins when it is real
 * content. A longer fallback that still starts with that payload is treated
 * as truncation recovery. Pipe-only / empty completes fall through to the
 * first renderable fallback.
 */
export function preferRicherAssistantText(
  ...candidates: Array<string | undefined | null>
): string {
  const present = candidates.filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (present.length === 0) return ''

  const primary = present[0]
  for (const candidate of present) {
    if (candidate.length > primary.length && candidate.startsWith(primary)) {
      return candidate
    }
  }

  if (hasRenderableAssistantText(primary)) return primary
  return present.find(hasRenderableAssistantText) ?? primary
}
