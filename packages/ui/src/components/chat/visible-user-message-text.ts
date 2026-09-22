import type { ContentBadge } from '@craft-agent/core'
import { sanitizeUserMessageForDisplay } from '@craft-agent/shared/agent/user-message-sanitize'
import { markdownToPlainText } from './markdown-to-plain-text'

function isHiddenCopyRange(badge: ContentBadge): boolean {
  return badge.type === 'context'
}

/** Visible user-message source: hide context / edit_request ranges, then sanitize. */
export function getVisibleUserMessageSource(
  content: string,
  badges: readonly ContentBadge[] = [],
): string {
  if (!content) return ''

  const hidden = badges
    .filter(isHiddenCopyRange)
    .map((badge) => {
      const start = Math.max(0, Math.min(badge.start, content.length))
      const end = Math.max(start, Math.min(badge.end, content.length))
      return { start, end }
    })
    .filter((range) => range.end > range.start)
    .sort((a, b) => b.start - a.start)

  let visible = content
  for (const range of hidden) {
    visible = visible.slice(0, range.start) + visible.slice(range.end)
  }
  return sanitizeUserMessageForDisplay(visible).trim()
}

/** Clipboard payload for a user bubble: visible markdown as plain text. */
export function getUserMessageCopyText(
  content: string,
  badges: readonly ContentBadge[] = [],
): string {
  return markdownToPlainText(getVisibleUserMessageSource(content, badges))
}
