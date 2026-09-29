import type { ContentBadge } from '@craft-agent/core'
import { sanitizeUserMessageForDisplay } from '@craft-agent/shared/agent/user-message-sanitize'
import { markdownToPlainText } from './markdown-to-plain-text'
import { parseArtifactRestoreDisplay } from './artifact-restore-display'

function isHiddenCopyRange(badge: ContentBadge): boolean {
  return badge.type === 'context'
}

/** Visible user-message source: hide context / edit_request ranges, then sanitize. */
export function getVisibleUserMessageSource(
  content: string,
  badges: readonly ContentBadge[] = [],
): string {
  if (!content) return ''

  // The copy action should match the visible restore summary, not copy the
  // hidden artifact ID and version-check payload from the persisted message.
  if (badges.length === 0) {
    const restore = parseArtifactRestoreDisplay(content)
    if (restore) {
      const action = restore.fromOrdinal === undefined
        ? `恢复文件 ${restore.path} 至第 ${restore.ordinal} 版`
        : `恢复文件 ${restore.path}：第 ${restore.fromOrdinal} 版 → 第 ${restore.ordinal} 版`
      return restore.summary ? `${action}\n${restore.summary}` : action
    }
  }

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
