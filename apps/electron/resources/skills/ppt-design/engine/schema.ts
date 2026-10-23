import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DECK_FORMAT,
  DECK_VERSION,
  type Bounds,
  type ChartSpec,
  type Deck,
  type DeckElement,
  type DeckIssue,
  type DeckPage,
  type Theme,
} from './types.ts'

const HEX = /^#[0-9A-Fa-f]{6}$/
const FONT_TOKEN = /^\$cjk$|^\$latin$/
const COLOR_REF = /^(\$[A-Za-z][A-Za-z0-9_-]*|#[0-9A-Fa-f]{6})$/

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
  rejectUnknown(value, ['id', 'name', 'margin', 'colors', 'fonts', 'type', 'source'], 'theme', issues)
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
  return { id, name, margin, colors: parsedColors, fonts: parsedFonts, type: parsedType, source }
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
  rejectUnknown(value, ['kind', 'categories', 'series', 'colors', 'showValues', 'showLegend'], `${path}.chart`, issues, pageId, elementId)
  const kinds = ['bar', 'column', 'line', 'pie', 'doughnut', 'waterfall']
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
  const series: ChartSpec['series'] = []
  for (const entry of value.series) {
    if (!isObject(entry)) {
      issues.push(issue('schema', `${path}.chart.series 项必须是对象`, pageId, elementId))
      return undefined
    }
    rejectUnknown(entry, ['name', 'values'], `${path}.chart.series`, issues, pageId, elementId)
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      issues.push(issue('schema', `${path}.chart.series.name 必须是非空字符串`, pageId, elementId))
      return undefined
    }
    if (!Array.isArray(entry.values) || entry.values.length !== value.categories.length || entry.values.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      issues.push(issue('schema', `${path}.chart.series.values 必须与 categories 等长且为有限数字`, pageId, elementId))
      return undefined
    }
    series.push({ name: entry.name, values: entry.values as number[] })
  }
  if (value.kind === 'waterfall' && (series.length !== 1 || value.categories.length < 3)) {
    issues.push(issue('schema', `${path}.chart 瀑布图需要一条序列，且至少三个类别（起点、变化、终点）`, pageId, elementId))
    return undefined
  }
  let colors: string[] | undefined
  if (value.colors !== undefined) {
    if (!Array.isArray(value.colors) || value.colors.some(item => typeof item !== 'string' || !COLOR_REF.test(item))) {
      issues.push(issue('schema', `${path}.chart.colors 必须是颜色 token 或 #RRGGBB`, pageId, elementId))
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
  return {
    kind: value.kind as ChartSpec['kind'],
    categories: value.categories as string[],
    series,
    colors,
    showValues: value.showValues as boolean | undefined,
    showLegend: value.showLegend as boolean | undefined,
  }
}

function parseElement(value: unknown, pageId: string, issues: DeckIssue[]): DeckElement | null {
  if (!isObject(value)) {
    issues.push(issue('schema', '元素必须是对象', pageId))
    return null
  }
  const id = value.id
  const elementId = typeof id === 'string' ? id : undefined
  rejectUnknown(value, ['id', 'type', 'bounds', 'role', 'text', 'textCapacity', 'font', 'shape', 'fill', 'line', 'radius', 'arrow', 'src', 'alt', 'chart'], `元素 ${elementId ?? '?'}`, issues, pageId, elementId)
  if (typeof id !== 'string' || !id.trim()) {
    issues.push(issue('schema', '元素缺少 id', pageId))
    return null
  }
  if (value.type !== 'text' && value.type !== 'shape' && value.type !== 'image' && value.type !== 'chart') {
    issues.push(issue('schema', `元素 ${id} 的 type 不支持`, pageId, id))
    return null
  }
  const bounds = parseBounds(value.bounds, id, issues, pageId, id)
  if (!bounds) return null
  const element: DeckElement = { id, type: value.type, bounds }
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
  }
  if (value.type === 'chart') {
    const chart = parseChart(value.chart, id, issues, pageId, id)
    if (chart) element.chart = chart
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
    rejectUnknown(value.font, ['family', 'size', 'weight', 'color', 'align', 'valign', 'leading', 'tracking'], `${element.id}.font`, issues, pageId, element.id)
    if (typeof value.font.family !== 'string' || !FONT_TOKEN.test(value.font.family)) issues.push(issue('schema', `文本 ${element.id} 的 font.family 只能是 $cjk 或 $latin`, pageId, element.id))
    if (typeof value.font.size !== 'number' || value.font.size < 8 || value.font.size > 120) issues.push(issue('schema', `文本 ${element.id} 的字号必须在 8 到 120 之间`, pageId, element.id))
    const weight = value.font.weight
    if (weight !== undefined && weight !== 'regular' && weight !== 'bold') issues.push(issue('schema', `文本 ${element.id} 的 font.weight 不支持`, pageId, element.id))
    if (value.font.color !== undefined && (typeof value.font.color !== 'string' || !COLOR_REF.test(value.font.color))) issues.push(issue('schema', `文本 ${element.id} 的颜色无效`, pageId, element.id))
    if (value.font.align !== undefined && value.font.align !== 'left' && value.font.align !== 'center' && value.font.align !== 'right') issues.push(issue('schema', `文本 ${element.id} 的 align 不支持`, pageId, element.id))
    if (value.font.valign !== undefined && value.font.valign !== 'top' && value.font.valign !== 'middle' && value.font.valign !== 'bottom') issues.push(issue('schema', `文本 ${element.id} 的 valign 不支持`, pageId, element.id))
    if (value.font.leading !== undefined && (typeof value.font.leading !== 'number' || value.font.leading < 0.9 || value.font.leading > 2)) issues.push(issue('schema', `文本 ${element.id} 的 leading 必须在 0.9 到 2 之间`, pageId, element.id))
    if (value.font.tracking !== undefined && (typeof value.font.tracking !== 'number' || value.font.tracking < -4 || value.font.tracking > 12)) issues.push(issue('schema', `文本 ${element.id} 的 tracking 超出范围`, pageId, element.id))
    if (typeof value.font.family === 'string' && FONT_TOKEN.test(value.font.family) && typeof value.font.size === 'number') {
      const align = value.font.align === 'left' || value.font.align === 'center' || value.font.align === 'right' ? value.font.align : undefined
      const valign = value.font.valign === 'top' || value.font.valign === 'middle' || value.font.valign === 'bottom' ? value.font.valign : undefined
      element.font = {
        family: value.font.family,
        size: value.font.size,
        weight: weight === 'bold' || weight === 'regular' ? weight : undefined,
        color: typeof value.font.color === 'string' ? value.font.color : undefined,
        align,
        valign,
        leading: typeof value.font.leading === 'number' ? value.font.leading : undefined,
        tracking: typeof value.font.tracking === 'number' ? value.font.tracking : undefined,
      }
    }
  }
}

function parseShape(value: Record<string, unknown>, element: DeckElement, pageId: string, issues: DeckIssue[]): void {
  const shape = value.shape ?? 'rect'
  if (shape !== 'rect' && shape !== 'roundRect' && shape !== 'ellipse' && shape !== 'line') {
    issues.push(issue('schema', `形状 ${element.id} 的 shape 不支持`, pageId, element.id))
  } else element.shape = shape
  if (value.fill !== undefined) {
    if (typeof value.fill !== 'string' || !COLOR_REF.test(value.fill)) issues.push(issue('schema', `形状 ${element.id} 的 fill 无效`, pageId, element.id))
    else element.fill = value.fill
  }
  if (value.line !== undefined) {
    if (!isObject(value.line)) issues.push(issue('schema', `形状 ${element.id} 的 line 必须是对象`, pageId, element.id))
    else {
      rejectUnknown(value.line, ['color', 'width'], `${element.id}.line`, issues, pageId, element.id)
      if (typeof value.line.color !== 'string' || !COLOR_REF.test(value.line.color) || typeof value.line.width !== 'number' || value.line.width < 0) {
        issues.push(issue('schema', `形状 ${element.id} 的 line 无效`, pageId, element.id))
      } else element.line = { color: value.line.color, width: value.line.width }
    }
  }
  if (element.shape !== 'line' && element.fill === undefined) issues.push(issue('schema', `形状 ${element.id} 缺少 fill`, pageId, element.id))
  if (value.radius !== undefined) {
    if (typeof value.radius !== 'number' || value.radius < 0) issues.push(issue('schema', `形状 ${element.id} 的 radius 无效`, pageId, element.id))
    else element.radius = value.radius
  }
  if (value.arrow !== undefined) {
    if (value.arrow !== 'end') issues.push(issue('schema', `形状 ${element.id} 的 arrow 只支持 end`, pageId, element.id))
    else element.arrow = 'end'
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
  rejectUnknown(value, ['format', 'version', 'title', 'canvas', 'theme', 'pages'], 'deck', issues)
  if (value.format !== DECK_FORMAT) issues.push(issue('schema', `format 必须是 ${DECK_FORMAT}`))
  if (value.version !== DECK_VERSION) issues.push(issue('schema', `version 必须是 ${DECK_VERSION}`))
  if (typeof value.title !== 'string' || !value.title.trim()) issues.push(issue('schema', 'title 必须是非空字符串'))
  if (!isObject(value.canvas)) issues.push(issue('schema', 'canvas 必须是对象'))
  else {
    rejectUnknown(value.canvas, ['width', 'height'], 'canvas', issues)
    if (value.canvas.width !== CANVAS_WIDTH || value.canvas.height !== CANVAS_HEIGHT) {
      issues.push(issue('schema', `canvas 必须是 ${CANVAS_WIDTH}×${CANVAS_HEIGHT}`))
    }
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
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      theme,
      pages,
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
