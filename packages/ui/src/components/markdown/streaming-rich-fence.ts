/**
 * Fenced blocks whose rendered form differs in size from their source
 * (tables, diagrams, viewers). While one is still being written its raw source
 * would grow line by line and then collapse into the rendered block, so the
 * streaming view withholds it behind a small placeholder until it closes.
 */
const RICH_FENCES = new Set([
  'datatable', 'spreadsheet', 'mermaid', 'json', 'diff', 'latex', 'math',
  'html-preview', 'pdf-preview', 'image-preview', 'markdown-preview',
])

export interface StreamingFenceSplit {
  /** Markdown that is safe to render now. */
  body: string
  /** Language of the withheld, still-open rich fence. */
  pending?: string
}

/** Split off a trailing, unclosed rich fence. Closed fences are untouched. */
export function splitOpenRichFence(text: string): StreamingFenceSplit {
  if (!text.includes('```') && !text.includes('~~~')) return { body: text }
  let open: { char: string; length: number; language: string; start: number } | undefined
  let offset = 0
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const run = fence[1]!
      if (!open) {
        open = { char: run[0]!, length: run.length, language: (fence[2] ?? '').trim().split(/\s+/)[0]!.toLowerCase(), start: offset }
      } else if (run[0] === open.char && run.length >= open.length && !(fence[2] ?? '').trim()) {
        open = undefined
      }
    }
    offset += line.length + 1
  }
  if (!open || !RICH_FENCES.has(open.language)) return { body: text }
  return { body: text.slice(0, open.start), pending: open.language }
}
