import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { checkDeck } from './check.ts'
import { luminance } from './contrast.ts'
import { colorRef } from './schema.ts'
import { containsCjk, defaultLeading } from './metrics.ts'
import type { Deck, DeckElement, DeckIssue, PlatformName, ScreenshotResult } from './types.ts'
import { captureSlides } from './screenshot.ts'

const PT = 72

export function platformFromProcess(platform = process.platform): PlatformName {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return 'linux'
}

export function resolveFontFace(deck: Deck, family: '$cjk' | '$latin', platform: PlatformName): string {
  return deck.theme.fonts[family === '$cjk' ? 'cjk' : 'latin'][platform]
}

function inches(points: number): number {
  return points / PT
}

function hex(value: string): string {
  return value.replace('#', '').toUpperCase()
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
  pres.defineLayout({ name: 'SELECTION_16x9', width: inches(deck.canvas.width), height: inches(deck.canvas.height) })
  pres.layout = 'SELECTION_16x9'
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
  return Buffer.from(raw as Uint8Array)
}

function addElement(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement, platform: PlatformName, pageBackground: string): void {
  const x = inches(element.bounds.x)
  const y = inches(element.bounds.y)
  const w = inches(element.bounds.w)
  const h = inches(element.bounds.h)
  if (element.type === 'text' && element.text && element.font) {
    const bold = element.font.weight === 'bold'
    const leading = element.font.leading ?? defaultLeading(element.font.size)
    const face = resolveFontFace(deck, element.font.family, platform)
    slide.addText(element.text, {
      x, y, w, h,
      fontFace: face,
      fontSize: element.font.size,
      bold,
      color: hex(colorRef(element.font.color, deck.theme, '$ink')),
      align: element.font.align ?? 'left',
      valign: element.font.valign ?? 'top',
      margin: 0,
      wrap: true,
      fit: 'none',
      lineSpacing: element.font.size * leading,
      charSpacing: element.font.tracking,
      lang: containsCjk(element.text) || element.font.family === '$cjk' ? 'zh-CN' : 'en-US',
      objectName: element.id,
    })
    return
  }
  if (element.type === 'shape') {
    const fill = element.fill ? hex(colorRef(element.fill, deck.theme, '$surface')) : undefined
    const lineColor = element.line ? hex(colorRef(element.line.color, deck.theme, '$line')) : fill
    if (element.shape === 'line' || element.role === 'rule') {
      const vertical = element.bounds.h > element.bounds.w
      const color = lineColor ?? (fill ?? hex(colorRef('$line', deck.theme, '$ink')))
      slide.addShape(pres.ShapeType.line, {
        x: vertical ? x + w / 2 : x,
        y: vertical ? y : y + h / 2,
        w: vertical ? 0 : w,
        h: vertical ? h : 0,
        line: {
          color,
          width: element.line?.width ?? Math.max(vertical ? element.bounds.w : element.bounds.h, 0.75),
          endArrowType: !vertical && element.arrow === 'end' ? 'triangle' : 'none',
        },
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
      ? Math.min(0.5, element.radius / Math.min(element.bounds.w, element.bounds.h))
      : undefined
    slide.addShape(shape, {
      x, y, w, h,
      fill: fill ? { color: fill } : undefined,
      line: element.line
        ? { color: lineColor, width: element.line.width }
        : { color: fill ?? 'FFFFFF', width: 0 },
      rectRadius: radius,
      objectName: element.id,
    })
    return
  }
  if (element.type === 'image' && element.src) {
    const fitted = fitImage(element)
    slide.addImage({
      path: element.src,
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
  const size = element.src ? readImageSize(element.src) : null
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
    catAxisLabelColor: label,
    catAxisLabelFontFace: face,
    catAxisLabelFontSize: 11,
    valAxisLabelColor: label,
    valAxisLabelFontFace: face,
    valAxisLabelFontSize: 11,
    catAxisLineColor: grid,
    valAxisLineShow: false,
    valGridLine: { color: grid, size: 0.5, style: 'solid' as const },
    catGridLine: { style: 'none' as const },
    dataBorder: { pt: 0, color: background },
    chartColors: (chart.colors ?? ['$accent', '$ink']).map(color => hex(colorRef(color, deck.theme, '$accent'))),
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
    barGrouping: 'clustered',
    barGapWidthPct: 60,
    lineSize: 2.25,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 12,
    lineDataSymbolLineColor: ink,
    lineDataSymbolLineSize: 0,
    valAxisMinVal: chart.kind === 'pie' || chart.kind === 'doughnut' ? undefined : 0,
    holeSize: chart.kind === 'doughnut' ? 62 : undefined,
  })
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
