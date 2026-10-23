import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { checkDeck } from './check.ts'
import { luminance } from './contrast.ts'
import { colorRef } from './schema.ts'
import { containsCjk, defaultLeading } from './metrics.ts'
import { pathToDrawingPoints } from './svg-path.ts'
import type { Deck, DeckElement, DeckIssue, FontFace, GradientFill, PatternFill, PlatformName, ScreenshotResult } from './types.ts'
import { captureSlides } from './screenshot.ts'

const PT = 72

export function platformFromProcess(platform = process.platform): PlatformName {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return 'linux'
}

export function resolveFontFace(deck: Deck, family: '$cjk' | '$latin', platform: PlatformName, face?: FontFace): string {
  if (face) return family === '$cjk' ? face.cjk[platform] : face.latin
  return deck.theme.fonts[family === '$cjk' ? 'cjk' : 'latin'][platform]
}

function inches(points: number): number {
  return points / PT
}

function hex(value: string): string {
  return value.replace('#', '').slice(0, 6).toUpperCase()
}

function paint(value: string): { color: string; transparency?: number } {
  const raw = value.replace('#', '').toUpperCase()
  if (raw.length >= 8) {
    const alpha = Number.parseInt(raw.slice(6, 8), 16) / 255
    const transparency = Math.round((1 - alpha) * 100)
    return transparency > 0 ? { color: raw.slice(0, 6), transparency } : { color: raw.slice(0, 6) }
  }
  return { color: raw.slice(0, 6) }
}

export type ExportOptions = {
  platform?: PlatformName
  screenshotDir?: string
  officecli?: string
  /** When false, a failing check still returns issues and writes nothing. */
  enforceCheck?: boolean
}

export type ExportResult = {
  status: 'ok' | 'needs_revision'
  issues: DeckIssue[]
  pptx?: string
  screenshots?: ScreenshotResult
}

export async function exportDeck(deck: Deck, outFile: string, options: ExportOptions = {}): Promise<ExportResult> {
  const issues = options.enforceCheck === false ? [] : checkDeck(deck)
  if (issues.length > 0) return { status: 'needs_revision', issues }
  const platform = options.platform ?? platformFromProcess()
  const bytes = await buildPptx(deck, platform)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, bytes)
  const pptx = realpathSync(outFile)
  const screenshots = options.screenshotDir
    ? await captureSlides(pptx, options.screenshotDir, deck.pages.length, { officecli: options.officecli })
    : undefined
  return { status: 'ok', issues: [], pptx, screenshots }
}

async function buildPptx(deck: Deck, platform: PlatformName): Promise<Buffer> {
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'SELECTION', width: inches(deck.canvas.width), height: inches(deck.canvas.height) })
  pres.layout = 'SELECTION'
  pres.title = deck.title
  pres.author = 'Selection'
  pres.subject = deck.theme.name
  for (const page of deck.pages) {
    const slide = pres.addSlide()
    const pageBackground = colorRef(page.background, deck.theme, '$paper')
    slide.background = { color: hex(pageBackground) }
    for (const element of page.elements) addElement(pres, slide, deck, element, platform, pageBackground)
    if (page.notes) slide.addNotes(page.notes)
  }
  const raw = await pres.write({ outputType: 'nodebuffer' })
  return finishSlideXml(Buffer.from(raw as Uint8Array), deck, platform)
}

function addElement(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement, platform: PlatformName, pageBackground: string): void {
  const x = inches(element.bounds.x)
  const y = inches(element.bounds.y)
  const w = inches(element.bounds.w)
  const h = inches(element.bounds.h)
  if (element.type === 'text' && element.text && element.font) {
    const bold = element.font.weight === 'bold'
    const leading = element.font.leading ?? defaultLeading(element.font.size)
    const face = resolveFontFace(deck, element.font.family, platform, element.font.face)
    const ink = paint(colorRef(element.font.color, deck.theme, '$ink'))
    slide.addText(element.text, {
      x, y, w, h,
      fontFace: face,
      fontSize: element.font.size,
      bold,
      color: ink.color,
      transparency: ink.transparency,
      align: element.font.align ?? 'left',
      valign: element.font.valign ?? 'top',
      margin: 0,
      // SVG runs are one line. A box that only fits one line must not wrap the last word onto the next title.
      wrap: (element.textCapacity?.maxLines ?? 1) > 1,
      fit: 'none',
      italic: element.font.italic === true ? true : undefined,
      rtlMode: element.font.rtl === true ? true : undefined,
      rotate: element.rotate,
      shadow: shadowOptions(element),
      lineSpacing: element.font.size * leading,
      charSpacing: element.font.tracking,
      lang: containsCjk(element.text) || element.font.family === '$cjk' ? 'zh-CN' : 'en-US',
      objectName: element.id,
    })
    return
  }
  if (element.type === 'shape') {
    if (element.shape === 'line' || element.role === 'rule') {
      addLine(pres, slide, deck, element)
      return
    }
    const fill = shapeFill(deck, element)
    const line = element.line ? paint(colorRef(element.line.color, deck.theme, '$line')) : undefined
    if (fill && fill.transparency === 100 && !line && !element.gradient && !element.pattern) return
    const lineOptions = element.line && line
      ? { color: line.color, transparency: line.transparency, width: element.line.width, dashType: dashOf(element.line.style) }
      : { color: fill?.color ?? 'FFFFFF', width: 0 }
    const fillOptions = fill && fill.transparency !== 100 ? fill : { type: 'none' as const }
    if (element.shape === 'path' && element.path) {
      const points = pathToDrawingPoints(element.path)
      if (points.length === 0) return
      slide.addShape('custGeom' as typeof pres.ShapeType.rect, {
        x, y, w, h,
        points,
        rotate: element.rotate,
        fill: fillOptions,
        line: lineOptions,
        shadow: shadowOptions(element),
        objectName: element.id,
      })
      return
    }
    const shape = element.shape === 'ellipse'
      ? pres.ShapeType.ellipse
      : element.shape === 'roundRect'
        ? pres.ShapeType.roundRect
        : pres.ShapeType.rect
    const radius = element.radius && element.shape === 'roundRect'
      ? Math.min(element.radius, Math.min(element.bounds.w, element.bounds.h) / 2) / 72
      : undefined
    slide.addShape(shape, {
      x, y, w, h,
      rotate: element.rotate,
      fill: fillOptions,
      line: lineOptions,
      rectRadius: radius,
      shadow: shadowOptions(element),
      objectName: element.id,
    })
    return
  }
  if (element.type === 'table' && element.table) {
    addTable(pres, slide, deck, element, platform)
    return
  }
  if (element.type === 'image' && element.src) {
    const fitted = fitImage(element)
    slide.addImage({
      path: resolveAsset(element.src),
      x: inches(fitted.x),
      y: inches(fitted.y),
      w: inches(fitted.w),
      h: inches(fitted.h),
      altText: element.alt,
      objectName: element.id,
    })
    return
  }
  if (element.type === 'chart' && element.chart) addChart(pres, slide, deck, element, platform, pageBackground)
}

function fitImage(element: DeckElement): { x: number; y: number; w: number; h: number } {
  if (element.fit === 'fill') return element.bounds
  const size = element.src ? readImageSize(resolveAsset(element.src)) : null
  if (!size) return element.bounds
  const scale = Math.min(element.bounds.w / size.width, element.bounds.h / size.height)
  const w = size.width * scale
  const h = size.height * scale
  return {
    x: element.bounds.x + (element.bounds.w - w) / 2,
    y: element.bounds.y + (element.bounds.h - h) / 2,
    w, h,
  }
}

function readImageSize(file: string): { width: number; height: number } | null {
  try {
    const bytes = readFileSync(file)
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) break
        const marker = bytes[offset + 1]
        const length = bytes.readUInt16BE(offset + 2)
        if (marker !== undefined && marker >= 0xc0 && marker <= 0xc2) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
        }
        offset += 2 + length
      }
    }
  } catch {
    return null
  }
  return null
}

function dashOf(style: 'solid' | 'dash' | 'dot' | undefined): 'dash' | 'sysDot' | undefined {
  if (style === 'dash') return 'dash'
  if (style === 'dot') return 'sysDot'
  return undefined
}

function addLine(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement): void {
  const stroke = element.line ? paint(colorRef(element.line.color, deck.theme, '$line')) : paint(colorRef(element.fill ?? '$line', deck.theme, '$ink'))
  const points = element.line?.points
  let x1: number
  let y1: number
  let x2: number
  let y2: number
  if (points) {
    x1 = element.bounds.x + points.x1
    y1 = element.bounds.y + points.y1
    x2 = element.bounds.x + points.x2
    y2 = element.bounds.y + points.y2
  } else if (element.bounds.h > element.bounds.w) {
    x1 = element.bounds.x + element.bounds.w / 2
    x2 = x1
    y1 = element.bounds.y
    y2 = element.bounds.y + element.bounds.h
  } else {
    y1 = element.bounds.y + element.bounds.h / 2
    y2 = y1
    x1 = element.bounds.x
    x2 = element.bounds.x + element.bounds.w
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.max(Math.hypot(dx, dy), 0.01)
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const arrow = element.arrow
  slide.addShape(pres.ShapeType.line, {
    x: inches(cx - length / 2),
    y: inches(cy),
    w: inches(length),
    h: 0,
    rotate: Math.abs(angle) < 0.05 ? undefined : angle,
    line: {
      color: stroke.color,
      transparency: stroke.transparency,
      width: element.line?.width ?? Math.max(Math.min(element.bounds.w, element.bounds.h), 0.75),
      dashType: dashOf(element.line?.style),
      beginArrowType: arrow === 'start' || arrow === 'both' ? 'triangle' : undefined,
      endArrowType: arrow === 'end' || arrow === 'both' ? 'triangle' : undefined,
    },
    objectName: element.id,
  })
}

function addTable(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement, platform: PlatformName): void {
  const table = element.table!
  const face = resolveFontFace(deck, table.fontFamily, platform, table.face)
  const body = paint(colorRef(table.color, deck.theme, '$ink'))
  const fill = paint(colorRef(table.fill, deck.theme, '$paper'))
  const border = paint(colorRef(table.border.color, deck.theme, '$line'))
  const rowHeights = table.rowHeights ?? table.rows.map(() => element.bounds.h / table.rows.length)
  const rows = table.rows.map((row, rowIndex) => row.map(cell => {
    const header = rowIndex === 0 ? table.header : undefined
    const color = paint(colorRef(cell.color ?? header?.color ?? table.color, deck.theme, '$ink'))
    const cellFill = paint(colorRef(cell.fill ?? header?.fill ?? table.fill, deck.theme, '$paper'))
    return {
      text: cell.text,
      options: {
        bold: cell.bold ?? header?.bold ?? false,
        color: color.color,
        fill: { color: cellFill.color, transparency: cellFill.transparency },
        align: cell.align ?? 'left' as const,
        valign: 'middle' as const,
      },
    }
  }))
  slide.addTable(rows, {
    x: inches(element.bounds.x),
    y: inches(element.bounds.y),
    w: inches(element.bounds.w),
    h: inches(element.bounds.h),
    colW: table.columns.map(fraction => inches(fraction * element.bounds.w)),
    rowH: rowHeights.map(points => inches(points)),
    border: { pt: table.border.width, color: border.color },
    fontFace: face,
    fontSize: table.fontSize,
    color: body.color,
    fill: { color: fill.color },
    align: 'left',
    valign: 'middle',
    margin: 0.04,
    objectName: element.id,
  })
}

function addChart(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement, platform: PlatformName, pageBackground: string): void {
  const chart = element.chart!
  const background = hex(pageBackground)
  const ink = hex(colorRef('$ink', deck.theme, '#111111'))
  const muted = hex(colorRef('$muted', deck.theme, '#5C5A55'))
  const line = hex(colorRef('$line', deck.theme, '#D0D0D0'))
  const inverse = hex(colorRef('$inverse', deck.theme, '#FFFFFF'))
  const dark = luminance(pageBackground) < 0.4
  const label = dark ? inverse : muted
  const grid = dark ? '4A4A4A' : line
  const face = resolveFontFace(deck, '$cjk', platform)
  const base = {
    x: inches(element.bounds.x),
    y: inches(element.bounds.y),
    w: inches(element.bounds.w),
    h: inches(element.bounds.h),
    objectName: element.id,
    showTitle: false,
    showLegend: chart.showLegend ?? false,
    showValue: chart.showValues ?? false,
    chartArea: { fill: { color: background }, border: { pt: 0, color: background }, roundedCorners: false },
    plotArea: { fill: { color: background }, border: { pt: 0, color: background } },
    catAxisLabelColor: chart.catLabelColor ? hex(colorRef(chart.catLabelColor, deck.theme, label)) : label,
    catAxisLabelFontFace: face,
    catAxisLabelFontSize: chart.catLabelSize ?? 11,
    valAxisLabelColor: chart.valLabelColor ? hex(colorRef(chart.valLabelColor, deck.theme, label)) : label,
    valAxisLabelFontFace: face,
    valAxisLabelFontSize: chart.valLabelSize ?? 11,
    catAxisLineColor: grid,
    valAxisLineShow: false,
    valGridLine: { color: grid, size: 0.5, style: chart.grid ?? 'solid' },
    catGridLine: { style: 'none' as const },
    dataBorder: { pt: 0, color: background },
    chartColors: (chart.colors ?? ['$accent', '$ink']).map(color => hex(colorRef(color, deck.theme, '$accent'))),
    valAxisMinVal: chart.valMin,
    valAxisMaxVal: chart.valMax,
  }
  if (chart.kind === 'waterfall') {
    const parts = waterfallParts(chart.series[0]!.values)
    const colors = chart.colors ?? ['$paper', '$accent', '$ink']
    const waterfallColors = colors.map(color => hex(colorRef(color, deck.theme, '$paper')))
    waterfallColors[0] = background
    slide.addChart(pres.ChartType.bar, [
      { name: '基座', labels: chart.categories, values: parts.base },
      { name: '增加', labels: chart.categories, values: parts.up },
      { name: '减少', labels: chart.categories, values: parts.down },
    ], {
      ...base,
      barDir: 'col',
      barGrouping: 'stacked',
      barGapWidthPct: 50,
      showValue: false,
      showLegend: false,
      chartColors: waterfallColors,
      valAxisMinVal: 0,
    })
    return
  }
  const type = chart.kind === 'line'
    ? pres.ChartType.line
    : chart.kind === 'pie'
      ? pres.ChartType.pie
      : chart.kind === 'doughnut'
        ? pres.ChartType.doughnut
        : pres.ChartType.bar
  const data = chart.series.map(series => ({ name: series.name, labels: chart.categories, values: series.values }))
  slide.addChart(type, data, {
    ...base,
    barDir: chart.kind === 'bar' ? 'bar' : 'col',
    // PowerPoint draws the first bar category at the bottom. maxMin matches the SVG, which draws it at the top.
    // pptxgenjs 3.12 types only list minMax; the writer emits the string as given.
    ...(chart.kind === 'bar' ? { catAxisOrientation: 'maxMin' as 'minMax' } : {}),
    barGrouping: 'clustered',
    barGapWidthPct: 60,
    lineSize: chart.lineWidth ?? 2.25,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: chart.markerSize ?? (chart.kind === 'line' ? 8 : 12),
    lineDataSymbolLineColor: chart.markerColor ? hex(colorRef(chart.markerColor, deck.theme, ink)) : ink,
    lineDataSymbolLineSize: 0,
    valAxisMinVal: chart.kind === 'pie' || chart.kind === 'doughnut' ? undefined : (chart.valMin ?? 0),
    valAxisMaxVal: chart.kind === 'pie' || chart.kind === 'doughnut' ? undefined : chart.valMax,
    holeSize: chart.kind === 'doughnut' ? (chart.holeSize ?? 62) : undefined,
  })
}

function shapeFill(deck: Deck, element: DeckElement): { color: string; transparency?: number } | undefined {
  if (element.pattern) return paint(colorRef(element.pattern.background, deck.theme, '$paper'))
  if (element.gradient) {
    const stop = [...element.gradient.stops].reverse().find(item => !item.color.replace('#', '').slice(6, 8).match(/^00$/i)) ?? element.gradient.stops[0]
    if (!stop) return undefined
    const color = paint(colorRef(stop.color, deck.theme, '$surface'))
    return { color: color.color }
  }
  return element.fill ? paint(colorRef(element.fill, deck.theme, '$surface')) : undefined
}

function shadowOptions(element: DeckElement): { type: 'outer'; color: string; opacity: number; blur: number; offset: number; angle: number } | undefined {
  const shadow = element.shadow
  if (!shadow) return undefined
  const angle = ((shadow.angle ?? 45) % 360 + 360) % 360
  return {
    type: 'outer',
    color: shadow.color.replace('#', '').slice(0, 6),
    opacity: shadow.opacity ?? 0.45,
    blur: shadow.blur ?? 8,
    offset: shadow.offset ?? 4,
    angle,
  }
}

function resolveAsset(src: string): string {
  if (existsSync(src)) return src
  const fromCwd = join(process.cwd(), src)
  if (existsSync(fromCwd)) return fromCwd
  const skill = fileURLToPath(new URL('..', import.meta.url))
  const fromSkill = join(skill, src)
  if (existsSync(fromSkill)) return fromSkill
  return src
}

async function finishSlideXml(bytes: Buffer, deck: Deck, platform: PlatformName): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes)
  let changed = false
  for (let index = 0; index < deck.pages.length; index++) {
    const page = deck.pages[index]!
    const faces = new Map<string, { latin: string; ea: string }>()
    const fills = new Map<string, string>()
    const evenOdd = new Set<string>()
    for (const element of page.elements) {
      const face = element.font?.face ?? element.table?.face
      if (face) faces.set(element.id, { latin: face.latin, ea: face.cjk[platform] })
      const fill = fillOverride(element)
      if (fill) fills.set(element.id, fill)
      if (element.pathRule === 'evenodd') evenOdd.add(element.id)
    }
    if (faces.size === 0 && fills.size === 0 && evenOdd.size === 0) continue
    const path = `ppt/slides/slide${index + 1}.xml`
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    // `<p:sp` is also the prefix of `<p:spTree>`. Require the tag to end so the tree is left intact.
    const next = xml.replace(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g, block => rewriteShape(block, faces, fills, evenOdd))
    if (next !== xml) {
      zip.file(path, next)
      changed = true
    }
  }
  if (!changed) return bytes
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

function rewriteShape(block: string, faces: Map<string, { latin: string; ea: string }>, fills: Map<string, string>, evenOdd: Set<string>): string {
  const name = block.match(/<p:cNvPr[^>]*\sname="([^"]*)"/)
  if (!name) return block
  const id = name[1]!
  let next = block
  const face = faces.get(id)
  if (face) {
    const latin = escapeXml(face.latin)
    const ea = escapeXml(face.ea)
    next = next
      .replace(/(<a:latin[^>]*\stypeface=")[^"]*(")/g, `$1${latin}$2`)
      .replace(/(<a:ea[^>]*\stypeface=")[^"]*(")/g, `$1${ea}$2`)
      .replace(/(<a:cs[^>]*\stypeface=")[^"]*(")/g, `$1${latin}$2`)
  }
  const fill = fills.get(id)
  if (fill) next = replaceShapeFill(next, fill)
  if (evenOdd.has(id)) next = next.replace(/<a:path\b(?![^>]*\bfill=)/, '<a:path fill="evenOdd"')
  return next
}

function replaceShapeFill(block: string, fillXml: string): string {
  return block.replace(/<p:spPr>([\s\S]*?)<\/p:spPr>/, (_all, inner: string) => {
    // A zero-width line can carry its own solid fill. Leave that alone so a transparent pattern lands on the shape.
    const lineMatch = inner.match(/<a:ln\b[\s\S]*<\/a:ln>/)
    const line = lineMatch?.[0] ?? ''
    const body = line ? inner.replace(line, '') : inner
    let next = body
    if (body.includes('<a:solidFill>')) next = body.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, fillXml)
    else if (body.includes('<a:noFill/>')) next = body.replace('<a:noFill/>', fillXml)
    else next = `${body}${fillXml}`
    return `<p:spPr>${next}${line}</p:spPr>`
  })
}

function fillOverride(element: DeckElement): string | null {
  if (element.gradient) return gradientXml(element.gradient)
  if (element.pattern) return patternXml(element.pattern)
  return null
}

function gradientXml(gradient: GradientFill): string {
  const stops = gradient.stops.map(stop => {
    const raw = stop.color.replace('#', '').toUpperCase()
    const color = raw.slice(0, 6)
    const alpha = raw.length >= 8 ? Math.round((Number.parseInt(raw.slice(6, 8), 16) / 255) * 100000) : 100000
    return `<a:gs pos="${Math.round(Math.min(1, Math.max(0, stop.offset)) * 100000)}"><a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr></a:gs>`
  }).join('')
  if (gradient.kind === 'radial') {
    const cx = gradient.cx ?? 0.5
    const cy = gradient.cy ?? 0.5
    const l = Math.round(cx * 100000)
    const t = Math.round(cy * 100000)
    const r = Math.round((1 - cx) * 100000)
    const b = Math.round((1 - cy) * 100000)
    return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:path path="circle"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path></a:gradFill>`
  }
  const angle = ((gradient.angle ?? 0) % 360 + 360) % 360
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(angle * 60000)}" scaled="${gradient.absolute ? '0' : '1'}"/></a:gradFill>`
}

function patternColorXml(value: string): string {
  const raw = value.replace('#', '').toUpperCase()
  const color = raw.slice(0, 6)
  const alpha = raw.length >= 8 ? Math.round((Number.parseInt(raw.slice(6, 8), 16) / 255) * 100000) : 100000
  return `<a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr>`
}

function patternXml(pattern: PatternFill): string {
  return `<a:pattFill prst="${pattern.preset}"><a:fgClr>${patternColorXml(pattern.foreground)}</a:fgClr><a:bgClr>${patternColorXml(pattern.background)}</a:bgClr></a:pattFill>`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function waterfallParts(values: number[]): { base: number[]; up: number[]; down: number[] } {
  const base: number[] = []
  const up: number[] = []
  const down: number[] = []
  let running = values[0] ?? 0
  base.push(0)
  up.push(Math.max(0, running))
  down.push(0)
  for (let i = 1; i < values.length - 1; i++) {
    const delta = values[i] ?? 0
    if (delta >= 0) {
      base.push(running)
      up.push(delta)
      down.push(0)
      running += delta
    } else {
      running += delta
      base.push(running)
      up.push(0)
      down.push(-delta)
    }
  }
  base.push(0)
  up.push(Math.max(0, values[values.length - 1] ?? 0))
  down.push(0)
  return { base, up, down }
}
