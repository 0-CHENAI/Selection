/**
 * Convert ppt-master example decks (svg_final) into selection-deck templates.
 *
 *   bun scripts/import-ppt-master-examples.ts
 *   bun scripts/import-ppt-master-examples.ts --only ppt169_night_shelf_creative_pitch
 *
 * Source checkout defaults to /tmp/ppt-master-examples/examples.
 * Brand and official-corporate decks are recorded and skipped.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check.ts'
import { containsCjk, fitSlack, textWidth, wrapText } from '../apps/electron/resources/skills/ppt-design/engine/metrics.ts'
import { parseDeckDocument } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import {
  apply,
  commandBounds,
  commandsToPath,
  IDENTITY,
  isAxisAligned,
  localizeCommands,
  multiply,
  parseSvgPath,
  parseTransform,
  transformCommands,
  type Matrix,
} from '../apps/electron/resources/skills/ppt-design/engine/svg-path.ts'
import type { Deck, DeckElement, DeckPage, FontFace, GradientFill, PatternFill, ShadowSpec, Theme } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const require = createRequire('/workspace/package.json')
const { DOMParser } = require('@xmldom/xmldom') as {
  DOMParser: new (options?: { onError?: () => void }) => { parseFromString: (text: string, type: string) => Xml }
}
const sharp = require('sharp') as (input: Buffer, options?: { failOn?: 'none'; raw?: { width: number; height: number; channels: number } }) => SharpPipe
type SharpPipe = {
  rotate: () => SharpPipe
  metadata: () => Promise<{ width?: number; height?: number; hasAlpha?: boolean }>
  extract: (region: { left: number; top: number; width: number; height: number }) => SharpPipe
  resize: (width: number, height: number, options: { fit: 'inside'; withoutEnlargement: boolean }) => SharpPipe
  composite: (images: Array<{ input: Buffer; blend: 'dest-in' }>) => SharpPipe
  ensureAlpha: () => SharpPipe
  flatten: (options: { background: string }) => SharpPipe
  jpeg: (options: { quality: number }) => SharpPipe
  png: (options?: { compressionLevel?: number }) => SharpPipe
  raw: () => SharpPipe
  toBuffer: {
    (): Promise<Buffer>
    (options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>
  }
}

const PX = 0.75
const SKILL = 'apps/electron/resources/skills/ppt-design'
const ASSET_DIR = join(SKILL, 'styles/examples/_assets')
const ASSET_HREF = 'styles/examples/_assets'
const ASCENT_LATIN = 0.8
const ASCENT_CJK = 0.88

const EXCLUSIONS: Record<string, string> = {
  ppt169_china_telecom_2025: '中国电信 2025 业绩稿，封面和内页使用天翼/中国电信品牌标识与官方口径。',
  ppt169_apple_fy2025_review: '苹果 FY2025 官方财报复盘，页面按 Apple 财报材料编排，并链到 FY25 文件。',
  ppt169_cloudflare_outage_postmortem: 'Cloudflare 2025-11-18 官方事故复盘，设计建立在该公司的事故材料上。',
  ppt169_uv_launch: 'Astral uv 产品发布稿，页面指向 astral.sh，并使用该产品的发布物料。',
  ppt169_china_rail_2024_zh: '中国铁路 / 国铁集团 2024 官方统计口径，属于企业官方材料。',
  ppt169_china_rail_2024_zh_sonnet: '同一套中国铁路官方统计，并配有复兴号列车照片。',
  moments_nine_heritage_goods: '回力、永久、大白兔等商业商标和包装，页面依赖第三方品牌标识。',
  ppt169_jilin_geohazard_rules_beautify: '吉林省自然资源厅公文，页眉带该机关标志。',
  ppt169_telford_feedback_2023_24_quick: 'Telford & Wrekin 议会 Corporate Feedback Report，页面含 council-logo。',
}

const STYLE_LINKS: Array<{ id: string; test: (styleName: string) => boolean }> = [
  { id: 'academic-research', test: name => /academic research/i.test(name) },
  { id: 'consulting-decision', test: name => /consulting decision/i.test(name) },
  { id: 'creative-pitch', test: name => /creative pitch/i.test(name) },
  { id: 'duty-manual', test: name => /duty manual/i.test(name) },
  { id: 'incident-postmortem', test: name => /postmortem/i.test(name) },
  { id: 'investor-pitch', test: name => /investor pitch/i.test(name) },
  { id: 'mbb-consulting', test: name => /consulting document/i.test(name) },
  { id: 'narrative-keynote', test: name => /narrative keynote/i.test(name) },
  { id: 'operating-review', test: name => /operating review/i.test(name) },
  { id: 'product-launch', test: name => /dark-tech launch/i.test(name) },
  { id: 'science-explainer', test: name => /science explainer/i.test(name) },
  { id: 'solution-proposal', test: name => /solution proposal/i.test(name) },
  { id: 'technical-deepdive', test: name => /technical deep dive/i.test(name) },
  { id: 'workshop-teaching', test: name => /workshop teaching/i.test(name) },
]

type Xml = {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: { length: number; [index: number]: Xml }
  getAttribute(name: string): string | null
  getAttributeNS(namespace: string, local: string): string | null
}

type Box = { x: number; y: number; w: number; h: number }
type Stop = { offset: number; color: string }
type GradDef = {
  kind: 'linear' | 'radial'
  x1: number
  y1: number
  x2: number
  y2: number
  cx: number
  cy: number
  units: 'objectBoundingBox' | 'userSpaceOnUse'
  stops: Stop[]
  transform: Matrix
}
type PatternDef = PatternFill | { solid: string }
type Clip = { rect: Box; circle?: { cx: number; cy: number; r: number } }
type Style = {
  fill: string
  stroke: string
  strokeWidth: number
  fillOpacity: number
  strokeOpacity: number
  opacity: number
  fontFamily: string
  fontSize: number
  fontWeight: string
  italic: boolean
  letterSpacing: number
  anchor: 'start' | 'middle' | 'end'
  baseline: string
  dash: boolean
  hidden: boolean
  preserve: boolean
  filter: string
}

type Project = {
  id: string
  title: string
  style: string
  styleName: string
  folder: string
  slides: Array<{ file: string; title?: string; desc?: string }>
}

type Converted = {
  id: string
  title: string
  styleName: string
  category: string
  canvas: string
  pages: number
  credits: string
  issues: string[]
  gaps: Record<string, number>
}

const assets = new Map<string, string>()

function mainArgs(): { root: string; only: Set<string> | null } {
  const args = process.argv.slice(2)
  let root = '/tmp/ppt-master-examples/examples'
  let only: Set<string> | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = args[++i] ?? root
    if (args[i] === '--only') only = new Set((args[++i] ?? '').split(',').filter(Boolean))
  }
  return { root, only }
}

const { root: exampleRoot, only } = mainArgs()

function localName(node: Xml): string {
  return node.nodeName.replace(/^.*:/, '').toLowerCase()
}

function children(node: Xml): Xml[] {
  const out: Xml[] = []
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && child.nodeType === 1) out.push(child)
  }
  return out
}

function attr(node: Xml, name: string): string {
  return node.getAttribute(name)
    || node.getAttributeNS('http://www.w3.org/1999/xlink', name)
    || node.getAttribute(`xlink:${name}`)
    || ''
}

function styleMap(node: Xml): Record<string, string> {
  const map: Record<string, string> = {}
  for (const part of (node.getAttribute('style') || '').split(';')) {
    const index = part.indexOf(':')
    if (index < 0) continue
    map[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
  }
  return map
}

function prop(node: Xml, styles: Record<string, string>, name: string): string | null {
  if (styles[name] !== undefined && styles[name] !== '') return styles[name]!
  const value = node.getAttribute(name)
  return value === null || value === '' ? null : value
}

function num(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))/)
  return match ? Number(match[1]) : fallback
}

function lengthOf(value: string | null, fallback: number, reference = fallback): number {
  if (!value) return fallback
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!match) return fallback
  const amount = Number(match[1])
  const unit = match[2]!.trim().toLowerCase()
  if (unit === '%') return reference * amount / 100
  if (unit === 'em') return reference * amount
  if (unit === 'pt') return amount / PX
  return amount
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function rbox(box: Box): Box {
  return { x: round(box.x), y: round(box.y), w: round(Math.max(0.5, box.w)), h: round(Math.max(0.5, box.h)) }
}

function toPt(box: Box): Box {
  return rbox({ x: box.x * PX, y: box.y * PX, w: box.w * PX, h: box.h * PX })
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  gray: '#808080', grey: '#808080', silver: '#C0C0C0', maroon: '#800000', navy: '#000080',
  olive: '#808000', teal: '#008080', purple: '#800080', orange: '#FFA500', yellow: '#FFFF00',
  lime: '#00FF00', aqua: '#00FFFF', fuchsia: '#FF00FF', transparent: '#00000000', none: '',
}

function parseColor(value: string | null, opacity: number): string | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw || raw === 'none' || raw.startsWith('url(')) return null
  let hex = ''
  let alpha = 1
  if (raw.startsWith('#')) {
    const body = raw.slice(1)
    if (body.length === 3 || body.length === 4) {
      hex = body.slice(0, 3).split('').map(ch => ch + ch).join('')
      if (body.length === 4) alpha = Number.parseInt(body[3]! + body[3], 16) / 255
    } else if (body.length === 6 || body.length === 8) {
      hex = body.slice(0, 6)
      if (body.length === 8) alpha = Number.parseInt(body.slice(6), 16) / 255
    }
  } else if (raw.startsWith('rgb')) {
    const parts = raw.match(/[\d.]+/g)?.map(Number) ?? []
    if (parts.length >= 3) {
      hex = parts.slice(0, 3).map(part => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')
      if (parts.length >= 4) alpha = parts[3]! > 1 ? parts[3]! / 255 : parts[3]!
    }
  } else {
    const named = NAMED[raw.toLowerCase()]
    if (named === '') return null
    if (named) hex = named.slice(1, 7)
  }
  if (!hex) return null
  alpha *= opacity
  if (alpha >= 0.995) return `#${hex.toUpperCase()}`
  if (alpha <= 0.004) return '#00000000'
  return `#${hex.toUpperCase()}${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}`
}

function inherit(node: Xml, parent: Style): Style {
  const styles = styleMap(node)
  const ownOpacity = num(prop(node, styles, 'opacity'), 1)
  const weight = prop(node, styles, 'font-weight')
  const italic = prop(node, styles, 'font-style')
  const anchor = prop(node, styles, 'text-anchor')
  const baseline = prop(node, styles, 'dominant-baseline') || prop(node, styles, 'alignment-baseline')
  const dash = prop(node, styles, 'stroke-dasharray')
  const display = prop(node, styles, 'display')
  const visibility = prop(node, styles, 'visibility')
  const preserve = prop(node, styles, 'xml:space') || node.getAttribute('xml:space')
  return {
    fill: prop(node, styles, 'fill') ?? parent.fill,
    stroke: prop(node, styles, 'stroke') ?? parent.stroke,
    strokeWidth: lengthOf(prop(node, styles, 'stroke-width'), parent.strokeWidth, parent.fontSize),
    fillOpacity: num(prop(node, styles, 'fill-opacity'), parent.fillOpacity),
    strokeOpacity: num(prop(node, styles, 'stroke-opacity'), parent.strokeOpacity),
    opacity: parent.opacity * (Number.isFinite(ownOpacity) ? ownOpacity : 1),
    fontFamily: prop(node, styles, 'font-family') ?? parent.fontFamily,
    fontSize: lengthOf(prop(node, styles, 'font-size'), parent.fontSize, parent.fontSize),
    fontWeight: weight ?? parent.fontWeight,
    italic: italic ? /italic|oblique/i.test(italic) : parent.italic,
    letterSpacing: lengthOf(prop(node, styles, 'letter-spacing'), parent.letterSpacing, parent.fontSize),
    anchor: anchor === 'middle' || anchor === 'end' || anchor === 'start' ? anchor : parent.anchor,
    baseline: baseline ?? parent.baseline,
    dash: dash ? dash !== 'none' && num(dash) > 0 : parent.dash,
    hidden: display === 'none' || visibility === 'hidden' || parent.hidden,
    preserve: preserve ? preserve === 'preserve' : parent.preserve,
    filter: prop(node, styles, 'filter') ?? parent.filter,
  }
}

const baseStyle: Style = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: '400',
  italic: false,
  letterSpacing: 0,
  anchor: 'start',
  baseline: 'alphabetic',
  dash: false,
  hidden: false,
  preserve: false,
  filter: '',
}

function fontOf(stack: string, text: string, sizePt: number, bold: boolean, italic: boolean, tracking: number): DeckElement['font'] {
  const names = stack.split(',').map(part => part.trim().replace(/^['"]|['"]$/g, ''))
  const joined = names.join(' ').toLowerCase()
  const kai = /kai|楷/.test(joined)
  const serif = kai || /georgia|times|song|simsun|宋|garamond|palatino|cambria|liberation serif|noto serif|source han serif/.test(joined)
  const mono = /consolas|mono|menlo|courier|source code|jetbrains|inconsolata/.test(joined)
  const face: FontFace = {
    latin: mono ? 'Consolas' : serif ? 'Georgia' : 'Arial',
    cjk: kai
      ? { mac: 'Kaiti SC', win: 'KaiTi', linux: 'Noto Serif CJK SC' }
      : serif
        ? { mac: 'Songti SC', win: 'SimSun', linux: 'Noto Serif CJK SC' }
        : { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
  }
  return {
    family: containsCjk(text) ? '$cjk' : '$latin',
    size: round(Math.max(6, Math.min(240, sizePt))),
    weight: bold ? 'bold' : 'regular',
    italic: italic || undefined,
    align: 'left',
    valign: 'top',
    tracking: round(Math.max(-20, Math.min(80, tracking))),
    face,
  }
}

function boldOf(weight: string): boolean {
  if (/bold|black|semibold|medium/i.test(weight) && !/normal/i.test(weight)) return !/medium/i.test(weight) || /[6-9]00|bold/.test(weight)
  const numeric = Number(weight)
  return Number.isFinite(numeric) && numeric >= 600
}

function urlId(value: string): string | null {
  const match = value.match(/url\(#([^)]+)\)/)
  return match?.[1] ?? null
}

function transformedBox(matrix: Matrix, x: number, y: number, w: number, h: number): Box {
  const corners = [apply(matrix, x, y), apply(matrix, x + w, y), apply(matrix, x, y + h), apply(matrix, x + w, y + h)]
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const btm = Math.min(a.y + a.h, b.y + b.h)
  if (r - x < 0.4 || btm - y < 0.4) return null
  return { x, y, w: r - x, h: btm - y }
}

function viewBoxOf(node: Xml, fallbackW: number, fallbackH: number): Box {
  const raw = node.getAttribute('viewBox')
  if (!raw) return { x: 0, y: 0, w: fallbackW, h: fallbackH }
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length < 4 || parts.some(part => !Number.isFinite(part))) return { x: 0, y: 0, w: fallbackW, h: fallbackH }
  return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! }
}

type Align = { x: number; y: number; slice: boolean; none: boolean }

function preserveOf(value: string | null): Align {
  if (!value || value === 'none') return { x: 0, y: 0, slice: false, none: !value || value === 'none' ? value === 'none' : false }
  const [align = 'xMidYMid', meet = 'meet'] = value.split(/\s+/)
  const x = /xMin/i.test(align) ? 0 : /xMax/i.test(align) ? 1 : 0.5
  const y = /YMin/i.test(align) ? 0 : /YMax/i.test(align) ? 1 : 0.5
  return { x, y, slice: meet === 'slice', none: false }
}

function viewBoxMatrix(viewport: Box, viewBox: Box, align: Align): Matrix {
  if (align.none || viewBox.w === 0 || viewBox.h === 0) {
    const sx = viewport.w / (viewBox.w || 1)
    const sy = viewport.h / (viewBox.h || 1)
    return [sx, 0, 0, sy, viewport.x - viewBox.x * sx, viewport.y - viewBox.y * sy]
  }
  const sx = viewport.w / viewBox.w
  const sy = viewport.h / viewBox.h
  const scale = align.slice ? Math.max(sx, sy) : Math.min(sx, sy)
  const extraX = viewport.w - viewBox.w * scale
  const extraY = viewport.h - viewBox.h * scale
  return [scale, 0, 0, scale, viewport.x + extraX * align.x - viewBox.x * scale, viewport.y + extraY * align.y - viewBox.y * scale]
}

class PageBuilder {
  elements: DeckElement[] = []
  background = '#FFFFFF'
  gaps: Record<string, number> = {}
  private serial = 0
  constructor(
    readonly canvas: Box,
    readonly gradients: Map<string, GradDef>,
    readonly patterns: Map<string, PatternDef>,
    readonly filters: Map<string, ShadowSpec>,
    readonly svgDir: string,
  ) {}

  gap(name: string): void {
    this.gaps[name] = (this.gaps[name] ?? 0) + 1
  }

  id(): string {
    this.serial += 1
    return `e${this.serial}`
  }

  add(element: DeckElement): void {
    const box = element.bounds
    if (box.w < 0.4 || box.h < 0.4) return
    if (box.x > this.canvas.w + 80 || box.y > this.canvas.h + 80) return
    if (box.x + box.w < -80 || box.y + box.h < -80) return
    this.elements.push(element)
  }
}

function readDefs(root: Xml): { gradients: Map<string, GradDef>; patterns: Map<string, PatternDef>; filters: Map<string, ShadowSpec>; clips: Map<string, Clip> } {
  const gradients = new Map<string, GradDef>()
  const patterns = new Map<string, PatternDef>()
  const filters = new Map<string, ShadowSpec>()
  const clips = new Map<string, Clip>()
  const nodes: Xml[] = []
  const walk = (node: Xml) => {
    nodes.push(node)
    for (const child of children(node)) walk(child)
  }
  walk(root)
  const byId = new Map<string, Xml>()
  for (const node of nodes) {
    const id = node.getAttribute('id')
    if (id) byId.set(id, node)
  }
  for (const node of nodes) {
    const name = localName(node)
    const id = node.getAttribute('id')
    if (!id) continue
    if (name === 'lineargradient' || name === 'radialgradient') gradients.set(id, gradientDef(node, byId))
    if (name === 'pattern') patterns.set(id, patternDef(node))
    if (name === 'filter') {
      const shadow = filterDef(node)
      if (shadow) filters.set(id, shadow)
    }
    if (name === 'clippath') {
      const clip = clipDef(node)
      if (clip) clips.set(id, clip)
    }
  }
  return { gradients, patterns, filters, clips }
}

function gradientDef(node: Xml, byId: Map<string, Xml>, seen = new Set<string>()): GradDef {
  const id = node.getAttribute('id') || ''
  const href = attr(node, 'href').replace(/^#/, '')
  let base: GradDef | null = null
  if (href && !seen.has(href) && byId.get(href)) {
    seen.add(id)
    const parent = byId.get(href)!
    if (localName(parent).includes('gradient')) base = gradientDef(parent, byId, seen)
  }
  const units = node.getAttribute('gradientUnits') === 'userSpaceOnUse' || base?.units === 'userSpaceOnUse'
    ? (node.getAttribute('gradientUnits') === 'objectBoundingBox' ? 'objectBoundingBox' : (node.getAttribute('gradientUnits') === 'userSpaceOnUse' ? 'userSpaceOnUse' : (base?.units ?? 'objectBoundingBox')))
    : 'objectBoundingBox'
  const stops = children(node).filter(child => localName(child) === 'stop').map(stop => {
    const styles = styleMap(stop)
    const color = parseColor(prop(stop, styles, 'stop-color') ?? '#000000', num(prop(stop, styles, 'stop-opacity'), 1)) ?? '#000000'
    return { offset: Math.max(0, Math.min(1, offsetOf(stop.getAttribute('offset')))), color }
  })
  const kind = localName(node) === 'radialgradient' ? 'radial' : (base?.kind ?? 'linear')
  return {
    kind,
    x1: num(node.getAttribute('x1'), base?.x1 ?? 0),
    y1: num(node.getAttribute('y1'), base?.y1 ?? 0),
    x2: num(node.getAttribute('x2'), base?.x2 ?? 1),
    y2: num(node.getAttribute('y2'), base?.y2 ?? 0),
    cx: num(node.getAttribute('cx'), base?.cx ?? 0.5),
    cy: num(node.getAttribute('cy'), base?.cy ?? 0.5),
    units,
    stops: stops.length >= 2 ? stops : (base?.stops ?? [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }]),
    transform: node.getAttribute('gradientTransform') ? parseTransform(node.getAttribute('gradientTransform')) : (base?.transform ?? IDENTITY),
  }
}

function offsetOf(value: string | null): number {
  if (!value) return 0
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return 0
  if (value.trim().endsWith('%') || amount > 1) return amount / 100
  return amount
}

function patternDef(node: Xml): PatternDef {
  const preset = node.getAttribute('data-pptx-pattern')
  const foreground = node.getAttribute('data-pptx-fg')
  const background = node.getAttribute('data-pptx-bg')
  if (preset && foreground && background) {
    return { preset, foreground: parseColor(foreground, 1) ?? '#000000', background: parseColor(background, 1) ?? '#FFFFFF' }
  }
  let solid: string | undefined
  for (const child of children(node)) {
    const name = localName(child)
    const fill = child.getAttribute('fill')
    if (name === 'rect' && fill) solid = parseColor(fill, num(child.getAttribute('fill-opacity'), 1)) ?? solid
    if ((name === 'circle' || name === 'ellipse') && fill) {
      return {
        preset: 'pct5',
        foreground: parseColor(fill, num(child.getAttribute('fill-opacity'), 1)) ?? '#000000',
        // A dot pattern leaves the gaps clear. An opaque white gap would hide the photo underneath.
        background: solid ?? '#FFFFFF00',
      }
    }
  }
  return { solid: solid ?? '#FFFFFF' }
}

function filterDef(node: Xml): ShadowSpec | null {
  for (const child of children(node)) {
    if (localName(child) === 'fedropshadow') {
      const dx = num(child.getAttribute('dx'), 0)
      const dy = num(child.getAttribute('dy'), 2)
      const blur = num(child.getAttribute('stdDeviation'), 2)
      const color = parseColor(child.getAttribute('flood-color') ?? '#000000', 1) ?? '#000000'
      return {
        color,
        opacity: Math.max(0, Math.min(1, num(child.getAttribute('flood-opacity'), 0.5))),
        blur: Math.max(0.5, blur * 2 * PX),
        offset: Math.max(0.5, Math.hypot(dx, dy) * PX),
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      }
    }
  }
  const flood = children(node).find(child => localName(child) === 'feflood')
  const blur = children(node).find(child => localName(child) === 'fegaussianblur')
  if (flood && blur) {
    return {
      color: parseColor(flood.getAttribute('flood-color') ?? '#000000', 1) ?? '#000000',
      opacity: Math.max(0, Math.min(1, num(flood.getAttribute('flood-opacity'), 0.45))),
      blur: Math.max(0.5, num(blur.getAttribute('stdDeviation'), 6) * PX),
      offset: 0.5,
      angle: 45,
    }
  }
  return null
}

function clipDef(node: Xml): Clip | null {
  const shapes = children(node)
  const circle = shapes.find(child => localName(child) === 'circle')
  const ellipse = shapes.find(child => localName(child) === 'ellipse')
  const rect = shapes.find(child => localName(child) === 'rect')
  const path = shapes.find(child => localName(child) === 'path')
  const polygon = shapes.find(child => localName(child) === 'polygon')
  if (circle) {
    const cx = num(circle.getAttribute('cx'))
    const cy = num(circle.getAttribute('cy'))
    const radius = num(circle.getAttribute('r'))
    return { rect: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, circle: { cx, cy, r: radius } }
  }
  if (ellipse) {
    const cx = num(ellipse.getAttribute('cx'))
    const cy = num(ellipse.getAttribute('cy'))
    const rx = num(ellipse.getAttribute('rx'))
    const ry = num(ellipse.getAttribute('ry'))
    const round = Math.abs(rx - ry) <= Math.max(rx, ry) * 0.08
    return {
      rect: { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 },
      circle: round ? { cx, cy, r: (rx + ry) / 2 } : undefined,
    }
  }
  if (rect) {
    return { rect: { x: num(rect.getAttribute('x')), y: num(rect.getAttribute('y')), w: num(rect.getAttribute('width')), h: num(rect.getAttribute('height')) } }
  }
  if (path) {
    const d = path.getAttribute('d') || ''
    const bounds = commandBounds(parseSvgPath(d), 0)
    if (!bounds || bounds.w < 0.5 || bounds.h < 0.5) return null
    return { rect: bounds, circle: circleFromPath(d, bounds) }
  }
  if (polygon) {
    const d = pathData(polygon)
    if (!d) return null
    const bounds = commandBounds(parseSvgPath(d), 0)
    if (!bounds || bounds.w < 0.5 || bounds.h < 0.5) return null
    return { rect: bounds }
  }
  return null
}

function circleFromPath(d: string, bounds: Box): { cx: number; cy: number; r: number } | undefined {
  const radii = [...d.matchAll(/[aA]\s*([0-9.]+)(?:[,\s]+)([0-9.]+)/g)]
  if (radii.length < 2) return undefined
  const rx = radii.map(match => Number(match[1]))
  const ry = radii.map(match => Number(match[2]))
  if (rx.some(value => !Number.isFinite(value)) || ry.some(value => !Number.isFinite(value))) return undefined
  const radius = rx[0]!
  if (rx.some(value => Math.abs(value - radius) > 1) || ry.some(value => Math.abs(value - radius) > 1)) return undefined
  if (Math.abs(bounds.w - bounds.h) > Math.max(bounds.w, bounds.h) * 0.08) return undefined
  if (Math.abs(bounds.w - radius * 2) > radius * 0.25) return undefined
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, r: Math.min(bounds.w, bounds.h) / 2 }
}

function paintOf(page: PageBuilder, style: Style, box: Box): { fill?: string; gradient?: GradientFill; pattern?: PatternFill } {
  const target = style.fill
  const opacity = style.opacity * style.fillOpacity
  if (!target || target === 'none') return {}
  const id = urlId(target)
  if (id && page.gradients.has(id)) {
    const gradient = page.gradients.get(id)!
    return { fill: gradient.stops.at(-1)?.color ?? '#000000', gradient: gradientPaint(gradient, box) }
  }
  if (id && page.patterns.has(id)) {
    const pattern = page.patterns.get(id)!
    if ('preset' in pattern) {
      const scaled = opacity >= 0.995
        ? pattern
        : {
            ...pattern,
            foreground: parseColor(pattern.foreground, opacity) ?? pattern.foreground,
            background: parseColor(pattern.background, opacity) ?? pattern.background,
          }
      return { fill: scaled.background, pattern: scaled }
    }
    return { fill: pattern.solid }
  }
  const color = parseColor(target, opacity)
  return color ? { fill: color } : {}
}

function gradientPaint(gradient: GradDef, box: Box): GradientFill {
  if (gradient.kind === 'radial') {
    const cx = gradient.units === 'objectBoundingBox' ? gradient.cx : box.w ? (gradient.cx - box.x) / box.w : 0.5
    const cy = gradient.units === 'objectBoundingBox' ? gradient.cy : box.h ? (gradient.cy - box.y) / box.h : 0.5
    return {
      kind: 'radial',
      cx: Math.max(0, Math.min(1, cx)),
      cy: Math.max(0, Math.min(1, cy)),
      stops: gradient.stops,
    }
  }
  const x1 = gradient.units === 'objectBoundingBox' ? box.x + gradient.x1 * box.w : gradient.x1
  const y1 = gradient.units === 'objectBoundingBox' ? box.y + gradient.y1 * box.h : gradient.y1
  const x2 = gradient.units === 'objectBoundingBox' ? box.x + gradient.x2 * box.w : gradient.x2
  const y2 = gradient.units === 'objectBoundingBox' ? box.y + gradient.y2 * box.h : gradient.y2
  const start = apply(gradient.transform, x1, y1)
  const end = apply(gradient.transform, x2, y2)
  return {
    kind: 'linear',
    angle: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
    stops: gradient.stops,
    absolute: gradient.units === 'userSpaceOnUse' ? true : undefined,
  }
}

function strokeOf(style: Style): DeckElement['line'] | undefined {
  if (!style.stroke || style.stroke === 'none' || style.stroke.startsWith('url(')) return undefined
  const color = parseColor(style.stroke, style.opacity * style.strokeOpacity)
  if (!color || color.endsWith('00')) return undefined
  return { color, width: Math.max(0.25, style.strokeWidth * PX), style: style.dash ? 'dash' : 'solid' }
}

function shadowOf(page: PageBuilder, style: Style): ShadowSpec | undefined {
  const id = urlId(style.filter)
  if (!id) return undefined
  return page.filters.get(id)
}

async function convertPage(file: string, canvas: Box): Promise<{ background: string; elements: DeckElement[]; gaps: Record<string, number> }> {
  const text = readFileSync(file, 'utf8')
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(text, 'image/svg+xml')
  const root = children(doc).find(node => localName(node) === 'svg') ?? (doc as unknown as Xml)
  const view = viewBoxOf(root, num(root.getAttribute('width'), canvas.w / PX), num(root.getAttribute('height'), canvas.h / PX))
  const sx = view.w ? canvas.w / PX / view.w : 1
  const sy = view.h ? canvas.h / PX / view.h : 1
  const matrix: Matrix = [sx, 0, 0, sy, -view.x * sx, -view.y * sy]
  const defs = readDefs(root)
  const page = new PageBuilder(
    { x: 0, y: 0, w: canvas.w / PX, h: canvas.h / PX },
    defs.gradients,
    defs.patterns,
    defs.filters,
    dirname(file),
  )
  const clip: Clip = { rect: { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h } }
  await walk(root, page, matrix, inherit(root, baseStyle), clip, defs.clips, true)
  return { background: page.background, elements: page.elements, gaps: page.gaps }
}

async function walk(node: Xml, page: PageBuilder, matrix: Matrix, style: Style, clip: Clip, clips: Map<string, Clip>, root: boolean): Promise<void> {
  const name = localName(node)
  if (style.hidden || name === 'defs' || name === 'metadata' || name === 'title' || name === 'desc' || name === 'style' || name === 'filter' || name === 'script') return
  if (node.getAttribute('data-pptx-morph-staging') === 'true') return
  if (name === 'a' || name === 'switch') {
    for (const child of children(node)) await walk(child, page, matrix, style, clip, clips, false)
    return
  }
  const next = root ? style : inherit(node, style)
  if (next.hidden) return
  const own = root ? matrix : multiply(matrix, parseTransform(node.getAttribute('transform')))
  let nextClip = clip
  const clipId = urlId(node.getAttribute('clip-path') || '')
  if (clipId && clips.get(clipId)) {
    const local = clips.get(clipId)!
    const rect = transformedBox(own, local.rect.x, local.rect.y, local.rect.w, local.rect.h)
    const hit = intersect(clip.rect, rect)
    if (!hit) return
    const circle = local.circle
      ? { cx: apply(own, local.circle.cx, local.circle.cy).x, cy: apply(own, local.circle.cx, local.circle.cy).y, r: local.circle.r * Math.hypot(own[0], own[1]) }
      : clip.circle
    nextClip = { rect: hit, circle }
  }
  if ((name === 'g' || name === 'a') && (await emitObject(node, page, own))) return
  if (name === 'svg' && !root) {
    const x = num(node.getAttribute('x'))
    const y = num(node.getAttribute('y'))
    const w = num(node.getAttribute('width'), 0)
    const h = num(node.getAttribute('height'), 0)
    const viewport = transformedBox(own, x, y, w || 1, h || 1)
    const view = viewBoxOf(node, w || 1, h || 1)
    const childMatrix = multiply(own, viewBoxMatrix({ x, y, w: w || view.w, h: h || view.h }, view, preserveOf(node.getAttribute('preserveAspectRatio') || 'none')))
    const hit = intersect(nextClip.rect, viewport)
    if (!hit) return
    for (const child of children(node)) await walk(child, page, childMatrix, next, { rect: hit, circle: nextClip.circle }, clips, false)
    return
  }
  if (name === 'g' || name === 'svg') {
    for (const child of children(node)) await walk(child, page, own, next, nextClip, clips, false)
    return
  }
  if (name === 'text') {
    emitText(node, page, own, next)
    return
  }
  if (name === 'image') {
    await emitImage(node, page, own, nextClip)
    return
  }
  if (name === 'rect' || name === 'circle' || name === 'ellipse' || name === 'line' || name === 'path' || name === 'polygon' || name === 'polyline') {
    emitShape(node, page, own, next)
  }
}

async function emitObject(node: Xml, page: PageBuilder, matrix: Matrix): Promise<boolean> {
  const kind = node.getAttribute('data-pptx-replace-with')
  const metaNode = children(node).find(child => localName(child) === 'metadata')
  if (!metaNode) return false
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(metaNode.textContent || '') as Record<string, unknown>
  } catch {
    return false
  }
  const type = String(meta.type || '')
  const schema = String(meta.schema || '')
  const chart = kind === 'chart' || /chart/.test(schema) || ['bar', 'column', 'line', 'pie', 'doughnut', 'donut', 'waterfall', 'area', 'scatter', 'combo'].includes(type)
  const table = kind === 'table' || schema.includes('semantic-table')
  if (table) {
    const element = tableElement(page, meta, matrix)
    if (element) {
      page.add(element)
      return true
    }
  }
  if (chart) {
    const element = chartElement(page, meta, matrix)
    if (element) {
      page.add(element)
      return true
    }
    return false
  }
  return false
}

function userBox(matrix: Matrix, x: number, y: number, w: number, h: number): Box {
  return transformedBox(matrix, x, y, w, h)
}

function chartElement(page: PageBuilder, meta: Record<string, unknown>, matrix: Matrix): DeckElement | null {
  const type = String(meta.type || '')
  const kind = ({ bar: 'bar', column: 'column', col: 'column', line: 'line', pie: 'pie', doughnut: 'doughnut', donut: 'doughnut', waterfall: 'waterfall' } as Record<string, DeckElement['chart'] extends infer T ? T extends { kind: infer K } ? K : never : never>)[type]
  if (!kind) return null
  const categories = Array.isArray(meta.categories) ? meta.categories.map(item => String(item).trim() || '—') : []
  if (categories.length === 0) return null
  const rawSeries = Array.isArray(meta.series) ? meta.series as Array<Record<string, unknown>> : []
  let series: Array<{ name: string; values: number[] }> = []
  let colors: string[] | undefined
  if (kind === 'waterfall') {
    const values = numberList(meta.values) ?? numberList((rawSeries[0] ?? {}).values)
    if (!values || values.length < 3 || values.length !== categories.length) return null
    const subs = Array.isArray(meta.subtotal_indices) ? meta.subtotal_indices.map(Number) : []
    if (subs.some(index => index !== 0 && index !== values.length - 1)) return null
    const start = values[0]!
    const end = values[values.length - 1]!
    const deltas = values.slice(1, -1).reduce((sum, value) => sum + value, 0)
    if (Math.abs(start + deltas - end) > 0.051) return null
    series = [{ name: '值', values }]
    const style = (meta.style ?? {}) as Record<string, unknown>
    const palette = stringList(style.colors)
    if (palette.length >= 2) colors = [palette[0]!, palette[0]!, palette[1]!]
    else if (palette.length === 1) colors = [palette[0]!, palette[0]!, palette[0]!]
  } else {
    series = rawSeries.map(entry => ({
      name: String(entry.name || '系列'),
      values: numberList(entry.values) ?? [],
    })).filter(entry => entry.values.length === categories.length)
    if (series.length === 0) return null
    const pointColors = stringList(rawSeries[0]?.point_colors)
    if (series.length === 1 && pointColors.length > 0) colors = pointColors.map(color => parseColor(color, 1) ?? '#333333')
    else {
      const style = (meta.style ?? {}) as Record<string, unknown>
      const palette = stringList(style.colors).map(color => parseColor(color, 1) ?? '#333333')
      if (palette.length > 0) colors = palette
    }
  }
  const box = placedBox(matrix, meta)
  const axes = (meta.axes ?? {}) as Record<string, Record<string, unknown>>
  const valueAxis = axes.value ?? axes.val ?? {}
  const categoryAxis = axes.category ?? {}
  const labels = (meta.data_labels ?? {}) as Record<string, unknown>
  const style = (meta.style ?? {}) as Record<string, unknown>
  const labelSize = (value: unknown) => {
    const amount = Number(value)
    if (!Number.isFinite(amount)) return undefined
    return round(Math.max(8, Math.min(32, amount * PX)))
  }
  return {
    id: page.id(),
    type: 'chart',
    role: 'content',
    bounds: toPt(box),
    chart: {
      kind,
      categories,
      series,
      colors,
      showValues: labels.show_value === true,
      showLegend: meta.show_legend === true,
      valMin: finite(valueAxis.minimum),
      valMax: finite(valueAxis.maximum),
      holeSize: kind === 'doughnut' ? Math.max(0, Math.min(90, Number(meta.hole_size ?? 62))) : undefined,
      grid: valueAxis.major_gridlines === false ? 'none' : 'solid',
      catLabelSize: labelSize(categoryAxis.font_size ?? style.axis_font_size),
      valLabelSize: labelSize(valueAxis.font_size ?? style.axis_font_size),
      catLabelColor: typeof categoryAxis.color === 'string' ? parseColor(categoryAxis.color, 1) ?? undefined : undefined,
      valLabelColor: typeof valueAxis.color === 'string' ? parseColor(valueAxis.color, 1) ?? undefined : undefined,
    },
  }
}

function tableCell(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' || typeof value === 'number') return { text: String(value) }
  return (value ?? {}) as Record<string, unknown>
}

function tableElement(page: PageBuilder, meta: Record<string, unknown>, matrix: Matrix): DeckElement | null {
  if (!Array.isArray(meta.columns) || !Array.isArray(meta.rows)) return null
  const header = meta.columns.map(tableCell)
  const body = (meta.rows as unknown[][]).map(row => row.map(tableCell))
  if (header.length === 0 || body.some(row => row.length !== header.length)) return null
  const widths = numberList(meta.column_widths) ?? header.map(() => 1)
  const sum = widths.reduce((total, value) => total + value, 0) || 1
  const style = (meta.style ?? {}) as Record<string, unknown>
  const defaults = ((meta.defaults ?? {}) as Record<string, unknown>).cell as Record<string, unknown> | undefined ?? {}
  const borders = (defaults.borders ?? {}) as Record<string, Record<string, unknown>>
  const edge = borders.bottom ?? borders.top ?? {}
  const fontSize = round(Math.max(6, Math.min(96, num(String(defaults.font_size ?? style.font_size ?? 14), 14) * PX)))
  const ink = parseColor(String(defaults.color ?? style.body_text ?? '#1A1A1A'), 1) ?? '#1A1A1A'
  const paper = parseColor(String(style.body_fill ?? defaults.fill ?? page.background), 1) ?? page.background
  const rows = [header, ...body].map((row, rowIndex) => row.map(cell => ({
    text: String(cell.text ?? ''),
    bold: cell.bold === true || rowIndex === 0 ? true : undefined,
    fill: typeof cell.fill === 'string' ? parseColor(cell.fill, 1) ?? undefined : undefined,
    color: typeof cell.color === 'string' ? parseColor(cell.color, 1) ?? ink : ink,
    align: cell.align === 'c' || cell.align === 'center' ? 'center' as const : cell.align === 'r' || cell.align === 'right' ? 'right' as const : 'left' as const,
  })))
  const box = placedBox(matrix, meta)
  const heights = numberList(meta.row_heights)?.map(value => value * PX) ?? rows.map(() => (box.h * PX) / rows.length)
  while (heights.length < rows.length) heights.push(fontSize + 8)
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const width = Math.max(8, (widths[columnIndex]! / sum) * box.w * PX - 8)
      const lines = wrapText(cell.text, width, fontSize, cell.bold === true)
      const needed = lines.length <= 1 ? fontSize : fontSize + (lines.length - 1) * fontSize * 1.15
      heights[rowIndex] = Math.max(heights[rowIndex] ?? fontSize, needed + 2)
    })
  })
  const height = heights.reduce((total, value) => total + value, 0)
  return {
    id: page.id(),
    type: 'table',
    role: 'content',
    bounds: rbox({ x: box.x * PX, y: box.y * PX, w: box.w * PX, h: height }),
    table: {
      columns: widths.map(value => value / sum),
      rowHeights: heights.map(value => round(value)),
      rows,
      fontSize,
      fontFamily: rows.some(row => row.some(cell => containsCjk(cell.text))) ? '$cjk' : '$latin',
      color: ink,
      fill: paper,
      border: {
        color: typeof edge.color === 'string' ? parseColor(edge.color, 1) ?? '#D0D0D0' : '#D0D0D0',
        width: edge.style === 'none' ? 0 : round(Math.max(0.25, num(String(edge.width ?? style.border_width ?? 1), 1) * PX)),
      },
      header: {
        bold: true,
        color: parseColor(String(style.header_text ?? defaults.color ?? ink), 1) ?? undefined,
        fill: parseColor(String(header.find(cell => typeof cell.fill === 'string')?.fill ?? style.header_fill ?? paper), 1) ?? undefined,
      },
    },
  }
}

function placedBox(matrix: Matrix, meta: Record<string, unknown>): Box {
  return userBox(matrix, Number(meta.x ?? 0), Number(meta.y ?? 0), Number(meta.width ?? 10), Number(meta.height ?? 10))
}

function numberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const numbers = value.map(item => typeof item === 'number' ? item : Number(item))
  if (numbers.some(item => !Number.isFinite(item))) return null
  return numbers
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

function finite(value: unknown): number | undefined {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : undefined
}

function emitText(node: Xml, page: PageBuilder, matrix: Matrix, style: Style): void {
  const scaleX = Math.hypot(matrix[0], matrix[1]) || 1
  const scaleY = Math.hypot(matrix[2], matrix[3]) || 1
  const visit = (current: Xml, currentStyle: Style, x: number, y: number): number => {
    let localX = current.getAttribute('x') ? num(current.getAttribute('x')) : x
    let localY = current.getAttribute('y') ? num(current.getAttribute('y')) : y
    localX += num(current.getAttribute('dx'))
    localY += num(current.getAttribute('dy'))
    let pending = ''
    const flush = () => {
      const text = cleanText(pending, currentStyle.preserve)
      pending = ''
      if (!text) return
      emitRun(page, matrix, text, localX, localY, currentStyle)
      const fontPt = Math.max(6, Math.min(240, currentStyle.fontSize * scaleY * PX))
      const tracking = Math.max(-20, Math.min(80, currentStyle.letterSpacing * scaleX * PX))
      const widthPt = textWidth(text, fontPt, boldOf(currentStyle.fontWeight), tracking) * (currentStyle.italic ? 1.08 : 1) + 2
      const widthLocal = widthPt / PX / scaleX
      if (currentStyle.anchor === 'end') localX -= widthLocal
      else if (currentStyle.anchor !== 'middle') localX += widthLocal
    }
    for (let i = 0; i < current.childNodes.length; i++) {
      const child = current.childNodes[i]
      if (!child) continue
      if (child.nodeType === 3) pending += child.textContent || ''
      else if (child.nodeType === 1 && localName(child) === 'tspan') {
        flush()
        localX = visit(child, inherit(child, currentStyle), localX, localY)
      }
    }
    flush()
    return localX
  }
  visit(node, style, num(node.getAttribute('x')), num(node.getAttribute('y')))
}

function isRtlText(text: string): boolean {
  let rtl = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x0590 && code <= 0x08ff) || (code >= 0xfb1d && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff)) rtl += 1
    else if (ch.trim()) other += 1
  }
  return rtl > 0 && rtl >= other
}

function cleanText(value: string, preserve: boolean): string {
  const text = preserve ? value.replace(/[\t\r\n]+/g, ' ') : value.replace(/\s+/g, ' ').trim()
  return text.replace(/\u00a0/g, ' ').trim()
}

function emitRun(page: PageBuilder, matrix: Matrix, text: string, x: number, y: number, style: Style): void {
  if (!text) return
  const scaleX = Math.hypot(matrix[0], matrix[1]) || 1
  const scaleY = Math.hypot(matrix[2], matrix[3]) || 1
  const bold = boldOf(style.fontWeight)
  const fontPt = Math.max(6, Math.min(240, style.fontSize * scaleY * PX))
  const tracking = Math.max(-20, Math.min(80, style.letterSpacing * scaleX * PX))
  const measured = textWidth(text, fontPt, bold, tracking)
  const rtl = isRtlText(text)
  const widthPt = measured * (style.italic ? 1.08 : 1) + 2
  const heightPt = fontPt * 1.15
  const ascent = containsCjk(text) ? ASCENT_CJK : ASCENT_LATIN
  const widthLocal = widthPt / PX / scaleX
  const heightLocal = heightPt / PX / scaleY
  const topLocal = /middle|central/.test(style.baseline) ? -style.fontSize / 2 : /hanging|text-before-edge|text-top/.test(style.baseline) ? 0 : -ascent * style.fontSize
  const leftLocal = style.anchor === 'middle' ? -widthLocal / 2 : style.anchor === 'end' ? -widthLocal : 0
  const center = apply(matrix, x + leftLocal + widthLocal / 2, y + topLocal + heightLocal / 2)
  // LibreOffice places the baseline about 5px below the SVG em box. Lift the box so the ink matches.
  center.y -= 5
  const color = parseColor(style.fill === 'none' ? '#000000' : style.fill, style.opacity * style.fillOpacity) ?? '#111111'
  const angle = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI
  const rotated = Math.abs(angle) > 0.8 && !isAxisAligned(matrix)
  const font = fontOf(style.fontFamily, text, fontPt, bold, style.italic, tracking)
  font!.color = color
  font!.align = style.anchor === 'middle' ? 'center' : style.anchor === 'end' ? 'right' : 'left'
  if (rtl) font!.rtl = true
  const glyphs = Array.from(text).length
  page.add({
    id: page.id(),
    type: 'text',
    role: 'content',
    bounds: rbox({
      x: center.x * PX - widthPt / 2,
      y: center.y * PX - heightPt / 2,
      w: widthPt,
      h: heightPt,
    }),
    rotate: rotated ? round(angle) : undefined,
    text,
    textCapacity: { maxChars: Math.max(1, glyphs), maxLines: 1 },
    font,
    shadow: shadowOf(page, style),
  })
}

function emitShape(node: Xml, page: PageBuilder, matrix: Matrix, style: Style): void {
  const name = localName(node)
  const role = node.getAttribute('data-pptx-role') || ''
  if (name === 'rect') {
    const box = transformedBox(matrix, num(node.getAttribute('x')), num(node.getAttribute('y')), num(node.getAttribute('width')), num(node.getAttribute('height')))
    const id = node.getAttribute('id') || ''
    if (role === 'background' || /background|(^|-)bg($|-)/i.test(id)) {
      const paint = paintOf(page, style, box)
      const covers = box.w >= page.canvas.w * 0.9 && box.h >= page.canvas.h * 0.9
      if (covers && paint.fill && !paint.gradient && !paint.pattern) {
        page.background = paint.fill.slice(0, 7)
        return
      }
      if (covers && paint.fill) page.background = (paint.pattern?.background ?? paint.gradient?.stops.at(-1)?.color ?? paint.fill).slice(0, 7)
    }
  }
  const arrow = markerArrow(node)
  if (name === 'line') {
    const start = apply(matrix, num(node.getAttribute('x1')), num(node.getAttribute('y1')))
    const end = apply(matrix, num(node.getAttribute('x2')), num(node.getAttribute('y2')))
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const stroke = strokeOf(style) ?? { color: '#111111', width: Math.max(0.5, style.strokeWidth * PX) }
    page.add({
      id: page.id(),
      type: 'shape',
      shape: 'line',
      role: 'decoration',
      bounds: toPt({ x, y, w: Math.max(Math.abs(end.x - start.x), 0.8), h: Math.max(Math.abs(end.y - start.y), 0.8) }),
      line: { ...stroke, points: { x1: (start.x - x) * PX, y1: (start.y - y) * PX, x2: (end.x - x) * PX, y2: (end.y - y) * PX } },
      arrow,
    })
    return
  }
  if ((name === 'rect' || name === 'circle' || name === 'ellipse') && isAxisAligned(matrix)) {
    const box = name === 'rect'
      ? transformedBox(matrix, num(node.getAttribute('x')), num(node.getAttribute('y')), num(node.getAttribute('width')), num(node.getAttribute('height')))
      : name === 'circle'
        ? transformedBox(matrix, num(node.getAttribute('cx')) - num(node.getAttribute('r')), num(node.getAttribute('cy')) - num(node.getAttribute('r')), num(node.getAttribute('r')) * 2, num(node.getAttribute('r')) * 2)
        : transformedBox(matrix, num(node.getAttribute('cx')) - num(node.getAttribute('rx')), num(node.getAttribute('cy')) - num(node.getAttribute('ry')), num(node.getAttribute('rx')) * 2, num(node.getAttribute('ry')) * 2)
    const paint = paintOf(page, style, box)
    const line = strokeOf(style)
    if (!paint.fill && !paint.gradient && !paint.pattern && !line) return
    const radius = name === 'rect' ? num(node.getAttribute('rx') || node.getAttribute('ry')) * Math.abs(matrix[0]) * PX : undefined
    page.add({
      id: page.id(),
      type: 'shape',
      shape: name === 'rect' ? (radius && radius > 0.4 ? 'roundRect' : 'rect') : 'ellipse',
      role: 'decoration',
      bounds: toPt(box),
      fill: paint.fill ?? (line ? '#00000000' : '#000000'),
      gradient: paint.gradient,
      pattern: paint.pattern,
      line,
      radius: radius && radius > 0.4 ? round(radius) : undefined,
      shadow: shadowOf(page, style),
    })
    return
  }
  const d = pathData(node)
  if (!d) return
  const commands = transformCommands(parseSvgPath(d), matrix)
  const stroke = strokeOf(style)
  const bounds = commandBounds(commands, stroke ? stroke.width / PX / 2 : 0)
  if (!bounds) return
  const local = localizeCommands(commands, bounds.x, bounds.y)
  const paint = paintOf(page, style, bounds)
  if (!paint.fill && !paint.gradient && !paint.pattern && !stroke) return
  const rule = (node.getAttribute('fill-rule') || styleMap(node)['fill-rule']) === 'evenodd' ? 'evenodd' as const : undefined
  page.add({
    id: page.id(),
    type: 'shape',
    shape: 'path',
    role: 'decoration',
    bounds: toPt(bounds),
    path: commandsToPath(scaleCommands(local, PX)),
    pathRule: rule,
    fill: paint.fill ?? (stroke ? '#00000000' : '#000000'),
    gradient: paint.gradient,
    pattern: paint.pattern,
    line: stroke,
    shadow: shadowOf(page, style),
  })
}

function scaleCommands(commands: ReturnType<typeof parseSvgPath>, scale: number): ReturnType<typeof parseSvgPath> {
  return commands.map(command => {
    if (command.op === 'Z') return command
    if (command.op === 'C') {
      return { op: 'C', x1: command.x1 * scale, y1: command.y1 * scale, x2: command.x2 * scale, y2: command.y2 * scale, x: command.x * scale, y: command.y * scale }
    }
    return { op: command.op, x: command.x * scale, y: command.y * scale }
  })
}

function pathData(node: Xml): string | null {
  const name = localName(node)
  if (name === 'path') return node.getAttribute('d')
  if (name === 'rect') {
    const x = num(node.getAttribute('x'))
    const y = num(node.getAttribute('y'))
    const w = num(node.getAttribute('width'))
    const h = num(node.getAttribute('height'))
    const rx = num(node.getAttribute('rx') || node.getAttribute('ry'))
    const ry = num(node.getAttribute('ry') || node.getAttribute('rx'))
    if (rx <= 0 || ry <= 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
    const radiusX = Math.min(rx, w / 2)
    const radiusY = Math.min(ry, h / 2)
    return `M ${x + radiusX} ${y} H ${x + w - radiusX} A ${radiusX} ${radiusY} 0 0 1 ${x + w} ${y + radiusY} V ${y + h - radiusY} A ${radiusX} ${radiusY} 0 0 1 ${x + w - radiusX} ${y + h} H ${x + radiusX} A ${radiusX} ${radiusY} 0 0 1 ${x} ${y + h - radiusY} V ${y + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${x + radiusX} ${y} Z`
  }
  if (name === 'circle' || name === 'ellipse') {
    const cx = num(node.getAttribute('cx'))
    const cy = num(node.getAttribute('cy'))
    const rx = name === 'circle' ? num(node.getAttribute('r')) : num(node.getAttribute('rx'))
    const ry = name === 'circle' ? rx : num(node.getAttribute('ry'))
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
  }
  if (name === 'polygon' || name === 'polyline') {
    const points = (node.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
    if (points.length < 4) return null
    let d = `M ${points[0]} ${points[1]}`
    for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`
    if (name === 'polygon') d += ' Z'
    return d
  }
  return null
}

function markerArrow(node: Xml): DeckElement['arrow'] | undefined {
  const end = node.getAttribute('marker-end')
  const start = node.getAttribute('marker-start')
  if (start && end) return 'both'
  if (end) return 'end'
  if (start) return 'start'
  return undefined
}

async function emitImage(node: Xml, page: PageBuilder, matrix: Matrix, clip: Clip): Promise<void> {
  const href = attr(node, 'href')
  const bytes = decodeHref(href, page.svgDir)
  if (!bytes) {
    page.gap('image')
    return
  }
  const x = num(node.getAttribute('x'))
  const y = num(node.getAttribute('y'))
  const w = num(node.getAttribute('width'))
  const h = num(node.getAttribute('height'))
  if (w <= 0 || h <= 0) return
  const dest = transformedBox(matrix, x, y, w, h)
  let oriented: Buffer
  let meta: { width?: number; height?: number; hasAlpha?: boolean }
  try {
    oriented = await sharp(bytes, { failOn: 'none' }).rotate().toBuffer()
    meta = await sharp(oriented).metadata()
  } catch {
    page.gap('image')
    return
  }
  const imageW = meta.width || 1
  const imageH = meta.height || 1
  const align = preserveOf(node.getAttribute('preserveAspectRatio'))
  const content = contentBox(dest, imageW, imageH, align)
  const visible = intersect(content, dest)
  const clipped = visible ? intersect(visible, clip.rect) : null
  if (!clipped) return
  const crop = {
    left: clamp((clipped.x - content.x) / content.w, 0, 1),
    top: clamp((clipped.y - content.y) / content.h, 0, 1),
    right: clamp((clipped.x + clipped.w - content.x) / content.w, 0, 1),
    bottom: clamp((clipped.y + clipped.h - content.y) / content.h, 0, 1),
  }
  const circle = clip.circle && Math.abs(clip.circle.r * 2 - clipped.w) < clipped.w * 0.2
  const stored = await storeImage(oriented, imageW, imageH, crop, circle)
  if (!stored) {
    page.gap('image')
    return
  }
  page.add({
    id: page.id(),
    type: 'image',
    role: 'decoration',
    bounds: toPt(clipped),
    src: stored,
    alt: node.getAttribute('id') || '插图',
    fit: 'fill',
  })
}

function contentBox(dest: Box, imageW: number, imageH: number, align: Align): Box {
  if (align.none) return dest
  const scale = align.slice ? Math.max(dest.w / imageW, dest.h / imageH) : Math.min(dest.w / imageW, dest.h / imageH)
  const w = imageW * scale
  const h = imageH * scale
  return { x: dest.x + (dest.w - w) * align.x, y: dest.y + (dest.h - h) * align.y, w, h }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function decodeHref(href: string, svgDir: string): Buffer | null {
  const value = href.trim()
  if (!value) return null
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',')
    if (comma < 0) return null
    const body = value.slice(comma + 1)
    if (/;base64/i.test(value.slice(0, comma))) return Buffer.from(body, 'base64')
    try {
      return Buffer.from(decodeURIComponent(body))
    } catch {
      return Buffer.from(body)
    }
  }
  const file = join(svgDir, value.split('?')[0]!)
  if (existsSync(file)) return readFileSync(file)
  return null
}

async function storeImage(bytes: Buffer, imageW: number, imageH: number, crop: { left: number; top: number; right: number; bottom: number }, circle: boolean): Promise<string | null> {
  const key = createHash('sha1').update(bytes).update(JSON.stringify({ crop, circle })).digest('hex').slice(0, 16)
  const cached = assets.get(key)
  if (cached) return cached
  for (const ext of ['jpg', 'png']) {
    if (existsSync(join(ASSET_DIR, `${key}.${ext}`))) {
      const relative = `${ASSET_HREF}/${key}.${ext}`
      assets.set(key, relative)
      return relative
    }
  }
  const left = clamp(Math.floor(crop.left * imageW), 0, imageW - 1)
  const top = clamp(Math.floor(crop.top * imageH), 0, imageH - 1)
  const width = clamp(Math.ceil((crop.right - crop.left) * imageW), 1, imageW - left)
  const height = clamp(Math.ceil((crop.bottom - crop.top) * imageH), 1, imageH - top)
  let pipe = sharp(bytes).extract({ left, top, width, height })
  if (circle) {
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="#fff"/></svg>`)
    pipe = pipe.composite([{ input: mask, blend: 'dest-in' }])
  }
  const raw = await pipe.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = false
  for (let i = 3; i < raw.data.length; i += 4) {
    if (raw.data[i]! < 250) {
      transparent = true
      break
    }
  }
  const ext = transparent ? 'png' : 'jpg'
  const relative = `${ASSET_HREF}/${key}.${ext}`
  const target = join(ASSET_DIR, `${key}.${ext}`)
  if (!existsSync(target)) {
    const frame = sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } })
    const output = transparent
      ? await frame.png({ compressionLevel: 9 }).toBuffer()
      : await frame.flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toBuffer()
    mkdirSync(ASSET_DIR, { recursive: true })
    writeFileSync(target, output)
  }
  assets.set(key, relative)
  return relative
}

function themeFor(id: string, title: string, paper: string): Theme {
  return {
    id,
    name: title,
    margin: 28,
    colors: {
      ink: '#1A1A1A',
      paper: /^#[0-9A-Fa-f]{6}$/.test(paper) ? paper.toUpperCase() : '#FFFFFF',
      muted: '#5C5A55',
      accent: '#1D4ED8',
      line: '#D0D0D0',
      surface: '#F4F1EA',
      inverse: '#FFFFFF',
    },
    fonts: {
      cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
      latin: { mac: 'Arial', win: 'Arial', linux: 'Arial' },
    },
    type: {
      display: { min: 32, max: 84 },
      title: { min: 20, max: 36 },
      body: { min: 12, max: 18 },
      caption: { min: 10, max: 14 },
    },
    source: `ppt-master-examples ${id}, MIT, Copyright (c) 2025-2026 Hugo He`,
  }
}

function fitWindow(box: { x: number; y: number; w: number; h: number }, min: number, max: number, axis: 'x' | 'y', size: 'w' | 'h'): void {
  const start = box[axis]
  const end = start + box[size]
  if (end - start > max - min) {
    box[axis] = Math.max(start, min)
    box[size] = Math.min(end, max) - box[axis]
    return
  }
  if (box[axis] < min) box[axis] = min
  if (box[axis] + box[size] > max) box[axis] = max - box[size]
}

function repair(deck: Deck): void {
  const width = deck.canvas.width
  const height = deck.canvas.height
  for (const page of deck.pages) {
    for (const element of page.elements) {
      if (element.type === 'text' && element.text && element.font) {
        const bold = element.font.weight === 'bold'
        const tracking = element.font.tracking ?? 0
        const neededWidth = textWidth(element.text, element.font.size, bold, tracking)
        if (neededWidth > element.bounds.w + fitSlack(element.font.size)) {
          const grow = neededWidth + 2 - element.bounds.w
          if (element.font.align === 'center') element.bounds.x -= grow / 2
          if (element.font.align === 'right') element.bounds.x -= grow
          element.bounds.w += grow
        }
        const lines = wrapText(element.text, element.bounds.w, element.font.size, bold, tracking)
        const neededHeight = lines.length <= 1 ? element.font.size : element.font.size + (lines.length - 1) * element.font.size * (element.font.leading ?? 1.15)
        if (neededHeight > element.bounds.h) element.bounds.h = round(neededHeight)
        element.textCapacity = { maxChars: Math.max(1, Array.from(element.text).length, ...lines.map(line => Array.from(line).length)), maxLines: Math.max(1, lines.length) }
      }
      const box = element.bounds
      if (element.type === 'text') {
        fitWindow(box, -36, width + 36, 'x', 'w')
        fitWindow(box, -36, height + 36, 'y', 'h')
      }
      box.x = round(box.x)
      box.y = round(box.y)
      box.w = round(Math.max(0.5, box.w))
      box.h = round(Math.max(0.5, box.h))
    }
  }
}

function categoryOf(project: Project): '商务' | '咨询' | '学术' | '教学' | '技术' | '创意' | '社媒' {
  const blob = `${project.id} ${project.styleName}`
  if (/^(xiaohongshu|wechat|story_|moments_|banner_|custom_)/.test(project.id)) return '社媒'
  if (/academic|attention|lora|researchstudio/i.test(blob)) return '学术'
  if (/consulting|investor|decision|solution proposal/i.test(project.styleName)) return '咨询'
  if (/creative pitch|glassmorphism|memphis|zine|brutal|photo editorial/i.test(project.styleName) || project.style === 'culture' || project.style === 'design') return '创意'
  if (project.style === 'education' || /duty manual|workshop|training|lecture|science|classroom|handout/i.test(project.styleName)) return '教学'
  if (project.style === 'technology') return '技术'
  if (project.style === 'business' || project.style === 'data') return '商务'
  return '创意'
}

function canvasLabel(width: number, height: number): string {
  const presets: Array<[number, number, string]> = [
    [960, 540, '16:9'],
    [768, 576, '4:3'],
    [810, 810, '1:1'],
    [810, 1440, '9:16'],
    [931.5, 1245, '3:4'],
    [930, 1315.5, 'A4'],
  ]
  for (const [presetW, presetH, label] of presets) {
    if (Math.abs(width - presetW) < 0.6 && Math.abs(height - presetH) < 0.6) return label
  }
  return `${Math.round(width / PX)}×${Math.round(height / PX)}`
}

function creditsOf(dir: string): string {
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) return '见该示例 README。'
  const lines = readFileSync(readme, 'utf8').split(/\r?\n/).filter(line => line.startsWith('- '))
  const picked = lines.filter(line => /wikimedia|public domain|公有|AI |image|来源|Source|scan|photo|JPEG|prompt/i.test(line)).slice(0, 4)
  const text = (picked.length > 0 ? picked : lines.slice(0, 2)).join(' ').replace(/\s+/g, ' ')
  return text.slice(0, 700)
}

function designDoc(project: Project, canvas: string, credits: string, dir: string): string {
  const spec = existsSync(join(dir, 'design_spec.md')) ? readFileSync(join(dir, 'design_spec.md'), 'utf8') : ''
  const lock = existsSync(join(dir, 'spec_lock.md')) ? readFileSync(join(dir, 'spec_lock.md'), 'utf8') : ''
  return [
    `# ${project.title}`,
    '',
    `- 来源示例：\`${project.id}\`（ppt-master-examples，MIT，Copyright (c) 2025-2026 Hugo He）`,
    `- 画布：${canvas}`,
    `- 分类：${categoryOf(project)}`,
    `- 上游风格名：${project.styleName}`,
    `- 图片与素材：${credits}`,
    '',
    '页面由 `svg_final` 转入 selection-deck。图表在能表达为柱、条、折线、饼、环、瀑布时用原生图表，其余图形保持形状。',
    '',
    spec ? `## design_spec\n\n${spec.trim()}\n` : '',
    lock ? `## spec_lock\n\n${lock.trim()}\n` : '',
  ].filter(Boolean).join('\n')
}

async function convertProject(project: Project): Promise<Converted> {
  const dir = join(exampleRoot, project.id)
  const svgDir = join(dir, 'svg_final')
  const files = project.slides.map(slide => slide.file).filter(file => existsSync(join(svgDir, file)))
  const first = readFileSync(join(svgDir, files[0]!), 'utf8')
  const viewMatch = first.match(/viewBox="([^"]+)"/)
  const parts = (viewMatch?.[1] ?? '0 0 1280 720').split(/[\s,]+/).map(Number)
  const canvas = { x: 0, y: 0, w: (parts[2] ?? 1280) * PX, h: (parts[3] ?? 720) * PX }
  const pages: DeckPage[] = []
  const gaps: Record<string, number> = {}
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!
    const stem = file.replace(/\.svg$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
    const built = await convertPage(join(svgDir, file), canvas)
    for (const [key, value] of Object.entries(built.gaps)) gaps[key] = (gaps[key] ?? 0) + value
    pages.push({
      id: `${index + 1}-${stem}`,
      layout: `${index + 1}-${stem}`,
      name: project.slides[index]?.desc || project.slides[index]?.title || stem,
      background: /^#[0-9A-Fa-f]{6}$/.test(built.background) ? built.background.toUpperCase() : '#FFFFFF',
      elements: built.elements,
    })
  }
  const deck: Deck = {
    format: 'selection-deck',
    version: 1,
    title: project.title,
    canvas: { width: round(canvas.w), height: round(canvas.h) },
    theme: themeFor(project.id, project.title, pages[0]?.background ?? '#FFFFFF'),
    pages,
    profile: 'example',
  }
  repair(deck)
  const parsed = parseDeckDocument(JSON.parse(JSON.stringify(deck)))
  const issues = parsed.issues.map(item => `${item.code}: ${item.message}`)
  const checked = parsed.deck ? checkDeck(parsed.deck) : []
  const outDir = join(SKILL, 'styles/examples', project.id)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'deck.json'), JSON.stringify(parsed.deck ?? deck))
  const credits = creditsOf(dir)
  writeFileSync(join(outDir, 'design.md'), designDoc(project, canvasLabel(canvas.w, canvas.h), credits, dir))
  return {
    id: project.id,
    title: project.title,
    styleName: project.styleName,
    category: categoryOf(project),
    canvas: canvasLabel(canvas.w, canvas.h),
    pages: pages.length,
    credits,
    issues: [...issues, ...checked.map(item => `${item.pageId ?? ''} ${item.code}: ${item.message}`)].slice(0, 12),
    gaps,
  }
}

function rewriteStyles(projects: Project[], converted: Converted[]): void {
  const catalogPath = join(SKILL, 'styles/catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, Record<string, unknown>>
  const next: Record<string, Record<string, unknown>> = {}
  for (const [id, entry] of Object.entries(catalog)) {
    if (id.startsWith('dsh-')) next[id] = entry
  }
  for (const link of STYLE_LINKS) {
    const previous = catalog[link.id] ?? {}
    const matches = projects.filter(project => link.test(project.styleName))
    const included = matches.filter(project => converted.some(item => item.id === project.id))
    const excluded = matches.filter(project => EXCLUSIONS[project.id])
    const entry: Record<string, unknown> = {
      name: previous.name,
      design: `styles/${link.id}/design.md`,
      when: previous.when,
      source: previous.source,
      license: 'MIT',
    }
    if (included.length > 0) {
      entry.deck = `styles/examples/${included[0]!.id}/deck.json`
      entry.examples = included.map(project => project.id)
      entry.canvas = converted.find(item => item.id === included[0]!.id)?.canvas
    }
    if (excluded.length > 0 && included.length === 0) {
      entry.excludedExample = excluded[0]!.id
      entry.reason = EXCLUSIONS[excluded[0]!.id]
    }
    next[link.id] = entry
    const designPath = join(SKILL, 'styles', link.id, 'design.md')
    const current = readFileSync(designPath, 'utf8')
    const marker = '下面是上游说明原文。'
    const rest = current.includes(marker) ? current.slice(current.indexOf(marker)) : current
    const preface = included.length > 0
      ? [
        `# ${previous.name}`,
        '',
        `参考页改为 ppt-master-examples 的成稿，不再使用原先那套 12 页线框。主示例是 \`${included[0]!.id}\`（${included[0]!.title}）。许可：MIT，Copyright (c) 2025-2026 Hugo He。`,
        included.length > 1 ? `同风格还有：${included.slice(1).map(project => `\`${project.id}\``).join('、')}。` : '',
        '',
      ].filter(Boolean).join('\n')
      : [
        `# ${previous.name}`,
        '',
        `这个风格在示例库里的成稿是 \`${excluded[0]?.id ?? '（无）'}\`。该稿依赖第三方品牌或官方机构标识，没有转入参考页。原因：${EXCLUSIONS[excluded[0]?.id ?? ''] ?? '见排除名单。'}`,
        '风格说明仍保留，供以后用自己的内容重做。许可：MIT，Copyright (c) 2025-2026 Hugo He。',
        '',
      ].join('\n')
    writeFileSync(designPath, `${preface}\n${rest.startsWith(marker) ? rest : `${marker}\n\n${rest}`}`)
    rmSync(join(SKILL, 'styles', link.id, 'deck.json'), { force: true })
  }
  for (const item of converted) {
    next[item.id] = {
      name: item.title,
      title: item.title,
      design: `styles/examples/${item.id}/design.md`,
      deck: `styles/examples/${item.id}/deck.json`,
      category: item.category,
      canvas: item.canvas,
      sourceExample: item.id,
      styleName: item.styleName,
      license: 'MIT',
      credits: item.credits,
      source: `ppt-master-examples ${item.id}, MIT, Copyright (c) 2025-2026 Hugo He`,
    }
  }
  for (const [id, reason] of Object.entries(EXCLUSIONS)) {
    const project = projects.find(item => item.id === id)
    next[id] = {
      name: project?.title ?? id,
      title: project?.title ?? id,
      excluded: true,
      reason,
      category: project ? categoryOf(project) : '商务',
      sourceExample: id,
      styleName: project?.styleName,
      license: 'MIT',
      source: `ppt-master-examples ${id} 未转入。${reason}`,
    }
  }
  writeFileSync(catalogPath, `${JSON.stringify(next, null, 2)}\n`)
}

function writeCredits(projects: Project[], converted: Converted[]): void {
  const lines = [
    '# ppt-master-examples',
    '',
    '来源：<https://github.com/hugohe3/ppt-master-examples>，MIT，Copyright (c) 2025-2026 Hugo He。',
    '下面每条是该示例 README 里写明的图片或素材说明。',
    '',
  ]
  for (const project of projects) {
    const item = converted.find(entry => entry.id === project.id)
    if (item) lines.push(`- \`${project.id}\` ${project.title}：${item.credits}`)
    else lines.push(`- \`${project.id}\`（未转入）${EXCLUSIONS[project.id] ?? ''}`)
  }
  writeFileSync(join(SKILL, 'styles/examples/CREDITS.md'), `${lines.join('\n')}\n`)
}

const index = JSON.parse(readFileSync(join(exampleRoot, 'examples.json'), 'utf8')) as { projects: Project[] }
const projects = index.projects.filter(project => !only || only.has(project.id))
const converted: Converted[] = []
mkdirSync(ASSET_DIR, { recursive: true })
for (const project of projects) {
  if (EXCLUSIONS[project.id]) {
    console.log(`skip ${project.id}`)
    continue
  }
  if (!existsSync(join(exampleRoot, project.id, 'svg_final'))) {
    console.log(`missing ${project.id}`)
    continue
  }
  const result = await convertProject(project)
  converted.push(result)
  console.log(`${result.id} ${result.pages}p ${result.canvas} issues=${result.issues.length} gaps=${JSON.stringify(result.gaps)}`)
  if (result.issues.length > 0) console.log(result.issues.slice(0, 4).join('\n'))
}
if (!only) {
  rewriteStyles(index.projects, converted)
  writeCredits(index.projects, converted)
  writeFileSync(join(SKILL, 'styles/examples/manifest.json'), JSON.stringify({
    converted: converted.length,
    excluded: Object.entries(EXCLUSIONS).map(([id, reason]) => ({ id, reason })),
    decks: converted,
  }, null, 2))
}
console.log(`converted ${converted.length}`)
