import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  canvasSupported,
  comboSeriesRoles,
  DECK_FORMAT,
  DECK_VERSION,
  type Bounds,
  type ChartSeries,
  type ChartSpec,
  type ColorStop,
  type Deck,
  type GradientFill,
  type PatternFill,
  type ShadowSpec,
  type DeckElement,
  type DeckIssue,
  type DeckPage,
  type FontFace,
  type TableSpec,
  type Theme,
} from './types.ts'

const HEX = /^#[0-9A-Fa-f]{6}$/
const FONT_TOKEN = /^\$cjk$|^\$latin$/
const COLOR_REF = /^(\$[A-Za-z][A-Za-z0-9_-]*|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8})$/

export function issue(code: DeckIssue['code'], message: string, pageId?: string, elementId?: string): DeckIssue {
  return { code, message, pageId, elementId }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function rejectUnknown(source: Record<string, unknown>, allowed: string[], path: string, issues: DeckIssue[], pageId?: string, elementId?: string): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) issues.push(issue('schema', `${path} 含有未支持字段 ${key}`, pageId, elementId))
  }
}

function need(source: Record<string, unknown>, key: string, path: string, issues: DeckIssue[], pageId?: string, elementId?: string): unknown {
  if (!(key in source)) {
    issues.push(issue('schema', `${path} 缺少 ${key}`, pageId, elementId))
    return undefined
  }
  return source[key]
}

function parseBounds(value: unknown, path: string, issues: DeckIssue[], pageId?: string, elementId?: string): Bounds | null {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path}.bounds 必须是 {x,y,w,h}`, pageId, elementId))
    return null
  }
  rejectUnknown(value, ['x', 'y', 'w', 'h'], `${path}.bounds`, issues, pageId, elementId)
  const box = { x: value.x, y: value.y, w: value.w, h: value.h }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (typeof box[key] !== 'number' || !Number.isFinite(box[key])) {
      issues.push(issue('schema', `${path}.bounds.${key} 必须是有限数字`, pageId, elementId))
      return null
    }
  }
  if ((box.w as number) <= 0 || (box.h as number) <= 0) {
    issues.push(issue('schema', `${path}.bounds 的宽和高必须大于 0`, pageId, elementId))
    return null
  }
  return box as Bounds
}

function parseTheme(value: unknown, issues: DeckIssue[]): Theme | null {
  if (!isObject(value)) {
    issues.push(issue('schema', 'theme 必须是对象'))
    return null
  }
  rejectUnknown(value, ['id', 'name', 'margin', 'colors', 'fonts', 'type', 'source', 'logo'], 'theme', issues)
  const id = need(value, 'id', 'theme', issues)
  const name = need(value, 'name', 'theme', issues)
  const margin = need(value, 'margin', 'theme', issues)
  const colors = need(value, 'colors', 'theme', issues)
  const fonts = need(value, 'fonts', 'theme', issues)
  const type = need(value, 'type', 'theme', issues)
  const source = need(value, 'source', 'theme', issues)
  if (typeof id !== 'string' || !id.trim()) issues.push(issue('schema', 'theme.id 必须是非空字符串'))
  if (typeof name !== 'string' || !name.trim()) issues.push(issue('schema', 'theme.name 必须是非空字符串'))
  if (typeof margin !== 'number' || margin < 0 || margin > 96) issues.push(issue('schema', 'theme.margin 必须在 0 到 96 之间'))
  if (typeof source !== 'string' || !source.trim()) issues.push(issue('schema', 'theme.source 必须说明配色与版式来源'))
  if (value.logo !== undefined && (typeof value.logo !== 'string' || !value.logo.trim())) issues.push(issue('schema', 'theme.logo 必须是非空路径'))
  const parsedColors: Record<string, string> = {}
  if (!isObject(colors)) issues.push(issue('schema', 'theme.colors 必须是对象'))
  else {
    for (const [key, color] of Object.entries(colors)) {
      if (typeof color !== 'string' || !HEX.test(color)) issues.push(issue('schema', `theme.colors.${key} 必须是 #RRGGBB`))
      else parsedColors[key] = color.toUpperCase()
    }
    for (const key of ['ink', 'paper', 'muted', 'accent', 'line', 'surface', 'inverse']) {
      if (!(key in parsedColors)) issues.push(issue('schema', `theme.colors 缺少 ${key}`))
    }
  }
  const parsedFonts = parseFonts(fonts, issues)
  const parsedType = parseType(type, issues)
  if (issues.some(item => item.message.startsWith('theme')) && (!parsedFonts || !parsedType || typeof id !== 'string')) return null
  if (!parsedFonts || !parsedType || typeof id !== 'string' || typeof name !== 'string' || typeof margin !== 'number' || typeof source !== 'string') return null
  return {
    id,
    name,
    margin,
    colors: parsedColors,
    fonts: parsedFonts,
    type: parsedType,
    source,
    logo: typeof value.logo === 'string' ? value.logo : undefined,
  }
}

function parseFonts(value: unknown, issues: DeckIssue[]): Theme['fonts'] | null {
  if (!isObject(value)) {
    issues.push(issue('schema', 'theme.fonts 必须是对象'))
    return null
  }
  rejectUnknown(value, ['cjk', 'latin'], 'theme.fonts', issues)
  const cjk = parseFontPair(value.cjk, 'theme.fonts.cjk', issues)
  const latin = parseFontPair(value.latin, 'theme.fonts.latin', issues)
  if (!cjk || !latin) return null
  return { cjk, latin }
}

function parseFontPair(value: unknown, path: string, issues: DeckIssue[]): Theme['fonts']['cjk'] | null {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path} 必须是对象`))
    return null
  }
  rejectUnknown(value, ['mac', 'win', 'linux'], path, issues)
  const mac = value.mac
  const win = value.win
  const linux = value.linux
  if (typeof mac !== 'string' || !mac.trim() || typeof win !== 'string' || !win.trim() || typeof linux !== 'string' || !linux.trim()) {
    issues.push(issue('schema', `${path} 需要 mac、win、linux 三个非空字体名`))
    return null
  }
  return { mac, win, linux }
}

function parseType(value: unknown, issues: DeckIssue[]): Theme['type'] | null {
  if (!isObject(value)) {
    issues.push(issue('schema', 'theme.type 必须是对象'))
    return null
  }
  rejectUnknown(value, ['display', 'title', 'body', 'caption'], 'theme.type', issues)
  const display = parseRange(value.display, 'theme.type.display', issues)
  const title = parseRange(value.title, 'theme.type.title', issues)
  const body = parseRange(value.body, 'theme.type.body', issues)
  const caption = parseRange(value.caption, 'theme.type.caption', issues)
  if (!display || !title || !body || !caption) return null
  return { display, title, body, caption }
}

function parseRange(value: unknown, path: string, issues: DeckIssue[]): { min: number; max: number } | null {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path} 必须是 {min,max}`))
    return null
  }
  rejectUnknown(value, ['min', 'max'], path, issues)
  if (typeof value.min !== 'number' || typeof value.max !== 'number' || value.min <= 0 || value.max < value.min) {
    issues.push(issue('schema', `${path} 的 min/max 必须是正数且 max ≥ min`))
    return null
  }
  return { min: value.min, max: value.max }
}

function parseChart(value: unknown, path: string, issues: DeckIssue[], pageId: string, elementId: string): ChartSpec | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path}.chart 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['kind', 'categories', 'series', 'colors', 'showValues', 'showLegend', 'valMin', 'valMax', 'holeSize', 'lineWidth', 'markerSize', 'markerColor', 'grid', 'catLabelSize', 'valLabelSize', 'catLabelColor', 'valLabelColor'], `${path}.chart`, issues, pageId, elementId)
  const kinds = ['bar', 'column', 'line', 'pie', 'doughnut', 'waterfall', 'area', 'scatter', 'bubble', 'radar', 'combo', 'stacked', 'stackedPercent']
  if (typeof value.kind !== 'string' || !kinds.includes(value.kind)) {
    issues.push(issue('schema', `${path}.chart.kind 不支持`, pageId, elementId))
    return undefined
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0 || value.categories.some(item => typeof item !== 'string' || !item.trim())) {
    issues.push(issue('schema', `${path}.chart.categories 必须是非空字符串数组`, pageId, elementId))
    return undefined
  }
  if (!Array.isArray(value.series) || value.series.length === 0) {
    issues.push(issue('schema', `${path}.chart.series 必须是非空数组`, pageId, elementId))
    return undefined
  }
  const series: ChartSeries[] = []
  const pointCount = value.categories.length
  const xy = value.kind === 'scatter' || value.kind === 'bubble'
  for (const entry of value.series) {
    if (!isObject(entry)) {
      issues.push(issue('schema', `${path}.chart.series 项必须是对象`, pageId, elementId))
      return undefined
    }
    rejectUnknown(entry, ['name', 'values', 'x', 'sizes', 'render'], `${path}.chart.series`, issues, pageId, elementId)
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      issues.push(issue('schema', `${path}.chart.series.name 必须是非空字符串`, pageId, elementId))
      return undefined
    }
    if (!Array.isArray(entry.values) || entry.values.length !== pointCount || entry.values.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      issues.push(issue('schema', `${path}.chart.series.values 必须与 categories 等长且为有限数字`, pageId, elementId))
      return undefined
    }
    const point = readPointField(entry.x, `${path}.chart.series.x`, pointCount, issues, pageId, elementId)
    if (point === null) return undefined
    if (xy && !point) {
      issues.push(issue('schema', `${path}.chart.series.x 必须与 categories 等长`, pageId, elementId))
      return undefined
    }
    if (!xy && point) {
      issues.push(issue('schema', `${path}.chart.series.x 只用于散点图和气泡图`, pageId, elementId))
      return undefined
    }
    if (point && series[0]?.x && point.some((item, index) => item !== series[0]!.x![index])) {
      issues.push(issue('schema', `${path}.chart 的每条序列必须共用同一组 x`, pageId, elementId))
      return undefined
    }
    const sizes = readPointField(entry.sizes, `${path}.chart.series.sizes`, pointCount, issues, pageId, elementId)
    if (sizes === null) return undefined
    if (value.kind === 'bubble' && (!sizes || sizes.some(item => item <= 0))) {
      issues.push(issue('schema', `${path}.chart.series.sizes 必须是正数，并与 categories 等长`, pageId, elementId))
      return undefined
    }
    if (value.kind !== 'bubble' && sizes) {
      issues.push(issue('schema', `${path}.chart.series.sizes 只用于气泡图`, pageId, elementId))
      return undefined
    }
    if (entry.render !== undefined && entry.render !== 'column' && entry.render !== 'line') {
      issues.push(issue('schema', `${path}.chart.series.render 只能是 column 或 line`, pageId, elementId))
      return undefined
    }
    if (value.kind !== 'combo' && entry.render !== undefined) {
      issues.push(issue('schema', `${path}.chart.series.render 只用于柱线组合`, pageId, elementId))
      return undefined
    }
    series.push({
      name: entry.name,
      values: entry.values as number[],
      x: point,
      sizes: sizes ?? undefined,
      render: entry.render === 'column' || entry.render === 'line' ? entry.render : undefined,
    })
  }
  if (value.kind === 'waterfall' && (series.length !== 1 || value.categories.length < 3)) {
    issues.push(issue('schema', `${path}.chart 瀑布图需要一条序列，且至少三个类别（起点、变化、终点）`, pageId, elementId))
    return undefined
  }
  if (value.kind === 'radar' && value.categories.length < 3) {
    issues.push(issue('schema', `${path}.chart 雷达图至少三个类别`, pageId, elementId))
    return undefined
  }
  if ((value.kind === 'stacked' || value.kind === 'stackedPercent') && series.length < 2) {
    issues.push(issue('schema', `${path}.chart 堆积图至少两条序列`, pageId, elementId))
    return undefined
  }
  if (value.kind === 'combo') {
    const roles = comboSeriesRoles(series)
    if (series.length < 2 || !roles.includes('column') || !roles.includes('line')) {
      issues.push(issue('schema', `${path}.chart 柱线组合至少一条柱和一条线`, pageId, elementId))
      return undefined
    }
  }
  let colors: string[] | undefined
  if (value.colors !== undefined) {
    if (!Array.isArray(value.colors) || value.colors.some(item => typeof item !== 'string' || !COLOR_REF.test(item))) {
      issues.push(issue('schema', `${path}.chart.colors 必须是颜色 token、#RRGGBB 或 #RRGGBBAA`, pageId, elementId))
      return undefined
    }
    colors = value.colors as string[]
  }
  if (value.showValues !== undefined && typeof value.showValues !== 'boolean') {
    issues.push(issue('schema', `${path}.chart.showValues 必须是布尔值`, pageId, elementId))
    return undefined
  }
  if (value.showLegend !== undefined && typeof value.showLegend !== 'boolean') {
    issues.push(issue('schema', `${path}.chart.showLegend 必须是布尔值`, pageId, elementId))
    return undefined
  }
  const valMin = optionalNumber(value.valMin, `${path}.chart.valMin`, issues, pageId, elementId)
  const valMax = optionalNumber(value.valMax, `${path}.chart.valMax`, issues, pageId, elementId)
  const holeSize = optionalNumber(value.holeSize, `${path}.chart.holeSize`, issues, pageId, elementId)
  if (holeSize !== undefined && (holeSize < 0 || holeSize > 90)) issues.push(issue('schema', `${path}.chart.holeSize 必须在 0 到 90 之间`, pageId, elementId))
  const lineWidth = optionalNumber(value.lineWidth, `${path}.chart.lineWidth`, issues, pageId, elementId)
  if (lineWidth !== undefined && lineWidth < 0) issues.push(issue('schema', `${path}.chart.lineWidth 不能为负`, pageId, elementId))
  const markerSize = optionalNumber(value.markerSize, `${path}.chart.markerSize`, issues, pageId, elementId)
  if (markerSize !== undefined && (markerSize < 0 || markerSize > 72)) issues.push(issue('schema', `${path}.chart.markerSize 必须在 0 到 72 之间`, pageId, elementId))
  if (value.markerColor !== undefined && (typeof value.markerColor !== 'string' || !COLOR_REF.test(value.markerColor))) {
    issues.push(issue('schema', `${path}.chart.markerColor 无效`, pageId, elementId))
  }
  const grids = ['solid', 'dash', 'dot', 'none']
  if (value.grid !== undefined && (typeof value.grid !== 'string' || !grids.includes(value.grid))) {
    issues.push(issue('schema', `${path}.chart.grid 不支持`, pageId, elementId))
  }
  const catLabelSize = optionalNumber(value.catLabelSize, `${path}.chart.catLabelSize`, issues, pageId, elementId)
  const valLabelSize = optionalNumber(value.valLabelSize, `${path}.chart.valLabelSize`, issues, pageId, elementId)
  if (value.catLabelColor !== undefined && (typeof value.catLabelColor !== 'string' || !COLOR_REF.test(value.catLabelColor))) {
    issues.push(issue('schema', `${path}.chart.catLabelColor 无效`, pageId, elementId))
  }
  if (value.valLabelColor !== undefined && (typeof value.valLabelColor !== 'string' || !COLOR_REF.test(value.valLabelColor))) {
    issues.push(issue('schema', `${path}.chart.valLabelColor 无效`, pageId, elementId))
  }
  return {
    kind: value.kind as ChartSpec['kind'],
    categories: value.categories as string[],
    series,
    colors,
    showValues: value.showValues as boolean | undefined,
    showLegend: value.showLegend as boolean | undefined,
    valMin,
    valMax,
    holeSize,
    lineWidth,
    markerSize,
    markerColor: typeof value.markerColor === 'string' ? value.markerColor : undefined,
    grid: grids.includes(String(value.grid)) ? value.grid as ChartSpec['grid'] : undefined,
    catLabelSize,
    valLabelSize,
    catLabelColor: typeof value.catLabelColor === 'string' ? value.catLabelColor : undefined,
    valLabelColor: typeof value.valLabelColor === 'string' ? value.valLabelColor : undefined,
  }
}

function readPointField(value: unknown, path: string, count: number, issues: DeckIssue[], pageId?: string, elementId?: string): number[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== count || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    issues.push(issue('schema', `${path} 必须与 categories 等长且为有限数字`, pageId, elementId))
    return null
  }
  return value as number[]
}

function optionalNumber(value: unknown, path: string, issues: DeckIssue[], pageId?: string, elementId?: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(issue('schema', `${path} 必须是有限数字`, pageId, elementId))
    return undefined
  }
  return value
}

function parseElement(value: unknown, pageId: string, issues: DeckIssue[]): DeckElement | null {
  if (!isObject(value)) {
    issues.push(issue('schema', '元素必须是对象', pageId))
    return null
  }
  const id = value.id
  const elementId = typeof id === 'string' ? id : undefined
  rejectUnknown(value, ['id', 'type', 'bounds', 'role', 'rotate', 'text', 'textCapacity', 'font', 'shape', 'fill', 'line', 'radius', 'arrow', 'src', 'alt', 'chart', 'table', 'path', 'pathRule', 'gradient', 'pattern', 'shadow', 'fit'], `元素 ${elementId ?? '?'}`, issues, pageId, elementId)
  if (typeof id !== 'string' || !id.trim()) {
    issues.push(issue('schema', '元素缺少 id', pageId))
    return null
  }
  if (value.type !== 'text' && value.type !== 'shape' && value.type !== 'image' && value.type !== 'chart' && value.type !== 'table') {
    issues.push(issue('schema', `元素 ${id} 的 type 不支持`, pageId, id))
    return null
  }
  const bounds = parseBounds(value.bounds, id, issues, pageId, id)
  if (!bounds) return null
  const element: DeckElement = { id, type: value.type, bounds }
  if (value.rotate !== undefined) {
    if (typeof value.rotate !== 'number' || !Number.isFinite(value.rotate) || value.rotate < -360 || value.rotate > 360) {
      issues.push(issue('schema', `元素 ${id} 的 rotate 必须在 -360 到 360 之间`, pageId, id))
    } else element.rotate = value.rotate
  }
  if (value.role !== undefined) {
    if (value.role !== 'panel' && value.role !== 'rule' && value.role !== 'decoration' && value.role !== 'content') {
      issues.push(issue('schema', `元素 ${id} 的 role 不支持`, pageId, id))
    } else element.role = value.role
  }
  if (value.type === 'text') parseText(value, element, pageId, issues)
  if (value.type === 'shape') parseShape(value, element, pageId, issues)
  if (value.type === 'image') {
    if (typeof value.src !== 'string' || !value.src.trim()) issues.push(issue('schema', `图片 ${id} 缺少 src`, pageId, id))
    else element.src = value.src
    if (typeof value.alt !== 'string' || !value.alt.trim()) issues.push(issue('schema', `图片 ${id} 缺少 alt`, pageId, id))
    else element.alt = value.alt
    if (value.fit !== undefined) {
      if (value.fit !== 'fill' && value.fit !== 'contain') issues.push(issue('schema', `图片 ${id} 的 fit 只支持 fill 或 contain`, pageId, id))
      else element.fit = value.fit
    }
  }
  if (value.type !== 'image' && value.fit !== undefined) issues.push(issue('schema', `元素 ${id} 的 fit 只用于图片`, pageId, id))
  if (value.type !== 'shape' && (value.path !== undefined || value.gradient !== undefined || value.pattern !== undefined || value.pathRule !== undefined)) {
    issues.push(issue('schema', `元素 ${id} 的 path、gradient、pattern 只用于形状`, pageId, id))
  }
  if (value.shadow !== undefined && value.type !== 'shape' && value.type !== 'text') {
    issues.push(issue('schema', `元素 ${id} 的 shadow 只用于形状或文本`, pageId, id))
  } else if ((value.type === 'shape' || value.type === 'text') && value.shadow !== undefined) {
    const shadow = parseShadow(value.shadow, id, issues, pageId)
    if (shadow) element.shadow = shadow
  }
  if (value.type === 'chart') {
    const chart = parseChart(value.chart, id, issues, pageId, id)
    if (chart) element.chart = chart
  }
  if (value.type === 'table') {
    const table = parseTable(value.table, id, issues, pageId, id)
    if (table) element.table = table
  }
  return element
}

function parseText(value: Record<string, unknown>, element: DeckElement, pageId: string, issues: DeckIssue[]): void {
  if (typeof value.text !== 'string' || value.text.length === 0) issues.push(issue('schema', `文本 ${element.id} 缺少 text`, pageId, element.id))
  else element.text = value.text
  if (!isObject(value.textCapacity)) issues.push(issue('schema', `文本 ${element.id} 缺少 textCapacity`, pageId, element.id))
  else {
    rejectUnknown(value.textCapacity, ['maxChars', 'maxLines'], `${element.id}.textCapacity`, issues, pageId, element.id)
    const maxChars = value.textCapacity.maxChars
    const maxLines = value.textCapacity.maxLines
    if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1 || typeof maxLines !== 'number' || !Number.isInteger(maxLines) || maxLines < 1) {
      issues.push(issue('schema', `文本 ${element.id} 的 textCapacity 需要正整数 maxChars 和 maxLines`, pageId, element.id))
    } else element.textCapacity = { maxChars, maxLines }
  }
  if (!isObject(value.font)) issues.push(issue('schema', `文本 ${element.id} 缺少 font`, pageId, element.id))
  else {
    rejectUnknown(value.font, ['family', 'size', 'weight', 'italic', 'rtl', 'color', 'align', 'valign', 'leading', 'tracking', 'face'], `${element.id}.font`, issues, pageId, element.id)
    if (typeof value.font.family !== 'string' || !FONT_TOKEN.test(value.font.family)) issues.push(issue('schema', `文本 ${element.id} 的 font.family 只能是 $cjk 或 $latin`, pageId, element.id))
    if (typeof value.font.size !== 'number' || value.font.size < 6 || value.font.size > 240) issues.push(issue('schema', `文本 ${element.id} 的字号必须在 6 到 240 之间`, pageId, element.id))
    const weight = value.font.weight
    if (weight !== undefined && weight !== 'regular' && weight !== 'bold') issues.push(issue('schema', `文本 ${element.id} 的 font.weight 不支持`, pageId, element.id))
    if (value.font.italic !== undefined && typeof value.font.italic !== 'boolean') issues.push(issue('schema', `文本 ${element.id} 的 font.italic 必须是布尔值`, pageId, element.id))
    if (value.font.rtl !== undefined && typeof value.font.rtl !== 'boolean') issues.push(issue('schema', `文本 ${element.id} 的 font.rtl 必须是布尔值`, pageId, element.id))
    if (value.font.color !== undefined && (typeof value.font.color !== 'string' || !COLOR_REF.test(value.font.color))) issues.push(issue('schema', `文本 ${element.id} 的颜色无效`, pageId, element.id))
    if (value.font.align !== undefined && value.font.align !== 'left' && value.font.align !== 'center' && value.font.align !== 'right') issues.push(issue('schema', `文本 ${element.id} 的 align 不支持`, pageId, element.id))
    if (value.font.valign !== undefined && value.font.valign !== 'top' && value.font.valign !== 'middle' && value.font.valign !== 'bottom') issues.push(issue('schema', `文本 ${element.id} 的 valign 不支持`, pageId, element.id))
    if (value.font.leading !== undefined && (typeof value.font.leading !== 'number' || value.font.leading < 0.9 || value.font.leading > 2)) issues.push(issue('schema', `文本 ${element.id} 的 leading 必须在 0.9 到 2 之间`, pageId, element.id))
    if (value.font.tracking !== undefined && (typeof value.font.tracking !== 'number' || value.font.tracking < -20 || value.font.tracking > 80)) issues.push(issue('schema', `文本 ${element.id} 的 tracking 超出范围`, pageId, element.id))
    const face = value.font.face === undefined ? undefined : parseFontFace(value.font.face, `${element.id}.font.face`, issues, pageId, element.id)
    if (typeof value.font.family === 'string' && FONT_TOKEN.test(value.font.family) && typeof value.font.size === 'number') {
      const align = value.font.align === 'left' || value.font.align === 'center' || value.font.align === 'right' ? value.font.align : undefined
      const valign = value.font.valign === 'top' || value.font.valign === 'middle' || value.font.valign === 'bottom' ? value.font.valign : undefined
      element.font = {
        family: value.font.family,
        size: value.font.size,
        weight: weight === 'bold' || weight === 'regular' ? weight : undefined,
        italic: value.font.italic === true ? true : undefined,
        rtl: value.font.rtl === true ? true : undefined,
        color: typeof value.font.color === 'string' ? value.font.color : undefined,
        align,
        valign,
        leading: typeof value.font.leading === 'number' ? value.font.leading : undefined,
        tracking: typeof value.font.tracking === 'number' ? value.font.tracking : undefined,
        face,
      }
    }
  }
}

function parseFontFace(value: unknown, path: string, issues: DeckIssue[], pageId?: string, elementId?: string): FontFace | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path} 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['latin', 'cjk'], path, issues, pageId, elementId)
  if (typeof value.latin !== 'string' || !value.latin.trim()) {
    issues.push(issue('schema', `${path}.latin 必须是非空字体名`, pageId, elementId))
    return undefined
  }
  const cjk = parseFontPair(value.cjk, `${path}.cjk`, issues)
  if (!cjk) return undefined
  return { latin: value.latin, cjk }
}

const PATTERN_PRESET = /^[A-Za-z][A-Za-z0-9]{0,20}$/

function parseGradient(value: unknown, elementId: string, issues: DeckIssue[], pageId: string): GradientFill | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `形状 ${elementId} 的 gradient 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['kind', 'angle', 'stops', 'cx', 'cy', 'absolute'], `${elementId}.gradient`, issues, pageId, elementId)
  if (value.kind !== 'linear' && value.kind !== 'radial') {
    issues.push(issue('schema', `形状 ${elementId} 的 gradient.kind 只支持 linear 或 radial`, pageId, elementId))
    return undefined
  }
  if (!Array.isArray(value.stops) || value.stops.length < 2) {
    issues.push(issue('schema', `形状 ${elementId} 的 gradient.stops 至少要有两个色标`, pageId, elementId))
    return undefined
  }
  const stops: ColorStop[] = []
  for (const stop of value.stops) {
    if (!isObject(stop)) {
      issues.push(issue('schema', `形状 ${elementId} 的色标必须是对象`, pageId, elementId))
      return undefined
    }
    rejectUnknown(stop, ['offset', 'color'], `${elementId}.gradient.stops`, issues, pageId, elementId)
    if (typeof stop.offset !== 'number' || stop.offset < 0 || stop.offset > 1 || typeof stop.color !== 'string' || !COLOR_REF.test(stop.color)) {
      issues.push(issue('schema', `形状 ${elementId} 的色标无效`, pageId, elementId))
      return undefined
    }
    stops.push({ offset: stop.offset, color: stop.color })
  }
  if (value.angle !== undefined && (typeof value.angle !== 'number' || !Number.isFinite(value.angle))) {
    issues.push(issue('schema', `形状 ${elementId} 的 gradient.angle 必须是有限数字`, pageId, elementId))
  }
  for (const key of ['cx', 'cy'] as const) {
    const coord = value[key]
    if (coord !== undefined && (typeof coord !== 'number' || coord < 0 || coord > 1)) {
      issues.push(issue('schema', `形状 ${elementId} 的 gradient.${key} 必须在 0 到 1 之间`, pageId, elementId))
    }
  }
  if (value.absolute !== undefined && typeof value.absolute !== 'boolean') {
    issues.push(issue('schema', `形状 ${elementId} 的 gradient.absolute 必须是布尔值`, pageId, elementId))
  }
  return {
    kind: value.kind,
    angle: typeof value.angle === 'number' ? value.angle : undefined,
    stops,
    cx: typeof value.cx === 'number' ? value.cx : undefined,
    cy: typeof value.cy === 'number' ? value.cy : undefined,
    absolute: value.absolute === true ? true : undefined,
  }
}

function parsePattern(value: unknown, elementId: string, issues: DeckIssue[], pageId: string): PatternFill | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `形状 ${elementId} 的 pattern 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['preset', 'foreground', 'background'], `${elementId}.pattern`, issues, pageId, elementId)
  if (typeof value.preset !== 'string' || !PATTERN_PRESET.test(value.preset)) {
    issues.push(issue('schema', `形状 ${elementId} 的 pattern.preset 无效`, pageId, elementId))
    return undefined
  }
  if (typeof value.foreground !== 'string' || !COLOR_REF.test(value.foreground) || typeof value.background !== 'string' || !COLOR_REF.test(value.background)) {
    issues.push(issue('schema', `形状 ${elementId} 的 pattern 颜色无效`, pageId, elementId))
    return undefined
  }
  return { preset: value.preset, foreground: value.foreground, background: value.background }
}

function parseShadow(value: unknown, elementId: string, issues: DeckIssue[], pageId: string): ShadowSpec | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `元素 ${elementId} 的 shadow 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['color', 'opacity', 'blur', 'offset', 'angle'], `${elementId}.shadow`, issues, pageId, elementId)
  if (typeof value.color !== 'string' || !COLOR_REF.test(value.color)) {
    issues.push(issue('schema', `元素 ${elementId} 的 shadow.color 无效`, pageId, elementId))
    return undefined
  }
  for (const key of ['opacity', 'blur', 'offset', 'angle'] as const) {
    const number = value[key]
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number))) {
      issues.push(issue('schema', `元素 ${elementId} 的 shadow.${key} 必须是有限数字`, pageId, elementId))
      return undefined
    }
  }
  if (typeof value.opacity === 'number' && (value.opacity < 0 || value.opacity > 1)) {
    issues.push(issue('schema', `元素 ${elementId} 的 shadow.opacity 必须在 0 到 1 之间`, pageId, elementId))
  }
  return {
    color: value.color,
    opacity: typeof value.opacity === 'number' ? value.opacity : undefined,
    blur: typeof value.blur === 'number' ? value.blur : undefined,
    offset: typeof value.offset === 'number' ? value.offset : undefined,
    angle: typeof value.angle === 'number' ? value.angle : undefined,
  }
}

function parseShape(value: Record<string, unknown>, element: DeckElement, pageId: string, issues: DeckIssue[]): void {
  const shape = value.shape ?? 'rect'
  if (shape !== 'rect' && shape !== 'roundRect' && shape !== 'ellipse' && shape !== 'line' && shape !== 'path') {
    issues.push(issue('schema', `形状 ${element.id} 的 shape 不支持`, pageId, element.id))
  } else element.shape = shape
  if (value.fill !== undefined) {
    if (typeof value.fill !== 'string' || !COLOR_REF.test(value.fill)) issues.push(issue('schema', `形状 ${element.id} 的 fill 无效`, pageId, element.id))
    else element.fill = value.fill
  }
  if (value.gradient !== undefined) {
    const gradient = parseGradient(value.gradient, element.id, issues, pageId)
    if (gradient) element.gradient = gradient
  }
  if (value.pattern !== undefined) {
    const pattern = parsePattern(value.pattern, element.id, issues, pageId)
    if (pattern) element.pattern = pattern
  }
  if (value.pathRule !== undefined) {
    if (value.pathRule !== 'evenodd' && value.pathRule !== 'nonzero') issues.push(issue('schema', `形状 ${element.id} 的 pathRule 只支持 evenodd 或 nonzero`, pageId, element.id))
    else element.pathRule = value.pathRule
  }
  if (shape === 'path') {
    if (typeof value.path !== 'string' || !value.path.trim() || value.path.length > 500_000) issues.push(issue('schema', `形状 ${element.id} 缺少 path`, pageId, element.id))
    else element.path = value.path
  } else if (value.path !== undefined) {
    issues.push(issue('schema', `形状 ${element.id} 只有 path 形状可以带 path`, pageId, element.id))
  }
  if (value.line !== undefined) {
    if (!isObject(value.line)) issues.push(issue('schema', `形状 ${element.id} 的 line 必须是对象`, pageId, element.id))
    else {
      rejectUnknown(value.line, ['color', 'width', 'style', 'points'], `${element.id}.line`, issues, pageId, element.id)
      const styles = ['solid', 'dash', 'dot']
      const styleOk = value.line.style === undefined || (typeof value.line.style === 'string' && styles.includes(value.line.style))
      if (typeof value.line.color !== 'string' || !COLOR_REF.test(value.line.color) || typeof value.line.width !== 'number' || value.line.width < 0 || !styleOk) {
        issues.push(issue('schema', `形状 ${element.id} 的 line 无效`, pageId, element.id))
      } else {
        element.line = {
          color: value.line.color,
          width: value.line.width,
          style: value.line.style === 'dash' || value.line.style === 'dot' || value.line.style === 'solid' ? value.line.style : undefined,
          points: parseLinePoints(value.line.points, element.id, issues, pageId),
        }
      }
    }
  }
  const painted = element.fill !== undefined || element.gradient !== undefined || element.pattern !== undefined
  if (element.shape === 'path' && !painted && !element.line) issues.push(issue('schema', `形状 ${element.id} 缺少 fill`, pageId, element.id))
  if (element.shape !== 'line' && element.shape !== 'path' && !painted) issues.push(issue('schema', `形状 ${element.id} 缺少 fill`, pageId, element.id))
  if (value.radius !== undefined) {
    if (typeof value.radius !== 'number' || value.radius < 0) issues.push(issue('schema', `形状 ${element.id} 的 radius 无效`, pageId, element.id))
    else element.radius = value.radius
  }
  if (value.arrow !== undefined) {
    if (value.arrow !== 'start' && value.arrow !== 'end' && value.arrow !== 'both') issues.push(issue('schema', `形状 ${element.id} 的 arrow 只支持 start、end 或 both`, pageId, element.id))
    else element.arrow = value.arrow
  }
}

function parseLinePoints(value: unknown, elementId: string, issues: DeckIssue[], pageId: string): { x1: number; y1: number; x2: number; y2: number } | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) {
    issues.push(issue('schema', `形状 ${elementId} 的 line.points 必须是 {x1,y1,x2,y2}`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['x1', 'y1', 'x2', 'y2'], `${elementId}.line.points`, issues, pageId, elementId)
  const points = { x1: value.x1, y1: value.y1, x2: value.x2, y2: value.y2 }
  for (const key of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (typeof points[key] !== 'number' || !Number.isFinite(points[key])) {
      issues.push(issue('schema', `形状 ${elementId} 的 line.points.${key} 必须是有限数字`, pageId, elementId))
      return undefined
    }
  }
  return points as { x1: number; y1: number; x2: number; y2: number }
}

function parseTable(value: unknown, path: string, issues: DeckIssue[], pageId: string, elementId: string): TableSpec | undefined {
  if (!isObject(value)) {
    issues.push(issue('schema', `${path}.table 必须是对象`, pageId, elementId))
    return undefined
  }
  rejectUnknown(value, ['columns', 'rowHeights', 'rows', 'fontSize', 'fontFamily', 'face', 'color', 'fill', 'border', 'header'], `${path}.table`, issues, pageId, elementId)
  if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.some(item => typeof item !== 'number' || item <= 0)) {
    issues.push(issue('schema', `${path}.table.columns 必须是正数数组`, pageId, elementId))
    return undefined
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    issues.push(issue('schema', `${path}.table.rows 必须是非空数组`, pageId, elementId))
    return undefined
  }
  const rows: TableSpec['rows'] = []
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== value.columns.length) {
      issues.push(issue('schema', `${path}.table.rows 每一行都要与 columns 等长`, pageId, elementId))
      return undefined
    }
    const cells: TableSpec['rows'][number] = []
    for (const cell of row) {
      if (!isObject(cell)) {
        issues.push(issue('schema', `${path}.table 单元格必须是对象`, pageId, elementId))
        return undefined
      }
      rejectUnknown(cell, ['text', 'bold', 'fill', 'color', 'align'], `${path}.table.cell`, issues, pageId, elementId)
      if (typeof cell.text !== 'string') {
        issues.push(issue('schema', `${path}.table 单元格缺少 text`, pageId, elementId))
        return undefined
      }
      if (cell.fill !== undefined && (typeof cell.fill !== 'string' || !COLOR_REF.test(cell.fill))) {
        issues.push(issue('schema', `${path}.table 单元格 fill 无效`, pageId, elementId))
      }
      if (cell.color !== undefined && (typeof cell.color !== 'string' || !COLOR_REF.test(cell.color))) {
        issues.push(issue('schema', `${path}.table 单元格 color 无效`, pageId, elementId))
      }
      if (cell.align !== undefined && cell.align !== 'left' && cell.align !== 'center' && cell.align !== 'right') {
        issues.push(issue('schema', `${path}.table 单元格 align 不支持`, pageId, elementId))
      }
      cells.push({
        text: cell.text,
        bold: cell.bold === true ? true : undefined,
        fill: typeof cell.fill === 'string' ? cell.fill : undefined,
        color: typeof cell.color === 'string' ? cell.color : undefined,
        align: cell.align === 'left' || cell.align === 'center' || cell.align === 'right' ? cell.align : undefined,
      })
    }
    rows.push(cells)
  }
  if (typeof value.fontSize !== 'number' || value.fontSize < 6 || value.fontSize > 240) {
    issues.push(issue('schema', `${path}.table.fontSize 必须在 6 到 240 之间`, pageId, elementId))
    return undefined
  }
  if (typeof value.fontFamily !== 'string' || !FONT_TOKEN.test(value.fontFamily)) {
    issues.push(issue('schema', `${path}.table.fontFamily 只能是 $cjk 或 $latin`, pageId, elementId))
    return undefined
  }
  if (typeof value.color !== 'string' || !COLOR_REF.test(value.color) || typeof value.fill !== 'string' || !COLOR_REF.test(value.fill)) {
    issues.push(issue('schema', `${path}.table 的 color 或 fill 无效`, pageId, elementId))
    return undefined
  }
  if (!isObject(value.border) || typeof value.border.color !== 'string' || !COLOR_REF.test(value.border.color) || typeof value.border.width !== 'number' || value.border.width < 0) {
    issues.push(issue('schema', `${path}.table.border 无效`, pageId, elementId))
    return undefined
  }
  let rowHeights: number[] | undefined
  if (value.rowHeights !== undefined) {
    if (!Array.isArray(value.rowHeights) || value.rowHeights.length !== rows.length || value.rowHeights.some(item => typeof item !== 'number' || item <= 0)) {
      issues.push(issue('schema', `${path}.table.rowHeights 必须与行数等长且为正数`, pageId, elementId))
      return undefined
    }
    rowHeights = value.rowHeights as number[]
  }
  let header: TableSpec['header']
  if (value.header !== undefined) {
    if (!isObject(value.header)) {
      issues.push(issue('schema', `${path}.table.header 必须是对象`, pageId, elementId))
      return undefined
    }
    rejectUnknown(value.header, ['bold', 'color', 'fill'], `${path}.table.header`, issues, pageId, elementId)
    if (value.header.color !== undefined && (typeof value.header.color !== 'string' || !COLOR_REF.test(value.header.color))) {
      issues.push(issue('schema', `${path}.table.header.color 无效`, pageId, elementId))
    }
    if (value.header.fill !== undefined && (typeof value.header.fill !== 'string' || !COLOR_REF.test(value.header.fill))) {
      issues.push(issue('schema', `${path}.table.header.fill 无效`, pageId, elementId))
    }
    header = {
      bold: value.header.bold === true ? true : undefined,
      color: typeof value.header.color === 'string' ? value.header.color : undefined,
      fill: typeof value.header.fill === 'string' ? value.header.fill : undefined,
    }
  }
  const face = value.face === undefined ? undefined : parseFontFace(value.face, `${path}.table.face`, issues, pageId, elementId)
  return {
    columns: value.columns as number[],
    rowHeights,
    rows,
    fontSize: value.fontSize,
    fontFamily: value.fontFamily as TableSpec['fontFamily'],
    face,
    color: value.color,
    fill: value.fill,
    border: { color: value.border.color, width: value.border.width },
    header,
  }
}

function parsePage(value: unknown, issues: DeckIssue[]): DeckPage | null {
  if (!isObject(value)) {
    issues.push(issue('schema', '页面必须是对象'))
    return null
  }
  const id = typeof value.id === 'string' ? value.id : undefined
  rejectUnknown(value, ['id', 'layout', 'name', 'background', 'elements', 'notes'], `页面 ${id ?? '?'}`, issues, id)
  if (!id || !id.trim()) {
    issues.push(issue('schema', '页面缺少 id'))
    return null
  }
  if (typeof value.layout !== 'string' || !value.layout.trim()) issues.push(issue('schema', '页面缺少 layout', id))
  if (typeof value.background !== 'string' || !COLOR_REF.test(value.background)) issues.push(issue('schema', '页面 background 必须是颜色 token 或 #RRGGBB', id))
  if (value.name !== undefined && typeof value.name !== 'string') issues.push(issue('schema', '页面 name 必须是字符串', id))
  if (value.notes !== undefined && typeof value.notes !== 'string') issues.push(issue('schema', '页面 notes 必须是字符串', id))
  if (!Array.isArray(value.elements)) {
    issues.push(issue('schema', '页面缺少 elements', id))
    return null
  }
  const elements: DeckElement[] = []
  const seen = new Set<string>()
  for (const entry of value.elements) {
    const element = parseElement(entry, id, issues)
    if (!element) continue
    if (seen.has(element.id)) issues.push(issue('schema', `页面内元素 id 重复：${element.id}`, id, element.id))
    seen.add(element.id)
    elements.push(element)
  }
  if (typeof value.layout !== 'string' || typeof value.background !== 'string') return null
  return {
    id,
    layout: value.layout,
    name: typeof value.name === 'string' ? value.name : undefined,
    background: value.background,
    elements,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  }
}

export function parseDeckDocument(value: unknown): { deck: Deck | null; issues: DeckIssue[] } {
  const issues: DeckIssue[] = []
  if (!isObject(value)) return { deck: null, issues: [issue('schema', 'deck 必须是对象')] }
  rejectUnknown(value, ['format', 'version', 'title', 'canvas', 'theme', 'pages', 'profile'], 'deck', issues)
  if (value.format !== DECK_FORMAT) issues.push(issue('schema', `format 必须是 ${DECK_FORMAT}`))
  if (value.version !== DECK_VERSION) issues.push(issue('schema', `version 必须是 ${DECK_VERSION}`))
  if (typeof value.title !== 'string' || !value.title.trim()) issues.push(issue('schema', 'title 必须是非空字符串'))
  if (!isObject(value.canvas)) issues.push(issue('schema', 'canvas 必须是对象'))
  else {
    rejectUnknown(value.canvas, ['width', 'height'], 'canvas', issues)
    const width = value.canvas.width
    const height = value.canvas.height
    if (typeof width !== 'number' || typeof height !== 'number' || !canvasSupported(width, height)) {
      issues.push(issue('schema', `canvas 必须是受支持的尺寸之一，例如 ${CANVAS_WIDTH}×${CANVAS_HEIGHT}（16:9）`))
    }
  }
  if (value.profile !== undefined && value.profile !== 'authored' && value.profile !== 'example') {
    issues.push(issue('schema', 'profile 只支持 authored 或 example'))
  }
  const theme = parseTheme(value.theme, issues)
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    issues.push(issue('schema', 'pages 必须是非空数组'))
    return { deck: null, issues }
  }
  const pages: DeckPage[] = []
  const seen = new Set<string>()
  for (const entry of value.pages) {
    const page = parsePage(entry, issues)
    if (!page) continue
    if (seen.has(page.id)) issues.push(issue('schema', `页面 id 重复：${page.id}`, page.id))
    seen.add(page.id)
    pages.push(page)
  }
  if (issues.length > 0 || !theme || typeof value.title !== 'string') return { deck: null, issues }
  return {
    deck: {
      format: DECK_FORMAT,
      version: DECK_VERSION,
      title: value.title,
      canvas: { width: Number(value.canvas.width), height: Number(value.canvas.height) },
      theme,
      pages,
      profile: value.profile === 'example' || value.profile === 'authored' ? value.profile : undefined,
    },
    issues,
  }
}

export function parseDeckSource(text: string): { deck: Deck | null; issues: DeckIssue[] } {
  const trimmed = text.trim()
  if (!trimmed) return { deck: null, issues: [issue('schema', 'deck 文件是空的')] }
  try {
    const value = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(text) : yaml.load(text)
    return parseDeckDocument(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { deck: null, issues: [issue('schema', `无法解析 deck：${message}`)] }
  }
}

export function loadDeckFile(file: string): { deck: Deck | null; issues: DeckIssue[] } {
  try {
    return parseDeckSource(readFileSync(file, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { deck: null, issues: [issue('schema', `无法读取 deck：${message}`)] }
  }
}

export function colorRef(value: string | undefined, theme: Theme, fallback: string): string {
  const raw = value ?? fallback
  if (raw.startsWith('#')) return raw.toUpperCase()
  const token = raw.startsWith('$') ? raw.slice(1) : raw
  const hex = theme.colors[token]
  if (!hex) throw new Error(`未知颜色 ${raw}`)
  return hex.toUpperCase()
}
