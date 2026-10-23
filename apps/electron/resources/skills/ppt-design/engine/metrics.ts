/** CJK-aware width estimate. Fullwidth glyphs count as 1em; Latin is narrower. */

const NO_LINE_START = new Set(Array.from('，。、；：！？）》」』】〉」,.!?;:)]}%'))
const NO_LINE_END = new Set(Array.from('（《「『【〈([{“‘'))

export function isFullwidth(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  if ('，。、；：！？「」『』【】（）《》〈〉—'.includes(ch)) return true
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

export function charWidth(ch: string, fontSize: number, bold: boolean): number {
  if (ch === '\t') return fontSize * 2
  if (ch === ' ') return fontSize * (bold ? 0.36 : 0.33)
  if (ch === '·' || ch === '…' || ch === '・') return fontSize * 0.5
  if (isFullwidth(ch)) return fontSize
  if (/[0-9]/.test(ch)) return fontSize * (bold ? 0.64 : 0.58)
  if (/[A-Z]/.test(ch)) return fontSize * (bold ? 0.74 : 0.68)
  if (/[a-z]/.test(ch)) return fontSize * (bold ? 0.62 : 0.56)
  if (ch === '%') return fontSize * 0.9
  if ('.,:;\'"'.includes(ch)) return fontSize * 0.32
  if ('+−–-'.includes(ch)) return fontSize * 0.55
  return fontSize * (bold ? 0.62 : 0.55)
}

export function textWidth(text: string, fontSize: number, bold: boolean): number {
  let width = 0
  for (const ch of Array.from(text)) width += charWidth(ch, fontSize, bold)
  return width
}

export function defaultLeading(fontSize: number): number {
  if (fontSize >= 40) return 1.05
  if (fontSize >= 24) return 1.12
  return 1.28
}

/** Greedy wrap with a small kinsoku (避头尾) pass so punctuation does not start a line. */
export function wrapText(text: string, boxWidth: number, fontSize: number, bold: boolean): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (para.length === 0) {
      lines.push('')
      continue
    }
    const chars = Array.from(para)
    let current: string[] = []
    let width = 0
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!
      const w = charWidth(ch, fontSize, bold)
      const overflows = current.length > 0 && width + w > boxWidth + 0.01
      if (!overflows) {
        current.push(ch)
        width += w
        continue
      }
      if (NO_LINE_START.has(ch) && width + w <= boxWidth + fontSize) {
        current.push(ch)
        width += w
        continue
      }
      const last = current[current.length - 1]
      if (last && NO_LINE_END.has(last) && current.length > 1) {
        current.pop()
        lines.push(current.join(''))
        current = [last, ch]
        width = charWidth(last, fontSize, bold) + w
        continue
      }
      lines.push(current.join(''))
      current = [ch]
      width = w
    }
    if (current.length > 0) lines.push(current.join(''))
  }
  return lines
}

export function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uF900-\uFAFF]/.test(text)
}

/** Last wrapped line is a single glyph, or a line opens with closing punctuation. */
export function orphanLines(lines: string[]): string[] {
  const problems: string[] = []
  lines.forEach((line, index) => {
    const glyphs = Array.from(line.trim())
    if (glyphs.length === 0) return
    const first = glyphs[0]!
    if (NO_LINE_START.has(first)) problems.push(`第 ${index + 1} 行以「${first}」开头`)
    const contentBefore = lines.slice(0, index).some(item => Array.from(item.trim()).length > 0)
    if (contentBefore && glyphs.length === 1) problems.push(`第 ${index + 1} 行只剩「${glyphs[0]}」`)
  })
  return problems
}

export function literalNewline(text: string): boolean {
  return text.includes('\\n') || text.includes('\\r') || text.includes('\\t')
}
