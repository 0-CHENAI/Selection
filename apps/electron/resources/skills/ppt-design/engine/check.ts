import { composite, contrastMinimum, contrastRatio, splitColor } from './contrast.ts'
import { containsCjk, defaultLeading, fitSlack, literalNewline, orphanLines, textWidth, wrapText } from './metrics.ts'
import { colorRef } from './schema.ts'
import type { Bounds, Deck, DeckElement, DeckIssue, DeckPage } from './types.ts'
import { issue } from './schema.ts'

function overlaps(a: Bounds, b: Bounds): boolean {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ix > 0.75 && iy > 0.75
}

function contains(outer: Bounds, inner: Bounds, slack = 0.5): boolean {
  return inner.x >= outer.x - slack
    && inner.y >= outer.y - slack
    && inner.x + inner.w <= outer.x + outer.w + slack
    && inner.y + inner.h <= outer.y + outer.h + slack
}

function glyphBox(element: DeckElement): Bounds {
  const font = element.font
  const text = element.text ?? ''
  if (!font || !text.trim()) return element.bounds
  const bold = font.weight === 'bold'
  const tracking = font.tracking ?? 0
  const leading = font.leading ?? defaultLeading(font.size)
  const lines = wrapText(text, element.bounds.w, font.size, bold, tracking)
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, font.size, bold, tracking)), 0)
  const height = lines.length <= 1 ? font.size : font.size + (lines.length - 1) * font.size * leading
  const width = Math.min(widest, element.bounds.w)
  const usedHeight = Math.min(height, element.bounds.h)
  const align = font.align ?? 'left'
  const valign = font.valign ?? 'top'
  const x = align === 'center'
    ? element.bounds.x + (element.bounds.w - width) / 2
    : align === 'right'
      ? element.bounds.x + element.bounds.w - width
      : element.bounds.x
  const y = valign === 'middle'
    ? element.bounds.y + (element.bounds.h - usedHeight) / 2
    : valign === 'bottom'
      ? element.bounds.y + element.bounds.h - usedHeight
      : element.bounds.y
  return { x, y, w: width, h: usedHeight }
}

function lineCuts(rule: DeckElement, box: Bounds): boolean {
  const points = rule.line?.points
  if (!points) return overlaps(rule.bounds, box)
  const x1 = rule.bounds.x + points.x1
  const y1 = rule.bounds.y + points.y1
  const x2 = rule.bounds.x + points.x2
  const y2 = rule.bounds.y + points.y2
  const inside = (x: number, y: number) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h
  if (inside(x1, y1) || inside(x2, y2)) return true
  const edges: [number, number, number, number][] = [
    [box.x, box.y, box.x + box.w, box.y],
    [box.x + box.w, box.y, box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h, box.x + box.w, box.y + box.h],
    [box.x, box.y, box.x, box.y + box.h],
  ]
  return edges.some(([ax, ay, bx, by]) => segmentsCross(x1, y1, x2, y2, ax, ay, bx, by))
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const cross = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
  const d1 = cross(cx, cy, dx, dy, ax, ay)
  const d2 = cross(cx, cy, dx, dy, bx, by)
  const d3 = cross(ax, ay, bx, by, cx, cy)
  const d4 = cross(ax, ay, bx, by, dx, dy)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function inset(box: Bounds, pad: number): Bounds {
  return { x: box.x + pad, y: box.y + pad, w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) }
}

function roleOf(element: DeckElement): 'panel' | 'rule' | 'decoration' | 'content' {
  if (element.role) return element.role
  if (element.type === 'shape') {
    if (element.shape === 'line' || element.bounds.h <= 2 || element.bounds.w <= 2) {
      if ((element.line?.width ?? 1) <= 0.75) return 'decoration'
      return 'rule'
    }
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
    if (element.type === 'table' && element.table) {
      issues.push(...checkTable(deck, page, element, background))
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
  const tracking = font.tracking ?? 0
  const lines = wrapText(text, element.bounds.w, font.size, bold, tracking)
  if (lines.length > capacity.maxLines) {
    issues.push(issue('over_capacity', `按字宽估计需要 ${lines.length} 行，textCapacity.maxLines 为 ${capacity.maxLines}`, page.id, element.id))
  }
  const needed = lines.length <= 1 ? font.size : font.size + (lines.length - 1) * font.size * leading
  if (needed > element.bounds.h + 1.5) {
    issues.push(issue('over_capacity', `文本框高 ${element.bounds.h}pt，按行距需要 ${needed.toFixed(1)}pt`, page.id, element.id))
  }
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, font.size, bold, tracking)), 0)
  if (widest > element.bounds.w + fitSlack(font.size)) {
    issues.push(issue('over_capacity', `最宽一行约 ${widest.toFixed(0)}pt，文本框只有 ${element.bounds.w}pt`, page.id, element.id))
  }
  for (const problem of orphanLines(lines)) {
    issues.push(issue('orphan', `孤字或行首禁则：${problem}`, page.id, element.id))
  }
  try {
    const fill = splitColor(colorRef(font.color, deck.theme, '$ink')).rgb
    const samples = samplePoints(element.bounds)
    for (const sample of samples) {
      const behind = backgroundAt(deck, page, element, sample.x, sample.y, pageBackground)
      const ratio = contrastRatio(fill, behind)
      const primary = font.color === undefined || font.color === '$ink'
      const minimum = primary ? contrastMinimum(font.size, bold) : Math.min(3, contrastMinimum(font.size, bold))
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
  let color = splitColor(pageBackground).rgb
  for (const element of page.elements) {
    if (element.id === self.id) break
    if (element.type !== 'shape' || !element.fill) continue
    if (element.shape === 'line' || element.bounds.h <= 2 || element.bounds.w <= 2) continue
    if (!pointIn(element.bounds, x, y)) continue
    try {
      color = composite(colorRef(element.fill, deck.theme, pageBackground), color)
    } catch {
      return color
    }
  }
  return color
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
      const boxA = a.element.type === 'text' ? glyphBox(a.element) : a.element.bounds
      const boxB = b.element.type === 'text' ? glyphBox(b.element) : b.element.bounds
      if (overlaps(boxA, boxB)) {
        issues.push(issue('overlap', `内容 ${a.element.id} 与 ${b.element.id} 重叠`, page.id, a.element.id))
      }
    }
    for (const panel of panels) {
      const box = content[i]!.element.type === 'text' ? glyphBox(content[i]!.element) : content[i]!.element.bounds
      const ix = Math.min(box.x + box.w, panel.element.bounds.x + panel.element.bounds.w) - Math.max(box.x, panel.element.bounds.x)
      const iy = Math.min(box.y + box.h, panel.element.bounds.y + panel.element.bounds.h) - Math.max(box.y, panel.element.bounds.y)
      if (ix <= 12 || iy <= 12) continue
      if (!contains(panel.element.bounds, box, 8)) {
        issues.push(issue('overlap', `内容 ${content[i]!.element.id} 压在色块 ${panel.element.id} 的边缘上`, page.id, content[i]!.element.id))
      }
    }
  }
  for (const rule of rules) {
    for (const item of content) {
      if (item.element.type !== 'text') continue
      const inner = inset(glyphBox(item.element), 1.5)
      if (inner.w <= 0 || inner.h <= 0) continue
      if (!lineCuts(rule.element, inner)) continue
      const length = Math.max(rule.element.bounds.w, rule.element.bounds.h)
      if (length < 20) continue
      issues.push(issue('overlap', `线条 ${rule.element.id} 穿过文字 ${item.element.id}`, page.id, rule.element.id))
    }
  }
  return issues
}

function checkTable(deck: Deck, page: DeckPage, element: DeckElement, pageBackground: string): DeckIssue[] {
  const table = element.table
  if (!table) return []
  const issues: DeckIssue[] = []
  const rowHeights = table.rowHeights ?? table.rows.map(() => element.bounds.h / table.rows.length)
  table.rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex] ?? element.bounds.h / table.rows.length
    row.forEach((cell, columnIndex) => {
      const width = (table.columns[columnIndex] ?? 0) * element.bounds.w
      const bold = rowIndex === 0 ? (table.header?.bold ?? cell.bold ?? false) : (cell.bold ?? false)
      const lines = wrapText(cell.text, Math.max(1, width - 8), table.fontSize, bold)
      const needed = lines.length <= 1 ? table.fontSize : table.fontSize + (lines.length - 1) * table.fontSize * 1.15
      if (needed > rowHeight + 2) {
        issues.push(issue('over_capacity', `表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列高 ${rowHeight.toFixed(0)}pt，文字约需 ${needed.toFixed(0)}pt`, page.id, element.id))
      }
      try {
        const fill = colorRef(cell.fill ?? (rowIndex === 0 ? table.header?.fill : undefined) ?? table.fill, deck.theme, pageBackground)
        const ink = splitColor(colorRef(cell.color ?? (rowIndex === 0 ? table.header?.color : undefined) ?? table.color, deck.theme, '$ink')).rgb
        const ratio = contrastRatio(ink, splitColor(fill).rgb)
        const minimum = contrastMinimum(table.fontSize, bold)
        if (ratio + 0.02 < minimum) {
          issues.push(issue('contrast', `表格对比度 ${ratio.toFixed(2)} 低于 ${minimum.toFixed(1)}`, page.id, element.id))
        }
      } catch (error) {
        issues.push(issue('schema', error instanceof Error ? error.message : String(error), page.id, element.id))
      }
    })
  })
  return issues
}
