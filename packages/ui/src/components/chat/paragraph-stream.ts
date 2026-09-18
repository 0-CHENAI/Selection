import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { remarkLiteralTildes } from '../markdown/remark-literal-tildes'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkLiteralTildes)

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
  // Lists, blockquotes and indented code may continue across blank lines. Keep the whole
  // trailing container until a subsequent top-level block proves its boundary.
  if (boundary > 0) {
    const last = parser.parse(text).children.at(-1)
    const lastStart = last?.position?.start.offset ?? boundary
    const indentedCode = last?.type === 'code'
      && !/^ {0,3}(`{3,}|~{3,})/.test(text.slice(lastStart))
    if (last && (last.type === 'list' || last.type === 'blockquote' || indentedCode)) {
      boundary = Math.min(boundary, last.position?.start.offset ?? boundary)
    }
  }
  return text.slice(0, boundary)
}

/** Publish complete Markdown blocks as they arrive, without a replay queue. */
export function streamingResponseBody(text: string, streaming: boolean): string {
  return completedParagraphs(text, streaming)
}
