import type { AgentEvent } from '@craft-agent/core/types'

export const FINAL_ANSWER_MARKER = '<<<FINAL_ANSWER>>>'
export const MARKER_ANSWER_PROMPT = `Use marker-v1 for this reply. Before the marker, write only brief progress notes when actually using tools, never an answer draft. If no tools are needed, start immediately with the marker. After all tools finish, emit <<<FINAL_ANSWER>>> alone on a line, then only the standalone user-facing answer. Do not include progress recaps or introductory delivery announcements after the marker. For ordinary web-researched chat answers, put citations next to the claims they support; the app has a separate source panel, so do not append a Sources/数据来源 list after the answer unless the user explicitly requests a bibliography. Do not call tools after the marker. Short answers and clarification questions also require the marker. Never put the marker in a code block.`

/** Incremental line-aware boundary decoder. Only a possible marker is withheld. */
export class AnswerBoundary {
  private pending = ''
  private prefix = ''
  private candidate = true
  private fence: { char: string; length: number } | undefined
  private final = false
  private prelude = ''
  private answer = ''
  private answerPrefix = ''
  private preludeClosed = false
  private preludeId: string
  private answerId: string
  constructor(nextId: () => string, private diagnostic: (name: string) => void = () => {}) {
    this.preludeId = nextId()
    this.answerId = nextId()
  }
  private events: AgentEvent[] = []
  private emit(text: string) {
    if (!text) return
    if (this.final && !this.preludeClosed) {
      // answerPrefix contains only whitespace while the first answer text is pending.
      if (!text.trim()) {
        this.answerPrefix += text
        return
      }
      this.complete(this.prelude, this.preludeId, true)
      this.preludeClosed = true
      text = this.answerPrefix + text
      this.answerPrefix = ''
    }
    if (this.final) this.answer += text
    else this.prelude += text
    const phase = this.final ? 'final' : 'intermediate'
    const turnId = this.final ? this.answerId : this.preludeId
    const last = this.events.at(-1)
    if (last?.type === 'text_delta' && last.turnId === turnId) last.text += text
    else this.events.push({ type: 'text_delta', text, phase, turnId, presentationProtocol: 'marker-v1' })
  }
  private complete(text: string, turnId: string, intermediate: boolean, sdkMessageId?: string) {
    // Whitespace deltas still opened a commentary stream: close it so the
    // renderer cannot retain a pending Thinking row after the boundary.
    if (text.length && (intermediate || text.trim())) this.events.push({ type: 'text_complete', text, turnId, isIntermediate: intermediate,
      phase: intermediate ? 'intermediate' : 'final', presentationProtocol: 'marker-v1', sdkMessageId,
      ...(this.preludeClosed && turnId === this.answerId ? { relatedTurnIds: [this.preludeId] } : {}) })
  }
  private endLine(newline: string) {
    if (this.candidate && this.pending.trimEnd() === FINAL_ANSWER_MARKER && !this.fence) {
      if (this.final) this.diagnostic('duplicate_boundary')
      else this.final = true
    } else this.emit(this.pending + newline)
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(this.prefix.trimEnd())
    if (fence) {
      const run = fence[1]!
      if (!this.fence) this.fence = { char: run[0]!, length: run.length }
      else if (this.fence.char === run[0] && run.length >= this.fence.length && !fence[2]?.trim()) this.fence = undefined
    }
    this.pending = ''; this.prefix = ''; this.candidate = !this.fence
  }
  push(delta: string): AgentEvent[] {
    this.events = []
    for (const ch of delta) {
      if (ch === '\n') { this.endLine('\n'); continue }
      if (this.prefix.length < 256) this.prefix += ch
      if (!this.candidate) { this.emit(ch); continue }
      this.pending += ch
      const possible = FINAL_ANSWER_MARKER.startsWith(this.pending)
        || (this.pending.startsWith(FINAL_ANSWER_MARKER) && /^[ \t\r]*$/.test(this.pending.slice(FINAL_ANSWER_MARKER.length)))
      if (!possible || this.pending.length > 256) {
        this.emit(this.pending); this.pending = ''; this.candidate = false
      }
    }
    return this.events
  }
  finish(terminal: boolean, sdkMessageId?: string, interrupted = false): AgentEvent[] {
    this.events = []
    this.endLine('')
    if (this.final) {
      if (!terminal && !interrupted) this.diagnostic('tool_after_boundary')
      if (terminal && !this.answer.trim() && this.prelude.trim()) {
        // A trailing marker leaves the entire answer in the prelude. Treat the
        // terminal body like a missing-marker reply instead of losing it.
        this.diagnostic('trailing_boundary')
        this.complete(this.prelude, this.preludeId, false, sdkMessageId)
      } else {
        if (!this.answer.trim()) this.diagnostic('empty_answer')
        if (!this.preludeClosed) this.complete(this.prelude, this.preludeId, true)
        this.complete(this.answer, this.answerId, !terminal, sdkMessageId)
      }
    } else {
      if (terminal && this.prelude.trim()) this.diagnostic('missing_boundary')
      if (!this.preludeClosed) this.complete(this.prelude, this.preludeId, !terminal, sdkMessageId)
    }
    return this.events
  }
}
