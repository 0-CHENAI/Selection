/**
 * 行内强调：从 SVG 转来的参考页把一行里加粗或变色的词拆成了几个并排的文本框，
 * 每个框的 x 按 SVG 里的字宽排好。PowerPoint 和 LibreOffice 用的字体宽度不同，
 * 并排的框就会多出空隙或互相压住（「31% —」前面一大段空白、「concentrates ,」）。
 *
 * 导出时把同一行、首尾相接、字号和字体相同的单行文本框合成一个文本框，用 runs 保留各段样式，
 * 由 PowerPoint 自己排字。词与词之间的空格按标点规则补回。
 */
import { containsCjk } from './metrics.ts'
import type { DeckElement, DeckTextRun } from './types.ts'

const NO_SPACE_BEFORE = /^[,.;:!?%)\]}’”、，。；：！？）》」』】…]/
const NO_SPACE_AFTER = /[(\[{‘“《「『【\s/-]$/

function single(element: DeckElement): boolean {
  return element.type === 'text'
    && !!element.font
    && typeof element.text === 'string'
    && element.text.length > 0
    && !element.text.includes('\n')
    && !element.rotate
    && !element.retained
    && !element.link
    && !element.group
    && (element.textCapacity?.maxLines ?? 1) <= 1
    && (element.font.align ?? 'left') === 'left'
}

function sameLine(left: DeckElement, right: DeckElement): boolean {
  const a = left.font!
  const b = right.font!
  if (a.size !== b.size || a.family !== b.family || (a.tracking ?? 0) !== (b.tracking ?? 0)) return false
  if (JSON.stringify(a.face ?? null) !== JSON.stringify(b.face ?? null)) return false
  if (Math.abs(left.bounds.y - right.bounds.y) > 0.6 || Math.abs(left.bounds.h - right.bounds.h) > 0.6) return false
  const gap = right.bounds.x - (left.bounds.x + left.bounds.w)
  return gap > -1 && gap < 1.5
}

/** 两段之间要不要补空格：拉丁文按词分开，标点和中日韩文字不补。 */
export function joinsWithSpace(left: string, right: string): boolean {
  if (!left || !right) return false
  if (/\s$/.test(left) || /^\s/.test(right)) return false
  if (NO_SPACE_BEFORE.test(right) || NO_SPACE_AFTER.test(left)) return false
  const last = Array.from(left).at(-1)!
  const first = Array.from(right)[0]!
  if (containsCjk(last) || containsCjk(first)) return false
  return true
}

function runOf(element: DeckElement, text: string): DeckTextRun {
  const font = element.font!
  return {
    text,
    ...(font.weight === 'bold' ? { bold: true } : {}),
    ...(font.italic ? { italic: true } : {}),
    color: font.color ?? '$ink',
  }
}

/** 返回合并后的元素列表；只合并文本，其余元素原样按原顺序保留。 */
export function mergeInlineRuns(elements: DeckElement[]): DeckElement[] {
  const candidates = elements.filter(single)
  const next = new Map<DeckElement, DeckElement>()
  const hasPrevious = new Set<DeckElement>()
  for (const left of candidates) {
    const right = candidates
      .filter(item => item !== left && !hasPrevious.has(item) && sameLine(left, item))
      .sort((a, b) => a.bounds.x - b.bounds.x)[0]
    if (!right) continue
    next.set(left, right)
    hasPrevious.add(right)
  }
  if (next.size === 0) return elements
  const merged = new Map<DeckElement, DeckElement>()
  const absorbed = new Set<DeckElement>()
  for (const head of candidates) {
    if (hasPrevious.has(head) || !next.has(head)) continue
    const chain = [head]
    let cursor = next.get(head)
    while (cursor && !chain.includes(cursor)) {
      chain.push(cursor)
      cursor = next.get(cursor)
    }
    const runs: DeckTextRun[] = []
    let text = ''
    chain.forEach((item, index) => {
      const piece = index > 0 && joinsWithSpace(text, item.text!) ? ` ${item.text}` : item.text!
      runs.push(runOf(item, piece))
      text += piece
    })
    const last = chain.at(-1)!
    const baseFont = { ...head.font!, weight: undefined, italic: undefined }
    merged.set(head, {
      ...head,
      text,
      runs,
      font: baseFont,
      bounds: { ...head.bounds, w: last.bounds.x + last.bounds.w - head.bounds.x },
      textCapacity: head.textCapacity ? { maxChars: Array.from(text).length, maxLines: 1 } : undefined,
    })
    for (const item of chain.slice(1)) absorbed.add(item)
  }
  return elements.flatMap(element => absorbed.has(element) ? [] : [merged.get(element) ?? element])
}
