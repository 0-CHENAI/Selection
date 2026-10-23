import { contrastMinimum, contrastRatio } from './contrast.ts'
import { containsCjk, defaultLeading, literalNewline, orphanLines, textWidth, wrapText } from './metrics.ts'
import { colorRef } from './schema.ts'
import type { Bounds, Deck, DeckElement, DeckIssue, DeckPage } from './types.ts'
import { issue } from './schema.ts'

function overlaps(a: Bounds, b: Bounds): boolean {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ix > 0.75 && iy > 0.75
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x - 0.5
    && inner.y >= outer.y - 0.5
    && inner.x + inner.w <= outer.x + outer.w + 0.5
    && inner.y + inner.h <= outer.y + outer.h + 0.5
}

function inset(box: Bounds, pad: number): Bounds {
  return { x: box.x + pad, y: box.y + pad, w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) }
}

function roleOf(element: DeckElement): 'panel' | 'rule' | 'decoration' | 'content' {
  if (element.role) return element.role
  if (element.type === 'shape') {
    if (element.shape === 'line' || element.bounds.h <= 2 || element.bounds.w <= 2) return 'rule'
    return 'panel'
  }
  return 'content'
}

function pointIn(box: Bounds, x: number, y: number): boolean {
  return x >= box.x - 0.25 && y >= box.y - 0.25 && x <= box.x + box.w + 0.25 && y <= box.y + box.h + 0.25
}

export function checkDeck(deck: Deck): DeckIssue[] {
  const issues: DeckIssue[] = []
  let previousLayout: string | undefined
  deck.pages.forEach((page, index) => {
    if (previousLayout && page.layout === previousLayout) {
      issues.push(issue('adjacent_layout', `第 ${index + 1} 页与上一页使用了相同版式 ${page.layout}`, page.id))
    }
    previousLayout = page.layout
    issues.push(...checkPage(deck, page))
  })
  return issues
}

function checkPage(deck: Deck, page: DeckPage): DeckIssue[] {
  const issues: DeckIssue[] = []
  const { width, height } = deck.canvas
  let background = '#FFFFFF'
  try {
    background = colorRef(page.background, deck.theme, '$paper')
  } catch (error) {
    issues.push(issue('schema', error instanceof Error ? error.message : String(error), page.id))
  }
  for (const element of page.elements) {
    const box = element.bounds
    if (box.x < -0.5 || box.y < -0.5 || box.x + box.w > width + 0.5 || box.y + box.h > height + 0.5) {
      issues.push(issue('out_of_bounds', `元素超出 ${width}×${height} 画布（x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h}）`, page.id, element.id))
    }
    if (element.type === 'text' && element.text && element.font && element.textCapacity) {
      issues.push(...checkText(deck, page, element, background))
    }
    if (element.type === 'chart' && element.chart?.kind === 'waterfall') {
      issues.push(...checkWaterfall(page, element))
    }
  }
  issues.push(...checkOverlap(page))
  return issues
}

function checkText(deck: Deck, page: DeckPage, element: DeckElement, pageBackground: string): DeckIssue[] {
  const issues: DeckIssue[] = []
  const text = element.text ?? ''
  const font = element.font!
  const capacity = element.textCapacity!
  const bold = font.weight === 'bold'
  if (literalNewline(text)) {
    issues.push(issue('literal_newline', '文本含有字面量 \\n、\\r 或 \\t。换行请使用真实换行，不要写反斜杠 n', page.id, element.id))
  }
  if (containsCjk(text) && font.family === '$latin') {
    issues.push(issue('font', '含中文的文本应使用 $cjk，以便走 mac / win / linux 回退', page.id, element.id))
  }
  const glyphs = Array.from(text.replace(/\n/g, '')).length
  if (glyphs > capacity.maxChars) {
    issues.push(issue('over_capacity', `文字 ${glyphs} 字，超过 textCapacity.maxChars ${capacity.maxChars}`, page.id, element.id))
  }
  const leading = font.leading ?? defaultLeading(font.size)
  const lines = wrapText(text, element.bounds.w, font.size, bold)
  if (lines.length > capacity.maxLines) {
    issues.push(issue('over_capacity', `按字宽估计需要 ${lines.length} 行，textCapacity.maxLines 为 ${capacity.maxLines}`, page.id, element.id))
  }
  const needed = lines.length * font.size * leading
  if (needed > element.bounds.h + 1) {
    issues.push(issue('over_capacity', `文本框高 ${element.bounds.h}pt，按行距需要 ${needed.toFixed(1)}pt`, page.id, element.id))
  }
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, font.size, bold)), 0)
  if (widest > element.bounds.w + font.size) {
    issues.push(issue('over_capacity', `最宽一行约 ${widest.toFixed(0)}pt，文本框只有 ${element.bounds.w}pt`, page.id, element.id))
  }
  for (const problem of orphanLines(lines)) {
    issues.push(issue('orphan', `孤字或行首禁则：${problem}`, page.id, element.id))
  }
  try {
    const fill = colorRef(font.color, deck.theme, '$ink')
    const samples = samplePoints(element.bounds)
    for (const sample of samples) {
      const behind = backgroundAt(deck, page, element, sample.x, sample.y, pageBackground)
      const ratio = contrastRatio(fill, behind)
      const minimum = contrastMinimum(font.size, bold)
      if (ratio + 0.02 < minimum) {
        issues.push(issue('contrast', `对比度 ${ratio.toFixed(2)} 低于 ${minimum.toFixed(1)}（${fill} 在 ${behind} 上，${font.size}pt${bold ? ' 粗体' : ''}）`, page.id, element.id))
        break
      }
    }
  } catch (error) {
    issues.push(issue('schema', error instanceof Error ? error.message : String(error), page.id, element.id))
  }
  return issues
}

function samplePoints(box: Bounds): { x: number; y: number }[] {
  const padX = Math.min(4, box.w / 4)
  const padY = Math.min(4, box.h / 4)
  return [
    { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    { x: box.x + padX, y: box.y + padY },
    { x: box.x + box.w - padX, y: box.y + padY },
    { x: box.x + padX, y: box.y + box.h - padY },
    { x: box.x + box.w - padX, y: box.y + box.h - padY },
  ]
}

function backgroundAt(deck: Deck, page: DeckPage, self: DeckElement, x: number, y: number, pageBackground: string): string {
  for (let index = page.elements.length - 1; index >= 0; index--) {
    const element = page.elements[index]!
    if (element.id === self.id || element.type === 'text' || element.type === 'chart' || element.type === 'image') continue
    if (roleOf(element) === 'rule' || roleOf(element) === 'decoration') continue
    if (!element.fill || !pointIn(element.bounds, x, y)) continue
    return colorRef(element.fill, deck.theme, pageBackground)
  }
  return pageBackground
}

function checkWaterfall(page: DeckPage, element: DeckElement): DeckIssue[] {
  const values = element.chart?.series[0]?.values
  if (!values || values.length < 3) return []
  const start = values[0]!
  const end = values[values.length - 1]!
  const deltas = values.slice(1, -1).reduce((sum, value) => sum + value, 0)
  if (Math.abs(start + deltas - end) > 0.051) {
    return [issue('unreconciled', `瀑布图未轧平：起点 ${start} + 变化 ${deltas} ≠ 终点 ${end}`, page.id, element.id)]
  }
  return []
}

function checkOverlap(page: DeckPage): DeckIssue[] {
  const issues: DeckIssue[] = []
  const items = page.elements.map(element => ({ element, role: roleOf(element) }))
  const panels = items.filter(item => item.role === 'panel')
  const rules = items.filter(item => item.role === 'rule')
  const content = items.filter(item => item.role === 'content')
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i]!
      const b = panels[j]!
      if (!overlaps(a.element.bounds, b.element.bounds)) continue
      if (contains(a.element.bounds, b.element.bounds) || contains(b.element.bounds, a.element.bounds)) continue
      issues.push(issue('overlap', `色块 ${a.element.id} 与 ${b.element.id} 相交，且没有互相包含`, page.id, a.element.id))
    }
  }
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i]!
      const b = content[j]!
      if (overlaps(a.element.bounds, b.element.bounds)) {
        issues.push(issue('overlap', `内容 ${a.element.id} 与 ${b.element.id} 重叠`, page.id, a.element.id))
      }
    }
    for (const panel of panels) {
      if (!overlaps(content[i]!.element.bounds, panel.element.bounds)) continue
      if (!contains(panel.element.bounds, content[i]!.element.bounds)) {
        issues.push(issue('overlap', `内容 ${content[i]!.element.id} 压在色块 ${panel.element.id} 的边缘上`, page.id, content[i]!.element.id))
      }
    }
  }
  for (const rule of rules) {
    for (const item of content) {
      if (item.element.type !== 'text') continue
      const inner = inset(item.element.bounds, 1.5)
      if (inner.w <= 0 || inner.h <= 0) continue
      if (overlaps(rule.element.bounds, inner)) {
        issues.push(issue('overlap', `线条 ${rule.element.id} 穿过文字 ${item.element.id}`, page.id, rule.element.id))
      }
    }
  }
  return issues
}
