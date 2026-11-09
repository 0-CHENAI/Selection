/** Incremental decoder for submit_answer's single Markdown string property. */
export class AnswerArgumentStream {
  private buffer = ''
  private offset = 0
  private started = false
  private ended = false
  private invalid = false
  private markdown = ''

  push(delta: string): string {
    if (this.invalid) return ''
    if (this.ended) return this.visible()
    this.buffer += delta
    if (!this.started) {
      const match = /^\s*\{\s*(?:"_(?:intent|displayName)"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*)*"markdown"\s*:\s*"/.exec(this.buffer)
      if (!match) return ''
      this.offset = match[0].length
      this.started = true
    }
    while (this.offset < this.buffer.length) {
      const ch = this.buffer[this.offset]!
      if (ch === '"') { this.ended = true; break }
      if (ch === '\\') {
        const escape = this.buffer[this.offset + 1]
        if (!escape) break
        const count = escape === 'u' ? 6 : 2
        if (this.buffer.length - this.offset < count) break
        try { this.markdown += JSON.parse(`"${this.buffer.slice(this.offset, this.offset + count)}"`) }
        catch { this.invalid = true; return '' }
        this.offset += count
      } else {
        if (ch.charCodeAt(0) < 32) { this.invalid = true; return '' }
        this.markdown += ch
        this.offset++
      }
    }
    // Retain only a possible split escape; decoded input is never scanned again.
    this.buffer = this.buffer.slice(this.offset)
    this.offset = 0
    return this.visible()
  }

  private visible(): string {
    const last = this.markdown.charCodeAt(this.markdown.length - 1)
    return last >= 0xd800 && last <= 0xdbff ? this.markdown.slice(0, -1) : this.markdown
  }
}
