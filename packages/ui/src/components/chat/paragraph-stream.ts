import { unified } from 'unified'
import remarkParse from 'remark-parse'

const parser = unified().use(remarkParse)

/** Only mount complete incoming paragraphs; never reserve space for the tail. */
export function completedParagraphs(text: string, streaming: boolean): string {
  if (!streaming) return text
  let boundary = 0
  let offset = 0
  let fence: { marker: string; length: number } | undefined
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\r?\n)?$/.exec(line)
    if (match) {
      const marker = match[1]!
      if (!fence) fence = { marker: marker[0]!, length: marker.length }
      else if (marker[0] === fence.marker && marker.length >= fence.length && !match[2]?.trim()) fence = undefined
    }
    offset += line.length
    if (!fence && /^\s*\n$/.test(line)) boundary = offset
  }
  // Lists and blockquotes may continue across blank lines. Keep the whole
  // trailing container until a subsequent top-level block proves its boundary.
  if (boundary > 0) {
    const last = parser.parse(text).children.at(-1)
    if (last && (last.type === 'list' || last.type === 'blockquote')) {
      boundary = Math.min(boundary, last.position?.start.offset ?? boundary)
    }
  }
  return text.slice(0, boundary)
}

function isUnsafeStreamingTail(tail: string): boolean {
  const start = tail.match(/[^\s].*/)?.[0] ?? ''
  return /^(?:`{3,}|~{3,}|(?:[-*+] |\d+\. |>)|\|| {4}|\t)/.test(start)
}

/**
 * Keep incomplete lists / fences / tables out of Markdown so they cannot
 * remount earlier blocks, but let ordinary prose grow token-by-token.
 */
export function streamingResponseBody(text: string, streaming: boolean): string {
  if (!streaming) return text
  const committed = completedParagraphs(text, true)
  const tail = text.slice(committed.length)
  if (!tail.trim() || isUnsafeStreamingTail(tail)) return committed
  return committed + tail
}
