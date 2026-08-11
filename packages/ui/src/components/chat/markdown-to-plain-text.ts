/**
 * Convert markdown source to plain text for clipboard copy.
 * Preserves readable structure (newlines, list markers) without markdown syntax.
 */

export function markdownToPlainText(text: string): string {
  if (!text) return ''

  return text
    // Fenced code blocks → keep body only
    .replace(/```[\w+-]*\n?([\s\S]*?)```/g, '$1')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Headers
    .replace(/^#{1,6}\s+/gm, '')
    // Bold / italic / strikethrough (order: triple → double → single)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // Images then links (keep alt/label text)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Autolink-style <url>
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    // Blockquotes
    .replace(/^>\s?/gm, '')
    // Unordered lists
    .replace(/^[\t ]*[-*+]\s+/gm, '• ')
    // Ordered lists — keep number
    .replace(/^[\t ]*(\d+)\.\s+/gm, '$1. ')
    // Horizontal rules
    .replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    // Table rows → tab-separated cells
    .replace(/^\|(.+)\|$/gm, (_, inner: string) =>
      inner
        .split('|')
        .map((c) => c.trim())
        .join('\t'),
    )
    // Table separator rows
    .replace(/^\|?[\t :-]+\|[\t |:-]*$/gm, '')
    // Collapse 3+ blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
