import { markdownToPlainText } from './markdown-to-plain-text'

export interface SourceMetadata { title?: string; description: string }
export interface SourceToolMessage { role: string; toolName?: string; content: string; toolResult?: string }
export function sourceUrlKey(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.href } catch { return value }
}
export function sourcePlainText(value: string): string {
  return markdownToPlainText(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

/** Read the actual web_search/web_fetch output contracts without making extra network requests. */
export function collectSourceMetadata(messages: SourceToolMessage[]): Map<string, SourceMetadata> {
  const metadata = new Map<string, SourceMetadata>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const text = message.toolResult || message.content
    if (/^web_?search$/i.test(message.toolName ?? '') || (!message.toolName && /^Search results for /m.test(text))) {
      const pattern = /^\d+\. \*\*(.+?)\*\*\r?\n[ \t]+(https?:\/\/\S+)\r?\n([\s\S]*?)(?=\r?\n\s*\r?\n\d+\. \*\*|$)/gm
      for (const match of text.matchAll(pattern)) {
        metadata.set(sourceUrlKey(match[2]!), { title: sourcePlainText(match[1]!), description: sourcePlainText(match[3]!).slice(0, 1200) })
      }
    }
    if (/^web_?fetch$/i.test(message.toolName ?? '') || (!message.toolName && text.startsWith('Content from '))) {
      const match = text.match(/^Content from (https?:\/\/\S+?)(?: \(asked: [^\n]*\))?:\r?\n\r?\n([\s\S]+)/)
      if (match && !metadata.get(sourceUrlKey(match[1]!))?.description) {
        metadata.set(sourceUrlKey(match[1]!), { description: sourcePlainText(match[2]!).slice(0, 1200) })
      }
    }
  }
  return metadata
}

/** Successful research belonging to this turn, independent of the answer's wording. */
export function collectTurnResearchSources(activities: ReadonlyArray<{
  type: string; status: string; toolName?: string; content?: string; toolInput?: Record<string, unknown>
}>): import('./response-sources').ResponseSource[] {
  const successful = activities.filter(activity => activity.type === 'tool' && activity.status === 'completed')
  const results = new Map<string, import('./response-sources').ResponseSource>()
  for (const activity of successful) {
    const text = activity.content ?? ''
    const metadata = collectSourceMetadata([{ role: 'tool', toolName: activity.toolName, content: text }])
    if (/^(?:web_?fetch)$/i.test(activity.toolName ?? '') && typeof activity.toolInput?.url === 'string'
      && text && !/^(?:Failed to fetch|Refused to fetch|Error\b)/i.test(text)) {
      const key = sourceUrlKey(activity.toolInput.url)
      if (!metadata.has(key)) metadata.set(key, { description: sourcePlainText(text).slice(0, 1200) })
    }
    for (const [url, detail] of metadata) {
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue
        const previous = results.get(url)
        results.set(url, { url, hostname: parsed.hostname, title: detail.title || previous?.title || parsed.hostname, description: detail.description || previous?.description })
      } catch { /* Malformed tool output is not a source. */ }
    }
  }
  return [...results.values()]
}
