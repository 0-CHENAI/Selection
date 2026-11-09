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

/**
 * A tail line is unsafe to publish while streaming when its block type can
 * still change (fence/list/quote/table/indented code) or when it can rewrite
 * an earlier block (setext/table delimiter). Classification only depends on
 * the line's beginning, which append-only growth cannot change after the line
 * has real content — so published lines never retract (#54 prefix stability).
 */
function isUnsafeStreamingLine(line: string): boolean {
  if (/^(?: {4,}|\t)/.test(line)) return true
  const trimmed = line.trimStart()
  if (!trimmed) return false
  // Fence, or 1-2 backticks that may still grow into a fence.
  if (/^(?:`{3,}|~{3,})/.test(trimmed) || /^`{1,2}$/.test(trimmed)) return true
  // List markers, or a bare marker/digit prefix that may grow into one.
  if (/^(?:[-*+] |\d+[.)] )/.test(trimmed) || /^(?:[-*+]|\d+[.)]?)$/.test(trimmed)) return true
  // Blockquote or a pipe-led table row.
  if (/^[>|]/.test(trimmed)) return true
  // Setext underline, thematic break or GFM table delimiter.
  if (/^[-=:| ]+$/.test(trimmed) && /[-=]/.test(trimmed)) return true
  return false
}

/** Offset of the first unsafe tail line, or -1 when the whole tail is prose. */
function firstUnsafeTailLineOffset(tail: string): number {
  let offset = 0
  for (const line of tail.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (isUnsafeStreamingLine(line.replace(/\r?\n$/, ''))) return offset
    offset += line.length
  }
  return -1
}

/**
 * Publish complete Markdown blocks as they arrive and let ordinary prose tails
 * grow token-by-token so the reveal animation stays alive. Only structurally
 * ambiguous tails (fences, lists, tables, quotes, indented code) are held
 * until their block finishes.
 */
export function streamingResponseBody(text: string, streaming: boolean): string {
  if (!streaming) return text
  const committed = completedParagraphs(text, true)
  const tail = text.slice(committed.length)
  if (!tail.trim()) return committed
  const unsafeAt = firstUnsafeTailLineOffset(tail)
  return unsafeAt === -1 ? text : committed + tail.slice(0, unsafeAt)
}
