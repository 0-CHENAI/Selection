/**
 * Convert DSH Desktop PPTD template packs into selection-deck pages.
 *
 * The converter reads generated `.page` / `.pptd` YAML and each pack's
 * `design.md`. It does not import DSH's ppt-runtime. Pass `--slug` more than
 * once to import a subset; omit it to import every pack under `--input`.
 *
 *   bun scripts/import-dsh-templates.ts \
 *     --input /tmp/dsh-templates \
 *     --out apps/electron/resources/skills/ppt-design/styles \
 *     --slug dsh-cartesian --reset-catalog
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { containsCjk, wrapText } from '../apps/electron/resources/skills/ppt-design/engine/metrics.ts'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check.ts'
import { parseDeckDocument } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import { CANVAS_HEIGHT, CANVAS_WIDTH, DECK_FORMAT, DECK_VERSION } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

type Json = Record<string, unknown>
type Face = { latin: string; mac: string; win: string; ea: string }

const ROUND_RECT_RADIUS = 28

export type PackInfo = {
  slug: string
  directory: string
  metadata: Json
}

export function listPacks(root: string): PackInfo[] {
  const found: PackInfo[] = []
  walk(root, directory => {
    const file = join(directory, 'metadata.json')
    try {
      if (!statSync(file).isFile()) return
    } catch {
      return
    }
    const metadata = JSON.parse(readFileSync(file, 'utf8')) as Json
    const definition = asObject(metadata.definition)
    const slug = stringOf(definition.slug) || directory.split('/').pop() || ''
    if (!slug) return
    found.push({ slug, directory, metadata })
  })
  return found.sort((a, b) => a.slug.localeCompare(b.slug))
}

export function convertPack(pack: PackInfo, language: 'zh' | 'en'): Json {
  const sourceName = language === 'zh' ? 'source-zh' : 'source'
  const sourceDir = join(pack.directory, sourceName)
  const deckDoc = loadYaml(join(sourceDir, 'deck.pptd'))
  const pageFiles = readdirSync(join(sourceDir, 'pages')).filter(name => name.endsWith('.page')).sort()
  const pages = pageFiles.map(name => loadYaml(join(sourceDir, 'pages', name)))
  const definition = asObject(pack.metadata.definition)
  const palette = normalizePalette(asObject(definition.palette))
  const themeColors = mergeThemeColors(palette, asObject(asObject(deckDoc.theme).colors))
  const textStyles = asObject(asObject(deckDoc.theme).textStyles)
  const tableStyles = asObject(asObject(deckDoc.theme).tableStyles)
  const faces = collectFaces(pages, textStyles)
  const themeFace = majorityFace(faces) ?? {
    latin: 'Arial',
    mac: 'PingFang SC',
    win: 'Microsoft YaHei',
    ea: 'Noto Sans CJK SC',
  }
  const colorOf = makeColorOf(themeColors)
  const elementsByPage = pages.map(page => flatten(asArray(page.elements)).map(element => convertElement(element, colorOf, textStyles, tableStyles)))
  const sizes = elementsByPage.flat().flatMap(element => element.type === 'text' && isObject(element.font) && typeof element.font.size === 'number' ? [element.font.size] : [])
  const definitionName = stringOf(definition.name) || pack.slug
  const localized = asObject(definition.localizedNames)
  const title = language === 'zh'
    ? stringOf(localized.zh) || stringOf(definition.description) || definitionName
    : stringOf(localized.en) || definitionName
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title,
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    theme: {
      id: pack.slug,
      name: displayName(definition, definitionName),
      margin: 48,
      source: sourceLine(pack.metadata, definition),
      colors: themeColors,
      fonts: {
        cjk: { mac: themeFace.mac, win: themeFace.win, linux: themeFace.ea },
        latin: { mac: themeFace.latin, win: themeFace.latin, linux: themeFace.latin },
      },
      type: typeScale(sizes),
    },
    pages: pages.map((page, index) => {
      const pageType = stringOf(page.pageType) || 'page'
      const stem = pageFiles[index]!.replace(/\.page$/, '')
      const elements = elementsByPage[index]!.filter(element => element !== null)
      const seen = new Set<string>()
      for (const element of elements) {
        let id = stringOf(element.id) || `el-${seen.size + 1}`
        while (seen.has(id)) id = `${id}-2`
        seen.add(id)
        element.id = id
      }
      const headline = elements.find(element => element.type === 'text' && isObject(element.font) && typeof element.font.size === 'number' && element.font.size >= 20)
      return {
        id: stem,
        layout: `${stem}-${pageType}`,
        name: headline && typeof headline.text === 'string' ? headline.text.replace(/\s+/g, ' ').slice(0, 40) : pageType,
        background: colorOf(backgroundOf(page), 'paper'),
        elements,
        notes: typeof page.notes === 'string' ? page.notes : '',
      }
    }),
  }
}

function convertElement(element: Json, colorOf: (value: unknown, fallback: string) => string, textStyles: Json, tableStyles: Json): Json | null {
  const type = stringOf(element.elementType)
  const bounds = boundsOf(element.bounds)
  if (!bounds || !type) return null
  const id = stringOf(element.elementId) || 'el'
  const rotate = typeof element.rotation === 'number' && element.rotation !== 0 ? round(element.rotation) : undefined
  if (type === 'text') return convertText(element, id, bounds, rotate, colorOf, textStyles)
  if (type === 'line') return convertLine(element, id, bounds, colorOf)
  if (type === 'shape') return convertShape(element, id, bounds, rotate, colorOf)
  if (type === 'chart') return convertChart(element, id, bounds, colorOf)
  if (type === 'table') return convertTable(element, id, bounds, colorOf, tableStyles)
  if (type === 'image') return convertImagePlaceholder(element, id, bounds, colorOf)
  if (type === 'group') return null
  return null
}

function convertText(element: Json, id: string, bounds: Json, rotate: number | undefined, colorOf: (value: unknown, fallback: string) => string, textStyles: Json): Json | null {
  const content = resolvedContent(asObject(element.content), textStyles)
  const text = normalizeText(stringOf(content.text))
  if (!text.trim()) return null
  const face = faceOf(content.fontFamily)
  const size = typeof content.fontSize === 'number' ? content.fontSize : 16
  const bold = content.bold === true
  const family = containsCjk(text) ? '$cjk' : '$latin'
  const align = alignOf(content.align)
  const leading = typeof content.lineHeight === 'number' ? content.lineHeight : undefined
  const tracking = typeof content.letterSpacing === 'number' ? content.letterSpacing : undefined
  const lines = wrapText(text, Number(bounds.w), size, bold, tracking ?? 0)
  return {
    id,
    type: 'text',
    role: 'content',
    bounds,
    rotate,
    text,
    textCapacity: {
      maxChars: Math.max(1, Array.from(text.replaceAll('\n', '')).length),
      maxLines: Math.max(1, lines.length),
    },
    font: {
      family,
      size,
      weight: bold ? 'bold' : 'regular',
      color: colorOf(content.color, 'ink'),
      align: align.align,
      valign: align.valign,
      leading,
      tracking,
      face: face
        ? { latin: face.latin, cjk: { mac: face.mac, win: face.win, linux: face.ea } }
        : undefined,
    },
  }
}

function convertLine(element: Json, id: string, bounds: Json, colorOf: (value: unknown, fallback: string) => string): Json {
  const border = asObject(element.border)
  const width = typeof border.width === 'number' ? border.width : 1
  const points = pointsOf(element.points)
  const length = points
    ? Math.hypot(points.x2 - points.x1, points.y2 - points.y1)
    : Math.max(Number(bounds.w), Number(bounds.h))
  const style = border.style === 'dash' ? 'dash' : border.style === 'dot' ? 'dot' : undefined
  return {
    id,
    type: 'shape',
    shape: 'line',
    role: width <= 0.75 || length < 20 ? 'decoration' : 'rule',
    bounds: positiveBounds(bounds),
    line: {
      color: colorOf(border.color, 'line'),
      width,
      style,
      points,
    },
    arrow: arrowOf(element.arrow),
  }
}

function convertShape(element: Json, id: string, bounds: Json, rotate: number | undefined, colorOf: (value: unknown, fallback: string) => string): Json {
  const shape = element.shapeName === 'ellipse' || element.shapeName === 'roundRect' || element.shapeName === 'rect' ? element.shapeName : 'rect'
  const fill = asObject(element.fill)
  const border = asObject(element.border)
  const width = typeof border.width === 'number' ? border.width : 0
  const color = colorOf(fill.color, 'surface')
  const transparent = color.length === 9 && color.toLowerCase().endsWith('00')
  const marker = Math.min(Number(bounds.w), Number(bounds.h)) <= 8
  return {
    id,
    type: 'shape',
    shape,
    role: transparent || marker ? 'decoration' : 'panel',
    bounds,
    rotate,
    fill: color,
    line: width > 0 ? { color: colorOf(border.color, 'line'), width, style: border.style === 'dash' ? 'dash' : border.style === 'dot' ? 'dot' : undefined } : undefined,
    radius: shape === 'roundRect' ? ROUND_RECT_RADIUS : undefined,
  }
}

function convertChart(element: Json, id: string, bounds: Json, colorOf: (value: unknown, fallback: string) => string): Json | null {
  const data = asObject(element.data)
  const cols = asArray(data.cols).map(item => String(item))
  const rows = asArray(data.rows).map(row => asArray(row))
  const seriesIn = asArray(element.series).map(asObject)
  if (cols.length === 0 || rows.length === 0 || seriesIn.length === 0) return null
  const first = seriesIn[0]!
  const encode = asObject(first.encode)
  const numeric = (key: unknown) => {
    const index = cols.indexOf(String(key ?? ''))
    return index >= 0 && typeof rows[0]?.[index] === 'number'
  }
  let kind = 'column'
  let categoryKey = encode.x ?? encode.category
  let valueKey = encode.y ?? encode.value
  if (first.type === 'pie') {
    kind = typeof first.innerRadius === 'number' && first.innerRadius > 0 ? 'doughnut' : 'pie'
    categoryKey = encode.category ?? encode.x
    valueKey = encode.value ?? encode.y
  } else if (first.type === 'line') {
    kind = 'line'
  } else if (numeric(encode.x) && !numeric(encode.y)) {
    kind = 'bar'
    categoryKey = encode.y
    valueKey = encode.x
  }
  const categoryIndex = cols.indexOf(String(categoryKey ?? ''))
  const valueIndex = cols.indexOf(String(valueKey ?? ''))
  if (categoryIndex < 0 || valueIndex < 0) return null
  const categories = rows.map(row => String(row[categoryIndex] ?? ''))
  const series = seriesIn.map(series => ({
    name: stringOf(series.name) || '系列',
    values: rows.map(row => typeof row[valueIndex] === 'number' ? row[valueIndex] : Number(row[valueIndex] ?? 0)),
  }))
  const valueAxis = asObject(kind === 'bar' ? element.xAxis : element.yAxis)
  const categoryAxis = asObject(kind === 'bar' ? element.yAxis : element.xAxis)
  const grid = valueAxis.gridLine === false ? 'none' : asObject(valueAxis.gridLine).style
  return {
    id,
    type: 'chart',
    role: 'content',
    bounds,
    chart: {
      kind,
      categories,
      series,
      colors: chartColors(first, colorOf),
      showValues: asObject(first.dataLabels).show === true,
      showLegend: asObject(element.legend).show === true,
      valMin: typeof valueAxis.min === 'number' ? valueAxis.min : undefined,
      valMax: typeof valueAxis.max === 'number' ? valueAxis.max : undefined,
      holeSize: typeof first.innerRadius === 'number' ? Math.round(first.innerRadius * 100) : undefined,
      lineWidth: typeof first.width === 'number' ? first.width : undefined,
      markerSize: typeof asObject(first.marker).size === 'number' ? asObject(first.marker).size : undefined,
      markerColor: asObject(first.marker).fill ? colorOf(asObject(first.marker).fill, 'accent') : undefined,
      grid: grid === 'dot' || grid === 'dash' || grid === 'none' || grid === 'solid' ? grid : undefined,
      catLabelSize: typeof asObject(categoryAxis.label).fontSize === 'number' ? asObject(categoryAxis.label).fontSize : undefined,
      valLabelSize: typeof asObject(valueAxis.label).fontSize === 'number' ? asObject(valueAxis.label).fontSize : undefined,
      catLabelColor: asObject(categoryAxis.label).color ? colorOf(asObject(categoryAxis.label).color, 'muted') : undefined,
      valLabelColor: asObject(valueAxis.label).color ? colorOf(asObject(valueAxis.label).color, 'muted') : undefined,
    },
  }
}

function convertTable(element: Json, id: string, bounds: Json, colorOf: (value: unknown, fallback: string) => string, tableStyles: Json): Json | null {
  const rowsIn = asArray(element.rows).map(row => asArray(row).map(asObject))
  if (rowsIn.length === 0) return null
  const style = asObject(tableStyles[String(element.style ?? '').replace(/^\$/, '')])
  const cellStyle = asObject(style.cellStyle)
  const headerStyle = asObject(style.firstRowStyle)
  const columnsIn = asArray(element.columnWidths).map(item => typeof item === 'number' ? item : 0)
  const columns = columnsIn.length === rowsIn[0]!.length ? columnsIn : rowsIn[0]!.map(() => 1 / rowsIn[0]!.length)
  const height = Number(bounds.h)
  const rowHeights = asArray(element.rowHeights).every(item => typeof item === 'number') && asArray(element.rowHeights).length === rowsIn.length
    ? asArray(element.rowHeights).map(item => round(Number(item) * height))
    : undefined
  const face = faceOf(cellStyle.fontFamily)
  const sample = rowsIn.flat().map(cell => stringOf(cell.text)).join('')
  return {
    id,
    type: 'table',
    role: 'content',
    bounds,
    table: {
      columns,
      rowHeights,
      rows: rowsIn.map(row => row.map(cell => ({ text: normalizeText(stringOf(cell.text)) }))),
      fontSize: typeof cellStyle.fontSize === 'number' ? cellStyle.fontSize : 12,
      fontFamily: containsCjk(sample) ? '$cjk' : '$latin',
      face: face ? { latin: face.latin, cjk: { mac: face.mac, win: face.win, linux: face.ea } } : undefined,
      color: colorOf(cellStyle.color, 'ink'),
      fill: colorOf(asObject(cellStyle.fill).color, 'paper'),
      border: {
        color: colorOf(asObject(cellStyle.border).color, 'line'),
        width: typeof asObject(cellStyle.border).width === 'number' ? asObject(cellStyle.border).width : 0.75,
      },
      header: {
        bold: headerStyle.bold !== false,
        color: headerStyle.color ? colorOf(headerStyle.color, 'inverse') : undefined,
        fill: asObject(headerStyle.fill).color ? colorOf(asObject(headerStyle.fill).color, 'ink') : undefined,
      },
    },
  }
}

function convertImagePlaceholder(element: Json, id: string, bounds: Json, colorOf: (value: unknown, fallback: string) => string): Json {
  return {
    id,
    type: 'shape',
    shape: 'rect',
    role: 'decoration',
    bounds,
    fill: colorOf(asObject(element.fill).color ?? '$surface', 'surface'),
    line: { color: '$line', width: 1, style: 'dash' },
  }
}

function chartColors(series: Json, colorOf: (value: unknown, fallback: string) => string): string[] | undefined {
  if (Array.isArray(series.fill)) return series.fill.map(color => colorOf(color, 'accent'))
  if (typeof series.fill === 'string') return [colorOf(series.fill, 'accent')]
  if (asObject(series.fill).color) return [colorOf(asObject(series.fill).color, 'accent')]
  if (series.lineColor) return [colorOf(series.lineColor, 'accent')]
  return undefined
}

function resolvedContent(content: Json, textStyles: Json): Json {
  const styleName = stringOf(content.style).replace(/^\$/, '')
  const style = styleName ? asObject(textStyles[styleName]) : {}
  return { ...style, ...Object.fromEntries(Object.entries(content).filter(([, value]) => value !== undefined)) }
}

function normalizeText(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '')
}

function alignOf(value: unknown): { align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom' } {
  const pair = Array.isArray(value) ? value : [value, 'top']
  const horizontal = pair[0] === 'center' || pair[0] === 'right' || pair[0] === 'left' ? pair[0] : undefined
  const vertical = pair[1] === 'middle' || pair[1] === 'bottom' || pair[1] === 'top' ? pair[1] : 'top'
  return { align: horizontal, valign: vertical }
}

function arrowOf(value: unknown): 'start' | 'end' | 'both' | undefined {
  if (!Array.isArray(value)) return undefined
  const start = typeof value[0] === 'string' && value[0] !== 'none'
  const end = typeof value[1] === 'string' && value[1] !== 'none'
  if (start && end) return 'both'
  if (start) return 'start'
  if (end) return 'end'
  return undefined
}

function pointsOf(value: unknown): { x1: number; y1: number; x2: number; y2: number } | undefined {
  const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return undefined
  const first = parts[0]!.split(',').map(Number)
  const last = parts[parts.length - 1]!.split(',').map(Number)
  if (first.length < 2 || last.length < 2 || first.some(item => !Number.isFinite(item)) || last.some(item => !Number.isFinite(item))) return undefined
  return { x1: round(first[0]!), y1: round(first[1]!), x2: round(last[0]!), y2: round(last[1]!) }
}

function boundsOf(value: unknown): Json | null {
  const box = asArray(value)
  if (box.length < 4 || box.some(item => typeof item !== 'number' || !Number.isFinite(item))) return null
  const bounds = { x: round(Number(box[0])), y: round(Number(box[1])), w: round(Number(box[2])), h: round(Number(box[3])) }
  if (bounds.w === 0) bounds.w = 0.25
  if (bounds.h === 0) bounds.h = 0.25
  return bounds
}

function positiveBounds(bounds: Json): Json {
  return {
    x: bounds.x,
    y: bounds.y,
    w: Number(bounds.w) > 0 ? bounds.w : 0.25,
    h: Number(bounds.h) > 0 ? bounds.h : 0.25,
  }
}

function backgroundOf(page: Json): unknown {
  const background = asObject(page.background)
  return background.color ?? page.background
}

function normalizePalette(palette: Json): Record<string, string> {
  const colors: Record<string, string> = {}
  const take = (key: string, ...sources: string[]) => {
    for (const source of sources) {
      const value = hexOf(palette[source])
      if (value) {
        colors[key] = value
        return
      }
    }
  }
  take('paper', 'background', 'paper')
  take('ink', 'text', 'ink', 'black')
  take('muted', 'muted', 'secondary', 'gray')
  take('accent', 'accent', 'red', 'yellow')
  take('surface', 'surface', 'wash', 'white')
  take('line', 'grid', 'rule', 'secondary', 'muted')
  take('inverse', 'white', 'inverse')
  if (!colors.paper) colors.paper = '#FFFFFF'
  if (!colors.ink) colors.ink = '#111111'
  if (!colors.muted) colors.muted = '#6E6D68'
  if (!colors.accent) colors.accent = colors.ink
  if (!colors.surface) colors.surface = colors.paper
  if (!colors.line) colors.line = colors.muted
  if (!colors.inverse) colors.inverse = luminance(colors.paper) < 0.4 ? colors.ink : '#FFFFFF'
  for (const [key, value] of Object.entries(palette)) {
    const hex = hexOf(value)
    if (hex && !(key in colors)) colors[key] = hex
  }
  return colors
}

function mergeThemeColors(palette: Record<string, string>, theme: Json): Record<string, string> {
  const colors = { ...palette }
  for (const [key, value] of Object.entries(theme)) {
    const hex = hexOf(value)
    if (hex && !(key in colors)) colors[key] = hex
  }
  return colors
}

function makeColorOf(colors: Record<string, string>): (value: unknown, fallback: string) => string {
  return (value, fallback) => {
    const raw = stringOf(value)
    if (!raw) return `$${fallback}`
    if (raw.startsWith('$')) {
      const token = raw.slice(1)
      return colors[token] ? raw : `$${fallback}`
    }
    const hex = hexOf(raw)
    if (!hex) return `$${fallback}`
    const six = hex.slice(0, 7)
    if (colors.muted === six) return '$muted'
    if (colors.ink === six) return '$ink'
    if (colors.paper === six) return '$paper'
    if (colors.accent === six) return '$accent'
    if (colors.line === six) return '$line'
    if (colors.surface === six) return '$surface'
    if (colors.inverse === six) return '$inverse'
    return hex
  }
}

function faceOf(value: unknown): Face | null {
  const font = asObject(value)
  const latin = stringOf(font.latin)
  const mac = stringOf(font.mac)
  const win = stringOf(font.win)
  const ea = stringOf(font.ea)
  if (!latin || !mac || !win || !ea) return null
  return { latin, mac, win, ea }
}

function collectFaces(pages: Json[], textStyles: Json): Face[] {
  const faces: Face[] = []
  for (const style of Object.values(textStyles)) {
    const face = faceOf(asObject(style).fontFamily)
    if (face) faces.push(face)
  }
  for (const page of pages) {
    for (const element of flatten(asArray(page.elements))) {
      const face = faceOf(asObject(element.content).fontFamily)
      if (face) faces.push(face)
    }
  }
  return faces
}

function majorityFace(faces: Face[]): Face | null {
  const counts = new Map<string, { face: Face; count: number }>()
  for (const face of faces) {
    const key = JSON.stringify(face)
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { face, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.face ?? null
}

function typeScale(sizes: number[]): Json {
  const bucket = (match: (size: number) => boolean, fallback: { min: number; max: number }) => {
    const hit = sizes.filter(match)
    if (hit.length === 0) return fallback
    return { min: Math.min(...hit), max: Math.max(...hit) }
  }
  return {
    display: bucket(size => size >= 40, { min: 44, max: 72 }),
    title: bucket(size => size >= 24 && size < 40, { min: 28, max: 36 }),
    body: bucket(size => size >= 15 && size < 24, { min: 16, max: 22 }),
    caption: bucket(size => size < 15, { min: 9, max: 14 }),
  }
}

function sourceLine(metadata: Json, definition: Json): string {
  const provenance = asObject(metadata.provenance)
  const kind = stringOf(provenance.kind)
  const upstream = stringOf(provenance.upstream)
  if (kind === 'mit-adaptation') return `DSH Desktop v0.2.21 adaptation of Zara Zhang (${stringOf(definition.slug) || 'template'}), MIT, ${upstream}`
  if (kind === 'apache-adaptation') return `DSH Desktop v0.2.21 adaptation of html-anything ${stringOf(provenance.sourceSkill)}, Apache-2.0, ${upstream}`
  if (kind === 'retained-native') return `DSH Desktop v0.2.21 retained native template, MIT, commit ${stringOf(provenance.commit)}`
  return 'DSH Desktop v0.2.21 original template, MIT, Copyright (c) 2026 DataElement'
}

export function catalogEntry(pack: PackInfo): Json {
  const definition = asObject(pack.metadata.definition)
  const provenance = asObject(pack.metadata.provenance)
  const heading = readFileSync(join(pack.directory, 'design.md'), 'utf8').split('\n').find(line => line.startsWith('# '))
  return {
    name: heading ? heading.replace(/^#\s+/, '').trim() : displayName(definition, pack.slug),
    design: `styles/${pack.slug}/design.md`,
    deck: `styles/${pack.slug}/deck.json`,
    deckEn: `styles/${pack.slug}/deck.en.json`,
    when: stringOf(definition.description) || stringOf(definition.name) || pack.slug,
    source: sourceLine(pack.metadata, definition),
    license: stringOf(provenance.license) || 'MIT',
  }
}

export function designDocument(pack: PackInfo): string {
  const original = readFileSync(join(pack.directory, 'design.md'), 'utf8').trim()
  return `# Selection 参考页

本目录由 DSH Desktop v0.2.21 的页面源转成 selection-deck。中文示例是 \`deck.json\`，英文示例是 \`deck.en.json\`。几何、颜色和示例文案保持源页面。字号可以小到参考页里的图示标签，不要再统一放大。下面是 DSH 的设计说明。许可见仓库 \`ATTRIBUTION.md\`。

---

${original}
`
}

function displayName(definition: Json, fallback: string): string {
  const localized = asObject(definition.localizedNames)
  const en = stringOf(localized.en) || stringOf(definition.name) || fallback
  const zh = stringOf(localized.zh)
  if (zh && zh !== en) return `${en} / ${zh}`
  return stringOf(definition.description) || en
}

function flatten(elements: unknown[]): Json[] {
  const flat: Json[] = []
  for (const entry of elements) {
    const element = asObject(entry)
    if (element.elementType === 'group') flat.push(...flatten(asArray(element.elements ?? element.children)))
    else flat.push(element)
  }
  return flat
}

function hexOf(value: unknown): string | null {
  const text = stringOf(value).replace(/^#/, '')
  if (/^[0-9A-Fa-f]{6}$/.test(text)) return `#${text.toUpperCase()}`
  if (/^[0-9A-Fa-f]{8}$/.test(text)) return `#${text.toUpperCase()}`
  return null
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function loadYaml(file: string): Json {
  return asObject(yaml.load(readFileSync(file, 'utf8')))
}

function walk(directory: string, visit: (directory: string) => void): void {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return
  }
  visit(directory)
  for (const entry of entries) {
    const path = join(directory, entry)
    try {
      if (statSync(path).isDirectory()) walk(path, visit)
    } catch {
      // Skip unreadable entries.
    }
  }
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)]))
}

function parseArgs(argv: string[]): { input: string; out: string; slugs: string[]; resetCatalog: boolean } {
  let input = ''
  let out = ''
  const slugs: string[] = []
  let resetCatalog = false
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--input') input = argv[++index] ?? ''
    else if (token === '--out') out = argv[++index] ?? ''
    else if (token === '--slug') slugs.push(argv[++index] ?? '')
    else if (token === '--reset-catalog') resetCatalog = true
    else throw new Error(`未知参数 ${token}`)
  }
  if (!input || !out) throw new Error('需要 --input 和 --out')
  return { input, out, slugs: slugs.filter(Boolean), resetCatalog }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const available = listPacks(args.input)
  const selected = args.slugs.length === 0
    ? available
    : args.slugs.map(slug => {
      const pack = available.find(item => item.slug === slug)
      if (!pack) throw new Error(`找不到模板 ${slug}。可选：${available.map(item => item.slug).join(', ')}`)
      return pack
    })
  const catalog: Json = args.resetCatalog ? {} : readCatalog(join(args.out, 'catalog.json'))
  for (const pack of selected) {
    const directory = join(args.out, pack.slug)
    mkdirSync(directory, { recursive: true })
    for (const language of ['zh', 'en'] as const) {
      const deck = stripUndefined(convertPack(pack, language))
      const parsed = parseDeckDocument(deck)
      if (!parsed.deck) {
        const preview = parsed.issues.slice(0, 20).map(item => `${item.pageId ?? ''} ${item.elementId ?? ''} ${item.message}`).join('\n')
        throw new Error(`${pack.slug} ${language} 无法通过 schema\n${preview}`)
      }
      const issues = checkDeck(parsed.deck)
      const counts = new Map<string, number>()
      for (const item of issues) counts.set(item.code, (counts.get(item.code) ?? 0) + 1)
      console.log(`${pack.slug} ${language}: ${parsed.deck.pages.length} pages, check ${issues.length} [${[...counts.entries()].map(([code, count]) => `${code}:${count}`).join(', ')}]`)
      if (issues.length > 0) {
        console.log(issues.slice(0, 12).map(item => `  ${item.code} ${item.pageId ?? ''} ${item.elementId ?? ''} ${item.message}`).join('\n'))
      }
      const file = language === 'zh' ? 'deck.json' : 'deck.en.json'
      writeFileSync(join(directory, file), `${JSON.stringify(deck, null, 2)}\n`)
    }
    writeFileSync(join(directory, 'design.md'), designDocument(pack))
    catalog[pack.slug] = catalogEntry(pack)
  }
  if (args.resetCatalog || args.slugs.length === 0) {
    const ordered: Json = {}
    for (const pack of selected) ordered[pack.slug] = catalog[pack.slug]
    writeFileSync(join(args.out, 'catalog.json'), `${JSON.stringify(ordered, null, 2)}\n`)
  } else {
    writeFileSync(join(args.out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  }
}

function readCatalog(file: string): Json {
  try {
    return asObject(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return {}
  }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
