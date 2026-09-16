import type { ContentBadge } from '@craft-agent/core'

export interface ConversationNavigationTitlePreview {
  content: string
  badges: ContentBadge[]
}

/**
 * Keep the navigation tooltip title to the first logical line of the user
 * message. Badge offsets are clipped to that line so inline source/file
 * badges still render without pulling later prompt paragraphs into the card.
 */
export function getConversationNavigationTitlePreview(
  content: string,
  badges: ContentBadge[],
): ConversationNavigationTitlePreview {
  const newlineIndex = content.search(/[\r\n]/)
  const firstLineEnd = newlineIndex === -1 ? content.length : newlineIndex
  const firstLine = content.slice(0, firstLineEnd)

  const firstLineBadges = badges
    .filter(badge => badge.start < firstLineEnd && badge.end > 0)
    .map(badge => ({
      ...badge,
      start: Math.max(0, badge.start),
      end: Math.min(firstLineEnd, badge.end),
    }))
    .filter(badge => badge.end > badge.start)

  return { content: firstLine, badges: firstLineBadges }
}
