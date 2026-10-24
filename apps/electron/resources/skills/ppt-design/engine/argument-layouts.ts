/** Reusable argument layouts. Slot bounds and textCapacity are the geometry deck_check recognizes. */

import { defaultLeading, fitSlack, literalNewline, orphanLines, textWidth, wrapText } from './metrics.ts'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DECK_FORMAT,
  DECK_VERSION,
  type Bounds,
  type ChartSpec,
  type Deck,
  type DeckElement,
  type DeckPage,
  type ShadowSpec,
  type TextCapacity,
  type Theme,
} from './types.ts'

export const argumentTheme: Theme = {
  id: 'argument-library',
  name: '论证版式',
  margin: 36,
  colors: {
    ink: '#141414',
    paper: '#F7F7F5',
    muted: '#5A5A5A',
    accent: '#C8102E',
    line: '#141414',
    surface: '#EEEEEE',
    inverse: '#FFFFFF',
    signal: '#C8102E',
  },
  fonts: {
    cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
    latin: { mac: 'Helvetica Neue', win: 'Arial', linux: 'Noto Sans' },
  },
  type: {
    display: { min: 28, max: 44 },
    title: { min: 22, max: 32 },
    body: { min: 14, max: 18 },
    caption: { min: 11, max: 13 },
  },
  source: 'Selection 论证版式库。示例数字只说明几何，正式稿换成用户材料。',
}

export type ArgumentSlot = {
  id: string
  kind: DeckElement['type']
  bounds: Bounds
  textCapacity?: TextCapacity
  required: true
}

export type ArgumentLayout = {
  id: string
  name: string
  relation: string
  summary: string
  slots: ArgumentSlot[]
}

const SHADOW: ShadowSpec = { color: '#141414', opacity: 0.12, blur: 16, offset: 4, angle: 90 }
const SOURCE = '示例数字，正式稿换成用户材料。'

type TextStyle = {
  color?: string
  bold?: boolean
  family?: '$cjk' | '$latin'
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  leading?: number
}

function capacity(value: string, width: number, height: number, size: number, leading: number): TextCapacity {
  const maxLines = Math.max(1, Math.floor((height + 0.5) / (size * leading)))
  const perLine = Math.max(1, Math.floor(width / size))
  const glyphs = Array.from(value.replaceAll('\n', '')).length
  return { maxChars: Math.max(glyphs, perLine * maxLines), maxLines }
}

function text(id: string, value: string, x: number, y: number, w: number, h: number, size: number, style: TextStyle = {}): DeckElement {
  const leading = style.leading ?? defaultLeading(size)
  const bold = style.bold ?? false
  const element: DeckElement = {
    id,
    type: 'text',
    role: 'content',
    bounds: { x, y, w, h },
    text: value,
    textCapacity: capacity(value, w, h, size, leading),
    font: {
      family: style.family ?? '$cjk',
      size,
      weight: bold ? 'bold' : 'regular',
      color: style.color ?? '$ink',
      align: style.align,
      valign: style.valign ?? 'top',
      leading,
    },
  }
  assertFits(element)
  return element
}

function assertFits(element: DeckElement): void {
  const font = element.font
  const value = element.text ?? ''
  if (!font) return
  const bold = font.weight === 'bold'
  const lines = wrapText(value, element.bounds.w, font.size, bold)
  const problems: string[] = []
  if (literalNewline(value)) problems.push('字面换行')
  const glyphs = Array.from(value.replaceAll('\n', '')).length
  if (glyphs > (element.textCapacity?.maxChars ?? 0)) problems.push('字数')
  if (lines.length > (element.textCapacity?.maxLines ?? 0)) problems.push(`行数 ${lines.length} ${JSON.stringify(lines)}`)
  const leading = font.leading ?? defaultLeading(font.size)
  const needed = lines.length <= 1 ? font.size : font.size + (lines.length - 1) * font.size * leading
  if (needed > element.bounds.h + 1.5) problems.push(`高度 ${needed.toFixed(1)}`)
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, font.size, bold)), 0)
  if (widest > element.bounds.w + fitSlack(font.size)) problems.push(`宽度 ${widest.toFixed(1)}`)
  problems.push(...orphanLines(lines))
  if (problems.length) throw new Error(`${element.id}: ${problems.join('；')}`)
}

function panel(id: string, x: number, y: number, w: number, h: number, fill: string, shape: 'rect' | 'roundRect' | 'ellipse' = 'roundRect', radius = 12, shadow = true): DeckElement {
  return {
    id,
    type: 'shape',
    shape,
    role: 'panel',
    bounds: { x, y, w, h },
    fill,
    radius: shape === 'roundRect' ? radius : undefined,
    shadow: shadow && shape !== 'ellipse' ? SHADOW : undefined,
  }
}

function accentTick(id: string, x: number, y: number, w: number): DeckElement {
  return { id, type: 'shape', shape: 'rect', role: 'decoration', bounds: { x, y, w, h: 4 }, fill: '$accent' }
}

function rule(id: string, x: number, y: number, w: number): DeckElement {
  return { id, type: 'shape', shape: 'line', role: 'rule', bounds: { x, y, w, h: 1 }, line: { color: '$line', width: 1 } }
}

function deco(id: string, x: number, y: number, w: number, h: number, fill: string): DeckElement {
  return { id, type: 'shape', shape: 'rect', role: 'decoration', bounds: { x, y, w, h }, fill }
}

function link(id: string, x1: number, y1: number, x2: number, y2: number): DeckElement {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const w = Math.max(1, Math.abs(x2 - x1))
  const h = Math.max(1, Math.abs(y2 - y1))
  return {
    id,
    type: 'shape',
    shape: 'line',
    role: 'decoration',
    bounds: { x, y, w, h },
    line: {
      color: '$accent',
      width: 1.5,
      points: { x1: x1 - x, y1: y1 - y, x2: x2 - x, y2: y2 - y },
    },
  }
}

function chartEl(id: string, x: number, y: number, w: number, h: number, spec: ChartSpec): DeckElement {
  return { id, type: 'chart', role: 'content', bounds: { x, y, w, h }, chart: { showLegend: false, ...spec } }
}

function rail(): DeckElement {
  return { id: 'rail', type: 'shape', shape: 'rect', role: 'decoration', bounds: { x: 0, y: 0, w: 8, h: 540 }, fill: '$accent' }
}

function furniture(kicker: string, title: string, exhibit: string, pageNo: string): DeckElement[] {
  return [
    rail(),
    text('kicker', kicker, 40, 16, 460, 18, 12, { bold: true, color: '$accent' }),
    text('exhibit', exhibit, 680, 16, 240, 18, 12, { color: '$muted', align: 'right', family: '$latin' }),
    text('title', title, 40, 40, 880, 34, 26, { bold: true }),
    rule('top-rule', 40, 82, 880),
    rule('footer-rule', 40, 498, 880),
    text('source', SOURCE, 40, 508, 700, 20, 11, { color: '$muted' }),
    text('page-no', pageNo, 820, 508, 100, 20, 11, { bold: true, align: 'right', family: '$latin' }),
  ]
}

type BuiltLayout = ArgumentLayout & { build: () => DeckPage }

function finish(id: string, name: string, relation: string, summary: string, notes: string, elements: DeckElement[]): DeckPage {
  const seen = new Set<string>()
  for (const element of elements) {
    if (seen.has(element.id)) throw new Error(`${id} 重复元素 ${element.id}`)
    seen.add(element.id)
  }
  return { id, layout: id, name, background: '$paper', elements, notes }
}

function slotsOf(page: DeckPage): ArgumentSlot[] {
  return page.elements
    .filter(element => element.type === 'text' || element.type === 'chart' || element.type === 'table' || (element.type === 'shape' && element.role === 'panel'))
    .map(element => ({
      id: element.id,
      kind: element.type,
      bounds: { ...element.bounds },
      textCapacity: element.textCapacity ? { ...element.textCapacity } : undefined,
      required: true as const,
    }))
}

function conclusion(): DeckElement[] {
  const cards = [
    { id: 'stock', value: '45 天', label: '库存周转', note: '比峰值少 19 天' },
    { id: 'stockout', value: '12%', label: '缺货率', note: '三个仓一起下降' },
    { id: 'sites', value: '3 仓', label: '先恢复', note: '华东、华南、华北' },
  ]
  const elements: DeckElement[] = [
    panel('claim-panel', 0, 0, 408, 540, '$accent', 'rect', 0),
    text('kicker', '结论先行', 36, 48, 320, 22, 14, { bold: true, color: '$inverse' }),
    text('claim', '周转先回到 45 天\n再决定是否扩产', 36, 168, 332, 120, 32, { bold: true, color: '$inverse', leading: 1.12 }),
    text('claim-note', '三条证据指向同一件事', 36, 312, 332, 28, 16, { color: '$inverse' }),
    text('source', SOURCE, 36, 488, 332, 22, 12, { color: '$inverse' }),
  ]
  cards.forEach((card, index) => {
    const y = 36 + index * 156
    elements.push(
      panel(`${card.id}-card`, 440, y, 480, 140, '$surface'),
      accentTick(`${card.id}-tick`, 440, y, 56),
      text(`${card.id}-value`, card.value, 464, y + 28, 200, 48, 32, { bold: true, color: '$accent' }),
      text(`${card.id}-label`, card.label, 464, y + 84, 180, 28, 16, { bold: true }),
      text(`${card.id}-note`, card.note, 680, y + 40, 210, 56, 16, { color: '$muted', valign: 'middle' }),
    )
  })
  elements.push(text('page-no', '01', 820, 500, 100, 20, 12, { bold: true, align: 'right', family: '$latin', color: '$muted' }))
  return elements
}

function evidenceTree(): DeckElement[] {
  const children = [
    { id: 'gap', title: '缺货还在', body: '三个仓没有同时恢复' },
    { id: 'cash', title: '现金还紧', body: '周期停在 18 天' },
    { id: 'order', title: '订单不稳', body: '没有连续两个季度' },
  ]
  const elements: DeckElement[] = [
    ...furniture('证据树', '周转先于扩产', '02', '02'),
    panel('root', 250, 108, 460, 100, '$accent'),
    text('root-title', '先看周转，再谈产能', 274, 124, 412, 36, 22, { bold: true, color: '$inverse', align: 'center' }),
    text('root-note', '三条证据互相独立', 274, 164, 412, 24, 14, { color: '$inverse', align: 'center' }),
  ]
  children.forEach((child, index) => {
    const x = 48 + index * 304
    elements.push(
      panel(`${child.id}-card`, x, 292, 280, 172, '$surface'),
      accentTick(`${child.id}-tick`, x, 292, 48),
      text(`${child.id}-index`, `0${index + 1}`, x + 24, 316, 80, 20, 12, { bold: true, color: '$accent', family: '$latin' }),
      text(`${child.id}-title`, child.title, x + 24, 344, 232, 32, 20, { bold: true }),
      text(`${child.id}-body`, child.body, x + 24, 386, 232, 48, 15, { color: '$muted' }),
      link(`link-${child.id}`, 480, 208, x + 140, 292),
    )
  })
  return elements
}

function matrix(): DeckElement[] {
  const cells = [
    { id: 'do', title: '先做', kicker: '高影响 · 好做', body: '把周转打回 45 天', fill: '$accent', titleColor: '$inverse', bodyColor: '$inverse' },
    { id: 'plan', title: '排期', kicker: '高影响 · 难做', body: '第三仓放到下季', fill: '$surface', titleColor: '$ink', bodyColor: '$muted' },
    { id: 'watch', title: '观察', kicker: '低影响 · 好做', body: '人效先记在表上', fill: '$surface', titleColor: '$ink', bodyColor: '$muted' },
    { id: 'stop', title: '不做', kicker: '低影响 · 难做', body: '现在不加产线', fill: '$ink', titleColor: '$inverse', bodyColor: '$inverse' },
  ]
  const elements = furniture('矩阵', '只突出应该先做的那一格', '03', '03')
  cells.forEach((cell, index) => {
    const x = index % 2 === 0 ? 40 : 508
    const y = index < 2 ? 108 : 300
    elements.push(
      panel(`${cell.id}-card`, x, y, 412, 172, cell.fill),
      text(`${cell.id}-kicker`, cell.kicker, x + 24, y + 22, 360, 20, 13, { bold: true, color: cell.bodyColor }),
      text(`${cell.id}-title`, cell.title, x + 24, y + 52, 360, 40, 28, { bold: true, color: cell.titleColor }),
      text(`${cell.id}-body`, cell.body, x + 24, y + 108, 360, 36, 16, { color: cell.bodyColor }),
    )
  })
  return elements
}

function waterfall(): DeckElement[] {
  const notes = [
    { id: 'open', value: '120', label: '期初库存', note: '变化从这个数起算' },
    { id: 'move', value: '+27', label: '涨价与新品', note: '涨价 18，新品 9' },
    { id: 'end', value: '117', label: '期末库存', note: '流失 30 后轧平' },
  ]
  const elements: DeckElement[] = [
    ...furniture('瀑布', '期末只比期初少 3', '04', '04'),
    chartEl('bridge', 40, 108, 520, 360, {
      kind: 'waterfall',
      categories: ['期初', '涨价', '流失', '新品', '期末'],
      series: [{ name: '库存', values: [120, 18, -30, 9, 117] }],
      colors: ['$paper', '$accent', '$muted'],
    }),
  ]
  notes.forEach((item, index) => {
    const y = 108 + index * 120
    elements.push(
      panel(`${item.id}-card`, 584, y, 336, 108, '$surface'),
      accentTick(`${item.id}-tick`, 584, y, 48),
      text(`${item.id}-value`, item.value, 608, y + 18, 140, 40, 26, { bold: true, color: '$accent' }),
      text(`${item.id}-label`, item.label, 760, y + 24, 136, 28, 16, { bold: true }),
      text(`${item.id}-note`, item.note, 608, y + 64, 280, 24, 13, { color: '$muted' }),
    )
  })
  return elements
}

function trend(): DeckElement[] {
  return [
    ...furniture('趋势', '六月是这半年的高点', '05', '05'),
    chartEl('trend', 40, 112, 560, 356, {
      kind: 'line',
      categories: ['一月', '二月', '三月', '四月', '五月', '六月'],
      series: [{ name: '周转天数', values: [42, 48, 45, 61, 58, 74] }],
      colors: ['$accent'],
      valMin: 0,
      valMax: 90,
    }),
    panel('dip-card', 624, 128, 296, 150, '$surface'),
    accentTick('dip-tick', 624, 128, 48),
    text('dip-kicker', '三月', 648, 152, 248, 20, 13, { bold: true, color: '$accent' }),
    text('dip-title', '回落到 45', 648, 180, 248, 36, 22, { bold: true }),
    text('dip-body', '补货还没跟上节后', 648, 224, 248, 28, 14, { color: '$muted' }),
    panel('peak-card', 624, 300, 296, 150, '$accent'),
    text('peak-kicker', '六月', 648, 324, 248, 20, 13, { bold: true, color: '$inverse' }),
    text('peak-title', '升到 74', 648, 352, 248, 36, 22, { bold: true, color: '$inverse' }),
    text('peak-body', '高点还没有第二个月', 648, 396, 248, 28, 14, { color: '$inverse' }),
  ]
}

function scorecard(): DeckElement[] {
  const rows = [
    { id: 'turn', name: '库存周转', value: '45 天', delta: '−19', note: '达标', width: 210 },
    { id: 'miss', name: '缺货率', value: '3.1%', delta: '−1.4', note: '改善', width: 96 },
    { id: 'fill', name: '履约', value: '96%', delta: '+2', note: '稳住', width: 250 },
    { id: 'labor', name: '人效', value: '1.8', delta: '+0.2', note: '关注', width: 120 },
    { id: 'cash', name: '现金周期', value: '18 天', delta: '−6', note: '收紧', width: 78 },
  ]
  const elements = furniture('计分表', '偏离的行和稳住的行分开', '06', '06')
  rows.forEach((row, index) => {
    const y = 104 + index * 76
    const alert = row.delta.startsWith('+')
    elements.push(
      panel(`${row.id}-row`, 40, y, 880, 68, '$surface', 'roundRect', 10),
      text(`${row.id}-name`, row.name, 64, y + 20, 160, 28, 16, { bold: true }),
      text(`${row.id}-value`, row.value, 236, y + 18, 110, 32, 18, { bold: true, color: '$accent' }),
      deco(`${row.id}-track`, 360, y + 28, 260, 12, '$paper'),
      deco(`${row.id}-bar`, 360, y + 28, row.width, 12, '$accent'),
      panel(`${row.id}-pill`, 648, y + 16, 92, 36, alert ? '$accent' : '$ink', 'roundRect', 18),
      text(`${row.id}-delta`, row.delta, 656, y + 22, 76, 24, 14, { bold: true, color: '$inverse', align: 'center', family: '$latin' }),
      text(`${row.id}-note`, row.note, 760, y + 20, 130, 28, 15, { color: '$muted' }),
    )
  })
  return elements
}

function gantt(): DeckElement[] {
  const lanes = [
    { id: 'safety', name: '补安全库存', start: 0, span: 5 },
    { id: 'freight', name: '重谈运费', start: 3, span: 4 },
    { id: 'site', name: '开第三仓', start: 6, span: 4 },
    { id: 'review', name: '复盘扩产', start: 10, span: 2 },
  ]
  const trackX = 220
  const trackW = 680
  const total = 12
  const elements = [
    ...furniture('路线', '扩产放在库存稳住之后', '07', '07'),
    text('q1', '一季', 220, 104, 72, 22, 13, { bold: true, color: '$muted' }),
    text('q2', '二季', 390, 104, 72, 22, 13, { bold: true, color: '$muted' }),
    text('q3', '三季', 560, 104, 72, 22, 13, { bold: true, color: '$muted' }),
    text('q4', '四季', 730, 104, 72, 22, 13, { bold: true, color: '$muted' }),
  ]
  lanes.forEach((lane, index) => {
    const y = 146 + index * 82
    const barX = trackX + (lane.start / total) * trackW
    const barW = (lane.span / total) * trackW
    elements.push(
      text(`${lane.id}-name`, lane.name, 40, y + 16, 164, 28, 15, { bold: true }),
      panel(`${lane.id}-track`, trackX, y + 22, trackW, 16, '$surface', 'roundRect', 8, false),
      panel(`${lane.id}-bar`, barX, y + 22, barW, 16, '$accent', 'roundRect', 8, false),
    )
  })
  elements.push(
    deco('now-line', 476, 146, 2, 324, '$ink'),
    text('now-label', '现在', 468, 104, 56, 22, 12, { bold: true, color: '$ink', align: 'center' }),
  )
  return elements
}

function architecture(): DeckElement[] {
  const layers = [
    { id: 'user', name: '用户', fill: '$surface', ink: '$ink', items: ['门店', '经销商', '总部'] },
    { id: 'channel', name: '渠道', fill: '$surface', ink: '$ink', items: ['小程序', '业务员', '开放接口'] },
    { id: 'core', name: '中台', fill: '$accent', ink: '$inverse', items: ['库存', '订单', '结算'] },
    { id: 'base', name: '底座', fill: '$ink', ink: '$inverse', items: ['仓配', '主数据', '权限'] },
  ]
  const elements = furniture('架构', '扩产前先看中台承不承得住', '08', '08')
  layers.forEach((layer, index) => {
    const y = 104 + index * 94
    const pillFill = layer.fill === '$surface' ? '$paper' : '$inverse'
    const pillInk = '$ink'
    elements.push(
      panel(`${layer.id}-band`, 40, y, 880, 82, layer.fill, 'roundRect', 12),
      text(`${layer.id}-name`, layer.name, 64, y + 26, 96, 32, 20, { bold: true, color: layer.ink }),
    )
    layer.items.forEach((item, itemIndex) => {
      const x = 190 + itemIndex * 230
      elements.push(
        panel(`${layer.id}-pill-${itemIndex}`, x, y + 20, 200, 42, pillFill, 'roundRect', 21),
        text(`${layer.id}-item-${itemIndex}`, item, x + 16, y + 30, 168, 24, 15, { bold: true, color: pillInk, align: 'center' }),
      )
    })
  })
  return elements
}

function caseCompare(): DeckElement[] {
  const rows = [
    { id: 'turn', label: '周转', left: '62 天', right: '45 天', delta: '−17' },
    { id: 'miss', label: '缺货', left: '8%', right: '3%', delta: '−5' },
    { id: 'days', label: '人天', left: '14', right: '9', delta: '−5' },
  ]
  const elements: DeckElement[] = [
    ...furniture('对照', '目标仓比现状少 17 天', '09', '09'),
    panel('left-card', 40, 108, 400, 364, '$surface'),
    accentTick('left-tick', 40, 108, 56),
    text('left-kicker', '现状', 64, 132, 340, 22, 13, { bold: true, color: '$accent' }),
    text('left-title', '现在的三个仓', 64, 160, 340, 36, 22, { bold: true }),
    panel('right-card', 560, 108, 360, 364, '$accent'),
    text('right-kicker', '目标', 584, 132, 312, 22, 13, { bold: true, color: '$inverse' }),
    text('right-title', '先恢复到的水位', 584, 160, 312, 36, 22, { bold: true, color: '$inverse' }),
  ]
  rows.forEach((row, index) => {
    const y = 230 + index * 70
    elements.push(
      text(`left-${row.id}-label`, row.label, 64, y, 90, 28, 15, { color: '$muted' }),
      text(`left-${row.id}-value`, row.left, 160, y - 4, 180, 36, 22, { bold: true }),
      panel(`${row.id}-chip`, 460, y - 4, 80, 36, '$ink', 'roundRect', 18),
      text(`${row.id}-delta`, row.delta, 468, y + 2, 64, 22, 14, { bold: true, color: '$inverse', align: 'center', family: '$latin' }),
      text(`right-${row.id}-label`, row.label, 584, y, 80, 28, 15, { color: '$inverse' }),
      text(`right-${row.id}-value`, row.right, 680, y - 4, 210, 36, 22, { bold: true, color: '$inverse' }),
    )
  })
  return elements
}

function funnel(): DeckElement[] {
  const steps = [
    { id: 'lead', label: '线索 1280', rate: '100% 进池', width: 620 },
    { id: 'quote', label: '报价 820', rate: '64% 报价', width: 480 },
    { id: 'trial', label: '试样 390', rate: '48% 试样', width: 350 },
    { id: 'won', label: '成交 280', rate: '22% 成交', width: 230 },
  ]
  const elements: DeckElement[] = [...furniture('漏斗', '最大流失在报价到成交', '10', '10')]
  steps.forEach((step, index) => {
    const y = 104 + index * 78
    elements.push(
      panel(`${step.id}-bar`, 40, y, step.width, 66, '$accent', 'roundRect', 10),
      text(`${step.id}-label`, step.label, 64, y + 18, 150, 30, 18, { bold: true, color: '$inverse' }),
      text(`${step.id}-rate`, step.rate, 720, y + 18, 200, 30, 16, { bold: true, color: '$ink' }),
    )
  })
  elements.push(
    panel('drop-card', 40, 420, 880, 64, '$ink', 'roundRect', 10),
    text('drop-copy', '报价到成交掉得最多，先改报价单，不先加产线。', 64, 438, 832, 28, 16, { bold: true, color: '$inverse' }),
  )
  return elements
}

function process(): DeckElement[] {
  const steps = [
    { id: 'count', title: '盘点', body: '先数清三个仓' },
    { id: 'split', title: '分仓', body: '缺货仓单独补' },
    { id: 'fill', title: '补货', body: '只补安全库存' },
    { id: 'look', title: '复盘', body: '两周后看周转' },
    { id: 'decide', title: '决策', body: '再谈是否扩产' },
  ]
  const elements: DeckElement[] = [...furniture('流程', '交接写清之后才加快', '11', '11')]
  steps.forEach((step, index) => {
    const x = 56 + index * 180
    elements.push(
      panel(`${step.id}-mark`, x + 38, 128, 64, 64, '$accent', 'ellipse'),
      text(`${step.id}-num`, String(index + 1), x + 38, 146, 64, 28, 20, { bold: true, color: '$inverse', align: 'center', family: '$latin' }),
      text(`${step.id}-title`, step.title, x, 212, 140, 28, 18, { bold: true, align: 'center' }),
      text(`${step.id}-body`, step.body, x, 246, 140, 32, 14, { color: '$muted', align: 'center' }),
    )
    if (index < steps.length - 1) elements.push(deco(`${step.id}-join`, x + 110, 158, 100, 3, '$accent'))
  })
  elements.push(
    panel('synthesis', 40, 320, 880, 150, '$surface'),
    accentTick('synthesis-tick', 40, 320, 64),
    text('synthesis-kicker', '这一页的交接', 68, 348, 400, 22, 13, { bold: true, color: '$accent' }),
    text('synthesis-title', '补货单上写清责任仓', 68, 380, 760, 36, 24, { bold: true }),
    text('synthesis-body', '没有责任仓的步骤，不进入下一周。', 68, 424, 760, 28, 15, { color: '$muted' }),
  )
  return elements
}

function timeline(): DeckElement[] {
  const events = [
    { id: 'spring24', when: '2024 春', title: '缺货扩大', body: '三个仓同时告急', above: true },
    { id: 'autumn24', when: '2024 秋', title: '分仓补货', body: '缺货率开始回落', above: false },
    { id: 'spring25', when: '2025 春', title: '周转回落', body: '回到 45 天水位', above: true },
    { id: 'autumn25', when: '2025 秋', title: '再议扩产', body: '订单连续才加线', above: false },
  ]
  const elements: DeckElement[] = [
    ...furniture('时间线', '扩产排在周转回来之后', '12', '12'),
    deco('spine', 80, 268, 800, 4, '$accent'),
  ]
  events.forEach((event, index) => {
    const x = 48 + index * 228
    const y = event.above ? 112 : 304
    elements.push(
      panel(`${event.id}-card`, x, y, 208, 132, event.above ? '$surface' : '$ink'),
      text(`${event.id}-when`, event.when, x + 16, y + 16, 176, 20, 12, { bold: true, color: event.above ? '$accent' : '$inverse' }),
      text(`${event.id}-title`, event.title, x + 16, y + 44, 176, 30, 18, { bold: true, color: event.above ? '$ink' : '$inverse' }),
      text(`${event.id}-body`, event.body, x + 16, y + 82, 176, 28, 14, { color: event.above ? '$muted' : '$inverse' }),
      deco(`${event.id}-dot`, x + 96, 260, 16, 20, '$accent'),
    )
  })
  return elements
}

function closing(): DeckElement[] {
  return [
    ...furniture('收束', '下一步只做哪一件？', '13', '13'),
    panel('now-card', 40, 140, 424, 320, '$accent'),
    text('now-kicker', '本周', 68, 172, 360, 22, 14, { bold: true, color: '$inverse' }),
    text('now-title', '把周转锁回 45 天', 68, 214, 360, 80, 28, { bold: true, color: '$inverse', leading: 1.15 }),
    text('now-body', '三个仓分开补，不新开产线。', 68, 320, 360, 64, 16, { color: '$inverse' }),
    panel('later-card', 496, 140, 424, 320, '$surface'),
    accentTick('later-tick', 496, 140, 56),
    text('later-kicker', '下月再议', 524, 172, 360, 22, 14, { bold: true, color: '$accent' }),
    text('later-title', '是否增加一条产线', 524, 214, 360, 80, 28, { bold: true, leading: 1.15 }),
    text('later-body', '订单要连续两个季度。', 524, 320, 360, 64, 16, { color: '$muted' }),
  ]
}

function decision(): DeckElement[] {
  return [
    ...furniture('取舍', '先收回周转，不急着扩产', '14', '14'),
    panel('yes-card', 40, 116, 520, 352, '$accent'),
    text('yes-kicker', '建议', 68, 144, 200, 22, 14, { bold: true, color: '$inverse' }),
    text('yes-title', '先把周转打回去', 68, 180, 460, 44, 28, { bold: true, color: '$inverse' }),
    text('yes-1', '缺货还在三个仓', 68, 252, 440, 32, 16, { color: '$inverse' }),
    text('yes-2', '现金周期还没稳住', 68, 292, 440, 32, 16, { color: '$inverse' }),
    text('yes-3', '扩产要等周转回到 45 天', 68, 332, 440, 32, 16, { color: '$inverse' }),
    panel('no-card', 584, 116, 336, 352, '$surface'),
    accentTick('no-tick', 584, 116, 56),
    text('no-kicker', '先不做', 608, 144, 280, 22, 14, { bold: true, color: '$accent' }),
    text('no-title', '立刻加产线', 608, 180, 280, 44, 26, { bold: true }),
    text('no-1', '订单还没连续', 608, 252, 280, 32, 16, { color: '$muted' }),
    text('no-2', '第三仓还没满', 608, 292, 280, 32, 16, { color: '$muted' }),
    text('no-3', '人效没有余量', 608, 332, 280, 32, 16, { color: '$muted' }),
  ]
}

const SPECS: Array<{ id: string; name: string; relation: string; summary: string; notes: string; build: () => DeckElement[] }> = [
  { id: 'conclusion', name: '结论页', relation: '结论先行', summary: '判断先占左半页，右边只留三个证据。', notes: '替换左栏判断和右栏三个数字。数字要能对上来源。', build: conclusion },
  { id: 'evidence-tree', name: '证据树', relation: '分叉', summary: '一个判断连到三条互相独立的证据。', notes: '三条证据不能互相包含。连线只表示支撑，不表示顺序。', build: evidenceTree },
  { id: 'matrix-2x2', name: '矩阵', relation: '矩阵', summary: '两个维度，只把先做的那一格做成强调色。', notes: '高影响且好做的格子保持强调。不要四格同等强调。', build: matrix },
  { id: 'waterfall', name: '瀑布图', relation: '桥', summary: '起点加变化等于终点，右侧只解释轧平后的读法。', notes: '瀑布图必须轧平。右侧句子解释桥，不另起一套数字。', build: waterfall },
  { id: 'trend-annotated', name: '趋势加标注', relation: '序列', summary: '一条序列，旁边标出回落和高点。', notes: '标注指向图上的月份，不写图里没有的拐点。', build: trend },
  { id: 'scorecard', name: '计分表', relation: '清单', summary: '每行一个指标、当前值、条形和偏离。', notes: '偏离的行用强调色药丸，稳住的行用深色药丸。', build: scorecard },
  { id: 'gantt-roadmap', name: '甘特路线图', relation: '路线', summary: '四条工作按季度铺开，现在线切在复盘之前。', notes: '现在线不要压到还没开始的扩产条上。', build: gantt },
  { id: 'architecture', name: '架构', relation: '分层', summary: '用户、渠道、中台、底座四层，中台用强调色。', notes: '每层的药丸是这一层的对象，不要把流程步骤塞进架构。', build: architecture },
  { id: 'case-compare', name: '案例对比', relation: '对照', summary: '现状和目标用同一组指标，差额放在中间。', notes: '左右行名对齐。中间的差额要能从左右两个数减出来。', build: caseCompare },
  { id: 'funnel', name: '漏斗', relation: '转化', summary: '四段收窄，右侧写转化，底部点出最大流失。', notes: '条的长短跟着数量走。底部结论只讲掉得最多的那一段。', build: funnel },
  { id: 'process', name: '流程', relation: '流程', summary: '五步从左到右，底部写清交接。', notes: '连线必须对得上句子里的顺序。不要画没有交接的箭头。', build: process },
  { id: 'timeline', name: '时间线', relation: '时间', summary: '四个时点交错排在脊柱两侧。', notes: '时间从左到右。上下交错只为读得开，不表示两组对象。', build: timeline },
  { id: 'closing', name: '收束', relation: '收束', summary: '一个问题，一项本周行动，一项以后再议。', notes: '本周只有一件事。以后再议的条件写在右卡。', build: closing },
  { id: 'decision', name: '取舍', relation: '取舍', summary: '左边是建议，右边是这次不做的事。', notes: '建议和否决使用同一组事实，不引入新数字。', build: decision },
]

const BUILT: BuiltLayout[] = SPECS.map(spec => {
  const page = finish(spec.id, spec.name, spec.relation, spec.summary, spec.notes, spec.build())
  return {
    id: spec.id,
    name: spec.name,
    relation: spec.relation,
    summary: spec.summary,
    slots: slotsOf(page),
    build: () => finish(spec.id, spec.name, spec.relation, spec.summary, spec.notes, spec.build()),
  }
})

const BY_ID = new Map(BUILT.map(layout => [layout.id, layout]))

export const argumentLayouts: ArgumentLayout[] = BUILT.map(({ id, name, relation, summary, slots }) => ({ id, name, relation, summary, slots }))

export function argumentLayoutById(id: string): ArgumentLayout | undefined {
  const layout = BY_ID.get(id)
  if (!layout) return undefined
  return { id: layout.id, name: layout.name, relation: layout.relation, summary: layout.summary, slots: layout.slots }
}

export function argumentLayoutCatalog(): ArgumentLayout[] {
  return argumentLayouts.map(layout => ({ ...layout, slots: layout.slots.map(slot => ({ ...slot, bounds: { ...slot.bounds }, textCapacity: slot.textCapacity ? { ...slot.textCapacity } : undefined })) }))
}

export function buildArgumentPage(id: string, textOverrides: Record<string, string> = {}): DeckPage {
  const layout = BY_ID.get(id)
  if (!layout) throw new Error(`未知论证版式 ${id}`)
  const page = layout.build()
  if (Object.keys(textOverrides).length === 0) return page
  return {
    ...page,
    elements: page.elements.map(element => {
      const next = textOverrides[element.id]
      if (next === undefined || element.type !== 'text') return element
      return { ...element, text: next }
    }),
  }
}

export function buildArgumentDeck(theme: Theme = argumentTheme): Deck {
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: '论证版式库',
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    theme,
    pages: argumentLayouts.map(layout => buildArgumentPage(layout.id)),
  }
}
