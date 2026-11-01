import { argumentLayoutById } from './argument-layouts.ts'
import { composite, contrastMinimum, contrastRatio, splitColor } from './contrast.ts'
import { containsCjk, defaultLeading, fitSlack, literalNewline, orphanLines, textWidth, wrapText } from './metrics.ts'
import { colorRef } from './schema.ts'
import type { Bounds, Deck, DeckElement, DeckIssue, DeckPage, ImageSlot } from './types.ts'
import { issue } from './schema.ts'

/** dsh `layoutRepetitionIssues` warns when a run is at least this many pages (`end - start < 3` does not). */
export const LAYOUT_REPETITION_RUN = 3

const COLOR_TOKEN = /^(\$[A-Za-z][A-Za-z0-9_-]*|#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?)$/
const BOOKEND_LAYOUT = /^(?:cover|title|opening|section|closing|final|blank)$/i
const COVER_LAYOUT = /^(?:cover|title|opening)$/i
const ASPECT: Record<ImageSlot['aspectRatio'], number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
}

export type CheckOptions = {
  /** When set, a local image src that does not exist is `missing_asset`. Placeholders stay warnings. */
  assetExists?: (src: string) => boolean
}

export function isPlaceholderImageSrc(src: string | undefined): boolean {
  if (!src) return false
  return src.startsWith('placeholder:') || /(?:^|[/\\])selection-placeholder-[^/\\]+\.png$/i.test(src)
}

export function blockingIssues(issues: DeckIssue[]): DeckIssue[] {
  return issues.filter(item => item.severity !== 'warning')
}

export function revisionStatus(issues: DeckIssue[]): { status: 'ok' | 'needs_revision'; code: 0 | 2; errorCount: number; warningCount: number } {
  const errorCount = blockingIssues(issues).length
  return { status: errorCount ? 'needs_revision' : 'ok', code: errorCount ? 2 : 0, errorCount, warningCount: issues.length - errorCount }
}

/** Same shape as the Word / Excel delivery guard: file, page, element id. Warnings are listed and do not block. */
export function formatNeedsRevision(file: string, issues: DeckIssue[]): string {
  const blocking = blockingIssues(issues)
  const warnings = issues.filter(item => item.severity === 'warning')
  const lines = [`needs_revision：${blocking.length} 项需要修正，不能以「就绪」交付。`]
  blocking.forEach((item, index) => {
    const where = [file, item.pageId ? `页 ${item.pageId}` : '', item.elementId ? `元素 ${item.elementId}` : ''].filter(Boolean).join(' · ')
    lines.push(`[${index + 1}] ${where}\n${item.code}：${item.message}`)
  })
  if (warnings.length) {
    lines.push(`另有 ${warnings.length} 项提醒，不阻止导出：`)
    for (const item of warnings) lines.push(`- ${[item.pageId ? `页 ${item.pageId}` : '', item.code, item.message].filter(Boolean).join(' · ')}`)
  }
  return lines.join('\n')
}

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

export function checkDeck(deck: Deck, options: CheckOptions = {}): DeckIssue[] {
  const issues: DeckIssue[] = []
  deck.pages.forEach(page => {
    issues.push(...checkPage(deck, page, options))
  })
  if (deck.profile !== 'example') {
    issues.push(...checkLayoutRepetition(deck))
    issues.push(...checkCoverFocus(deck))
  }
  return issues
}

function checkArgumentLayout(page: DeckPage): DeckIssue[] {
  const layout = argumentLayoutById(page.layout)
  if (!layout) return []
  const issues: DeckIssue[] = []
  const byId = new Map(page.elements.map(element => [element.id, element]))
  for (const slot of layout.slots) {
    const element = byId.get(slot.id)
    if (!element) {
      issues.push(issue('schema', `版式 ${layout.id} 缺少元素 ${slot.id}`, page.id, slot.id))
      continue
    }
    if (!slotAccepts(slot.kind, element)) {
      issues.push(issue('schema', `版式 ${layout.id} 的 ${slot.id} 应为 ${slot.kind}`, page.id, slot.id))
    }
    const box = element.bounds
    const placed = Math.abs(box.x - slot.bounds.x) <= 0.51
      && Math.abs(box.y - slot.bounds.y) <= 0.51
      && Math.abs(box.w - slot.bounds.w) <= 0.51
      && Math.abs(box.h - slot.bounds.h) <= 0.51
    if (!placed) issues.push(issue('schema', `版式 ${layout.id} 的 ${slot.id} 不在目录几何上`, page.id, slot.id))
    if (slot.textCapacity && element.textCapacity) {
      if (element.textCapacity.maxChars > slot.textCapacity.maxChars || element.textCapacity.maxLines > slot.textCapacity.maxLines) {
        issues.push(issue('schema', `版式 ${layout.id} 的 ${slot.id} 把 textCapacity 放到了目录容量之外`, page.id, slot.id))
      }
    }
  }
  return issues
}

function slotAccepts(kind: DeckElement['type'], element: DeckElement): boolean {
  if (element.type === kind) return true
  return kind === 'chart' && element.type === 'image' && !!element.chartImage
}

function checkChartImage(deck: Deck, page: DeckPage, element: DeckElement): DeckIssue[] {
  const issues: DeckIssue[] = []
  const box = element.bounds
  const data = element.chartImage?.data.trim() ?? ''
  if (box.w < 48 || box.h < 48) {
    issues.push(issue('schema', `图片图表 ${element.id} 的尺寸过小（${box.w}×${box.h}）`, page.id, element.id))
  }
  const { width, height } = deck.canvas
  const bleed = deck.profile === 'example' ? 36 : 0.5
  const off = box.x < -bleed || box.y < -bleed || box.x + box.w > width + bleed || box.y + box.h > height + bleed
  if (off) issues.push(issue('out_of_bounds', `图片图表 ${element.id} 超出 ${width}×${height} 画布`, page.id, element.id))
  if (!data || !page.notes?.includes(data)) {
    issues.push(issue('schema', `图片图表 ${element.id} 的原始数据表要写进页面备注`, page.id, element.id))
  }
  return issues
}

function checkPage(deck: Deck, page: DeckPage, options: CheckOptions): DeckIssue[] {
  const issues: DeckIssue[] = [...checkArgumentLayout(page)]
  const { width, height } = deck.canvas
  let background = '#FFFFFF'
  try {
    background = colorRef(page.background, deck.theme, '$paper')
  } catch (error) {
    issues.push(issue('schema', error instanceof Error ? error.message : String(error), page.id))
  }
  for (const element of page.elements) {
    const box = element.bounds
    const bleed = deck.profile === 'example' ? 36 : 0.5
    const off = deck.profile === 'example'
      ? box.x + box.w < -bleed || box.y + box.h < -bleed || box.x > width + bleed || box.y > height + bleed
      : box.x < -bleed || box.y < -bleed || box.x + box.w > width + bleed || box.y + box.h > height + bleed
    const chartPicture = element.type === 'image' && !!element.chartImage
    if (off && !chartPicture) {
      issues.push(issue('out_of_bounds', `元素超出 ${width}×${height} 画布（x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h}）`, page.id, element.id))
    }
    if (element.retained) continue
    if (chartPicture) issues.push(...checkChartImage(deck, page, element))
    if (element.type === 'text' && element.text && element.font && element.textCapacity) {
      issues.push(...checkText(deck, page, element, background))
    }
    if (element.type === 'chart' && element.chart?.kind === 'waterfall') {
      issues.push(...checkWaterfall(page, element))
    }
    if (element.type === 'chart') issues.push(...checkChartData(page, element), ...checkChartSeriesColor(page, element))
    if (element.type === 'image' && !element.chartImage) issues.push(...checkImage(page, element, options))
    if (element.type === 'table' && element.table) {
      issues.push(...checkTable(deck, page, element, background))
    }
  }
  const editable = { ...page, elements: page.elements.filter(element => !element.retained) }
  issues.push(...checkOverlap(editable, deck.profile === 'example'))
  if (deck.profile !== 'example') issues.push(...checkTextLayer(page))
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
  if (deck.profile !== 'example') {
    for (const problem of orphanLines(lines)) {
      issues.push(issue('orphan', `孤字或行首禁则：${problem}`, page.id, element.id))
    }
  }
  if (deck.profile === 'example') return issues
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
    const paint = shapePaint(element)
    if (element.type !== 'shape' || !paint) continue
    if (element.shape === 'line' || element.bounds.h <= 2 || element.bounds.w <= 2) continue
    if (!pointIn(element.bounds, x, y)) continue
    try {
      color = composite(colorRef(paint, deck.theme, pageBackground), color)
    } catch {
      return color
    }
  }
  return color
}

function shapePaint(element: DeckElement): string | undefined {
  if (element.fill) return element.fill
  const stop = element.gradient?.stops[0]?.color
  if (stop) return stop
  if (element.pattern) return element.pattern.background
  return undefined
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

function checkOverlap(page: DeckPage, skipContent: boolean): DeckIssue[] {
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
  if (!skipContent) for (let i = 0; i < content.length; i++) {
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
      if (deck.profile !== 'example') try {
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

function checkLayoutRepetition(deck: Deck): DeckIssue[] {
  const issues: DeckIssue[] = []
  let runStart = 0
  let runLayout: string | undefined
  const finish = (end: number) => {
    if (!runLayout || end - runStart < LAYOUT_REPETITION_RUN) return
    const first = deck.pages[runStart]
    if (!first) return
    issues.push(issue(
      'layout_repetition',
      `第 ${runStart + 1}–${end} 页连续使用版式 ${runLayout}。调整主视觉或在 design-plan 里写明连续对比的理由。`,
      first.id,
      undefined,
      'warning',
    ))
  }
  deck.pages.forEach((page, index) => {
    const layout = page.layout?.trim() ?? ''
    const counted = layout.length > 0 && layout !== 'free' && !BOOKEND_LAYOUT.test(layout)
    if (!counted) {
      finish(index)
      runStart = index + 1
      runLayout = undefined
      return
    }
    if (layout === runLayout) return
    finish(index)
    runStart = index
    runLayout = layout
  })
  finish(deck.pages.length)
  return issues
}

function checkCoverFocus(deck: Deck): DeckIssue[] {
  const canvas = deck.canvas.width * deck.canvas.height
  const issues: DeckIssue[] = []
  for (const page of deck.pages) {
    if (!COVER_LAYOUT.test(page.layout?.trim() ?? '')) continue
    const visual = page.elements.reduce((largest, element) => {
      if (element.type !== 'image' && element.type !== 'chart' && element.type !== 'table') return largest
      if (canvas <= 0) return largest
      return Math.max(largest, (element.bounds.w * element.bounds.h) / canvas)
    }, 0)
    if (visual >= 0.25) continue
    const sizes = page.elements.flatMap(element => {
      if (element.type !== 'text' || !element.text?.trim() || !element.font) return []
      return [element.font.size]
    }).sort((left, right) => left - right)
    if (sizes.length < 3) continue
    const middle = Math.floor(sizes.length / 2)
    const median = sizes.length % 2 === 1 ? sizes[middle]! : ((sizes[middle - 1] ?? 0) + (sizes[middle] ?? 0)) / 2
    const largest = sizes.at(-1) ?? 0
    if (median > 0 && largest / median >= 3) continue
    issues.push(issue('cover_focus', '封面需要更明确的首读焦点：让一张图片、图表或表格占据至少 25% 画布，或让最大标题达到可见文字中位字号的 3 倍。', page.id, undefined, 'warning'))
  }
  return issues
}

function checkChartData(page: DeckPage, element: DeckElement): DeckIssue[] {
  const chart = element.chart
  if (!chart || chart.categories.length < 1 || chart.series.length < 1) {
    return [issue('chart_data', `图表 ${element.id} 缺少类别或序列`, page.id, element.id)]
  }
  for (const series of chart.series) {
    if (series.values.length !== chart.categories.length || series.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      return [issue('chart_data', `图表 ${element.id} 的序列「${series.name}」与类别列数不一致，或含有非数字`, page.id, element.id)]
    }
  }
  return []
}

function checkChartSeriesColor(page: DeckPage, element: DeckElement): DeckIssue[] {
  const chart = element.chart
  const colors = chart?.colors
  if (!chart || !colors?.length) return []
  if (colors.some(color => !COLOR_TOKEN.test(color))) {
    return [issue('chart_series_color', `图表 ${element.id} 的颜色需要是 #RRGGBB、#RRGGBBAA 或主题色引用`, page.id, element.id)]
  }
  return []
}

function slotFor(page: DeckPage, elementId: string): ImageSlot | undefined {
  return page.imageSlots?.slots.find(slot => slot.elementId === elementId)
}

function checkImage(page: DeckPage, element: DeckElement, options: CheckOptions): DeckIssue[] {
  const issues: DeckIssue[] = []
  const src = element.src?.trim() ?? ''
  const slot = slotFor(page, element.id)
  if (/^https?:\/\//i.test(src)) {
    issues.push(issue('remote_image', `图片 ${element.id} 使用了网络地址。请先把图片放进工作区再引用。`, page.id, element.id))
  } else if (isPlaceholderImageSrc(src)) {
    issues.push(issue('missing_asset', `图片 ${element.id} 仍是占位。没有生图提供方时保留占位并提示，不要当成已配图。`, page.id, element.id, 'warning'))
  } else if (!src && slot) {
    issues.push(issue('missing_asset', `图片槽 ${element.id} 没有素材。`, page.id, element.id))
  } else if (src && options.assetExists && !options.assetExists(src)) {
    issues.push(issue('missing_asset', `找不到图片资源 ${src}。`, page.id, element.id))
  }
  const fit = element.fit as string | undefined
  if (fit && fit !== 'fill' && fit !== 'contain' && fit !== 'cover') {
    issues.push(issue('image_fit', `图片 ${element.id} 的 fit 只能是 fill、contain 或 cover。`, page.id, element.id))
  }
  if (slot && element.bounds.w > 0 && element.bounds.h > 0) {
    const actual = element.bounds.w / element.bounds.h
    const expected = ASPECT[slot.aspectRatio]
    if (expected && Math.abs(actual - expected) / expected > 0.08) {
      issues.push(issue('image_fit', `图片槽 ${element.id} 的画面比例是 ${slot.aspectRatio}，当前框是 ${element.bounds.w.toFixed(0)}×${element.bounds.h.toFixed(0)}，比例不符。`, page.id, element.id))
    }
  }
  if (element.crop) {
    const { l, t, r, b } = element.crop
    const values = [l, t, r, b]
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      issues.push(issue('image_crop', `图片 ${element.id} 的裁剪应是四边的非负比例。`, page.id, element.id))
    } else if (l + r >= 1 || t + b >= 1) {
      issues.push(issue('image_crop', `图片 ${element.id} 的裁剪没有留下有效画面。`, page.id, element.id))
    } else if ((1 - l - r) * (1 - t - b) < 0.5) {
      issues.push(issue('image_crop', `图片 ${element.id} 的主体被裁掉太多，请保留至少一半画面。`, page.id, element.id))
    }
  }
  return issues
}

function areaOverlap(left: Bounds, right: Bounds): { area: number; width: number } {
  const width = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return { area: width * height, width }
}

function checkTextLayer(page: DeckPage): DeckIssue[] {
  const issues: DeckIssue[] = []
  page.elements.forEach((element, index) => {
    if (element.type !== 'text' || element.bounds.w <= 0 || element.bounds.h <= 0) return
    const textArea = element.bounds.w * element.bounds.h
    for (const earlier of page.elements.slice(0, index)) {
      if (earlier.type !== 'table' && earlier.type !== 'chart') continue
      if (areaOverlap(element.bounds, earlier.bounds).area / textArea >= 0.15) {
        issues.push(issue('text_occlusion', `文本 ${element.id} 与 ${earlier.id} 的内容区域重叠。`, page.id, element.id, 'warning'))
        break
      }
    }
    for (const later of page.elements.slice(index + 1)) {
      if (later.type === 'shape' && (later.shape === 'line' || later.bounds.h <= 2 || later.bounds.w <= 2)) continue
      if (later.type !== 'table' && later.type !== 'chart' && later.type !== 'image' && later.type !== 'shape') continue
      const intersection = areaOverlap(element.bounds, later.bounds)
      if (intersection.area / textArea >= 0.15 && later.type !== 'shape') {
        issues.push(issue('text_occlusion', `文本 ${element.id} 可能被后绘制的 ${later.id} 遮挡。`, page.id, element.id, 'warning'))
        break
      }
      if (later.bounds.y > element.bounds.y && later.bounds.y < element.bounds.y + element.bounds.h && intersection.width / element.bounds.w >= 0.3 && later.type !== 'shape') {
        issues.push(issue('text_drift', `文本 ${element.id} 可能跨入下方 ${later.id} 的边界。`, page.id, element.id, 'warning'))
        break
      }
    }
  })
  return issues
}
