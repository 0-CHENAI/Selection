/**
 * Chain-of-thought that leaked into a visible text part.
 *
 * Some OpenAI-compatible gateways (ORDER aliases such as Laufry) register the
 * model with reasoning disabled, then still emit DeepSeek-style thinking inside
 * the normal text stream: either `<think>…</think>` or a bare `</think>` with
 * no opening tag. This is not the marker-v1 answer boundary and must not parse
 * `<<<FINAL_ANSWER>>>`.
 */

const OPEN = '<think>'
const CLOSE = '</think>'

export interface SplitThinkDelimiter {
  thinking: string
  answer: string
}

function fenceOf(line: string): { char: string; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const run = match[1]!
  return { char: run[0]!, length: run.length }
}

/** Index of the first `</think>` that is not inside a fenced code block. */
export function indexOfThinkClose(text: string): number {
  let fence: { char: string; length: number } | null = null
  let offset = 0
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (!fence) {
      const at = line.indexOf(CLOSE)
      if (at >= 0) return offset + at
    }
    const next = fenceOf(line)
    if (next) {
      if (!fence) fence = next
      else if (fence.char === next.char && next.length >= fence.length && !line.trim().slice(next.length).trim()) fence = null
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0)
  }
  return -1
}

/**
 * Split leaked thinking from the visible answer.
 * Returns null when the text has no bare or wrapped close delimiter.
 */
export function splitThinkDelimiter(text: string): SplitThinkDelimiter | null {
  const closeAt = indexOfThinkClose(text)
  if (closeAt < 0) return null
  let thinking = text.slice(0, closeAt)
  const answer = text.slice(closeAt + CLOSE.length).replace(/^\s+/, '')
  thinking = thinking.replace(/^\s*<think>\s*/i, '').trim()
  if (!thinking && !answer.trim()) return null
  return { thinking, answer }
}

/**
 * Text to keep on the visible answer after a leak has been routed to thinking.
 * An unclosed `<think>` whose body was already streamed must not be copied
 * back onto the answer by the terminal message.
 */
export function visibleTextAfterThinkLeak(text: string, thinkingAlreadyEmitted: boolean): SplitThinkDelimiter {
  const split = splitThinkDelimiter(text)
  if (split) return { thinking: thinkingAlreadyEmitted ? '' : split.thinking, answer: split.answer }
  if (thinkingAlreadyEmitted) {
    const open = text.search(/<think>/i)
    if (open >= 0) return { thinking: '', answer: text.slice(0, open).trim() }
  }
  return { thinking: '', answer: text }
}

export type ThinkLeakPiece =
  | { kind: 'thinking'; text: string; done?: boolean }
  | { kind: 'text'; text: string }

/**
 * Streaming splitter for a leading `<think>` block.
 *
 * Ordinary text is released immediately so the reply still streams. A leading
 * `<think>` is held only until the tag is unambiguous, then routed as thinking
 * until `</think>`. A bare close tag that arrives before any text was released
 * is split the same way. Once visible text has been released, later bytes pass
 * through; presentation peels a bare `</think>` out of the accumulated body.
 */
export class ThinkLeakBuffer {
  private pending = ''
  private mode: 'detect' | 'thinking' | 'text' = 'detect'

  reset(): void {
    this.pending = ''
    this.mode = 'detect'
  }

  push(delta: string): ThinkLeakPiece[] {
    if (!delta) return []
    if (this.mode === 'text') return [{ kind: 'text', text: delta }]
    this.pending += delta
    return this.drain(false)
  }

  finish(): ThinkLeakPiece[] {
    return this.drain(true)
  }

  private drain(flush: boolean): ThinkLeakPiece[] {
    const out: ThinkLeakPiece[] = []
    for (;;) {
      if (this.mode === 'thinking') {
        const close = this.pending.indexOf(CLOSE)
        if (close < 0) {
          if (flush) {
            if (this.pending) out.push({ kind: 'thinking', text: this.pending })
            out.push({ kind: 'thinking', text: '', done: true })
            this.pending = ''
            this.mode = 'text'
          } else {
            const safe = releaseExceptPartial(this.pending, CLOSE)
            if (safe) out.push({ kind: 'thinking', text: safe })
            this.pending = this.pending.slice(safe.length)
          }
          break
        }
        if (close > 0) out.push({ kind: 'thinking', text: this.pending.slice(0, close) })
        out.push({ kind: 'thinking', text: '', done: true })
        this.pending = this.pending.slice(close + CLOSE.length).replace(/^\s+/, '')
        this.mode = 'text'
        continue
      }

      if (!this.pending) break
      const lead = this.pending.trimStart()
      const maybeOpen = lead.length < OPEN.length && OPEN.startsWith(lead)
      if (!flush && maybeOpen && !(lead.length === 0 && this.pending.length > 32)) break
      if (lead.startsWith(OPEN)) {
        this.pending = lead.slice(OPEN.length).replace(/^\s+/, '')
        this.mode = 'thinking'
        continue
      }
      const closeAt = indexOfThinkClose(this.pending)
      if (closeAt >= 0) {
        const thinking = this.pending.slice(0, closeAt).replace(/^\s*<think>\s*/i, '').trim()
        const answer = this.pending.slice(closeAt + CLOSE.length).replace(/^\s+/, '')
        if (thinking) out.push({ kind: 'thinking', text: thinking })
        out.push({ kind: 'thinking', text: '', done: true })
        this.pending = ''
        this.mode = 'text'
        if (answer) out.push({ kind: 'text', text: answer })
        break
      }
      out.push({ kind: 'text', text: this.pending })
      this.pending = ''
      this.mode = 'text'
      break
    }
    return out
  }
}

function releaseExceptPartial(buffer: string, tag: string): string {
  const max = Math.min(buffer.length, tag.length - 1)
  for (let size = max; size > 0; size--) {
    if (tag.startsWith(buffer.slice(buffer.length - size))) return buffer.slice(0, buffer.length - size)
  }
  return buffer
}
