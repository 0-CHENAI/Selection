import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { checkDeck } from './check.ts'
import { contrastRatio, luminance } from './contrast.ts'
import { colorRef } from './schema.ts'
import { containsCjk, defaultLeading } from './metrics.ts'
import { pathToDrawingPoints } from './svg-path.ts'
import { comboSeriesRoles, type ChartKind, type ChartSpec, type Deck, type DeckElement, type DeckIssue, type FontFace, type GradientFill, type PatternFill, type PlatformName, type ScreenshotResult } from './types.ts'
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

function themeChartPalette(deck: Deck, chart: ChartSpec, count: number): string[] {
  const tokens = chart.colors ?? ['accent', 'ink', 'signal', 'muted'].filter(name => deck.theme.colors[name]).map(name => `$${name}`)
  const resolved = (tokens.length ? tokens : ['$accent']).map(color => hex(colorRef(color, deck.theme, '$accent')))
  const width = Math.max(count, resolved.length, 1)
  return Array.from({ length: width }, (_, index) => resolved[index % resolved.length]!)
}

/** 960×540 defaults. Page titles stay outside the chart, at about 26pt. */
const CHART_CATEGORY_PT = 13
const CHART_TICK_PT = 11
const CHART_LEGEND_PT = 12
const CHART_VALUE_PT = 12

function addChart(pres: PptxGenJS, slide: PptxGenJS.Slide, deck: Deck, element: DeckElement, platform: PlatformName, pageBackground: string): void {
  const chart = element.chart!
  const kind = chart.kind
  const background = hex(pageBackground)
  const ink = hex(colorRef('$ink', deck.theme, '#111111'))
  const muted = hex(colorRef('$muted', deck.theme, '#5C5A55'))
  const inverse = hex(colorRef('$inverse', deck.theme, '#FFFFFF'))
  const face = resolveFontFace(deck, '$cjk', platform)
  const palette = themeChartPalette(deck, chart, Math.max(chart.series.length, chart.categories.length, 2))
  const on = chart.showValues !== false
  const numericAxis = kind === 'scatter' || kind === 'bubble'
  const legend = chart.showLegend ?? (chart.series.length > 1 && kind !== 'pie' && kind !== 'doughnut' && kind !== 'waterfall')
  const outside = readableOn(background, ink, inverse)
  const ticks = contrastRatio(muted, background) >= 3 ? muted : outside
  const categoryColor = chart.catLabelColor
    ? hex(colorRef(chart.catLabelColor, deck.theme, outside))
    : (numericAxis ? ticks : outside)
  const tickColor = chart.valLabelColor ? hex(colorRef(chart.valLabelColor, deck.theme, ticks)) : ticks
  const axis = quietColor(ink, background, 0.72)
  const gridTint = quietColor(ink, background, 0.86)
  const themedGrid = (fallback: 'none' | 'solid') => {
    const style = chart.grid ?? fallback
    if (style === 'none') return { style: 'none' as const }
    return { color: gridTint, size: 0.75, style }
  }
  const base = {
    x: inches(element.bounds.x),
    y: inches(element.bounds.y),
    w: inches(element.bounds.w),
    h: inches(element.bounds.h),
    objectName: element.id,
    showTitle: false,
    showLegend: legend,
    showValue: false,
    chartArea: { fill: { color: background }, border: { pt: 0, color: background }, roundedCorners: false },
    plotArea: { fill: { color: background }, border: { pt: 0, color: background } },
    layout: chartLayout(kind, legend),
    catAxisLabelColor: categoryColor,
    catAxisLabelFontFace: face,
    catAxisLabelFontSize: chart.catLabelSize ?? (numericAxis ? CHART_TICK_PT : CHART_CATEGORY_PT),
    valAxisLabelColor: tickColor,
    valAxisLabelFontFace: face,
    valAxisLabelFontSize: chart.valLabelSize ?? CHART_TICK_PT,
    catAxisLineShow: true,
    catAxisLineColor: axis,
    catAxisLineSize: 0.75,
    catAxisMajorTickMark: 'none' as const,
    valAxisLineShow: true,
    valAxisLineColor: axis,
    valAxisLineSize: 0.75,
    valAxisMajorTickMark: 'none' as const,
    valGridLine: themedGrid('none'),
    catGridLine: { style: 'none' as const },
    dataBorder: { pt: 0, color: background },
    chartColors: palette,
    legendFontFace: face,
    legendFontSize: CHART_LEGEND_PT,
    legendColor: outside,
    legendPos: 'b' as const,
    dataLabelFontFace: face,
    dataLabelFontSize: CHART_VALUE_PT,
    dataLabelFontBold: true,
    dataLabelColor: outside,
    valAxisMinVal: chart.valMin,
    valAxisMaxVal: chart.valMax,
  }
  const rows = chart.series.map(series => ({ name: series.name, labels: chart.categories, values: series.values }))
  if (kind === 'waterfall') {
    const columns = waterfallColumns(chart.series[0]!.values)
    const increase = hex(colorRef(chart.colors?.[1] ?? '$accent', deck.theme, '$accent'))
    const decrease = hex(colorRef(chart.colors?.[2] ?? '$muted', deck.theme, '$muted'))
    const peak = Math.max(...columns.base.map((value, index) => value + columns.total[index]! + columns.up[index]! + columns.down[index]!), 0)
    slide.addChart(pres.ChartType.bar, [
      { name: '基座', labels: chart.categories, values: columns.base },
      { name: '合计', labels: chart.categories, values: columns.total },
      { name: '增加', labels: chart.categories, values: columns.up },
      { name: '减少', labels: chart.categories, values: columns.down },
    ], {
      ...base,
      barDir: 'col',
      barGrouping: 'stacked',
      barGapWidthPct: 80,
      showValue: false,
      showLegend: false,
      layout: chartLayout(kind, false),
      chartColors: [background, ink, increase, decrease],
      valAxisMinVal: chart.valMin ?? 0,
      valAxisMaxVal: chart.valMax ?? (on ? labelHeadroom([peak]) : undefined),
    })
    if (on) addWaterfallCallouts(slide, element, chart, face, inverse, outside, peak)
    return
  }
  if (kind === 'combo') {
    const roles = comboSeriesRoles(chart.series)
    const columns = chart.series.filter((_, index) => roles[index] === 'column')
    const lines = chart.series.filter((_, index) => roles[index] === 'line')
    let colorIndex = 0
    const columnColors = columns.map(() => palette[colorIndex++] ?? palette[0]!)
    const lineColors = lines.map(() => palette[colorIndex++] ?? palette[0]!)
    const axisLabel = {
      valAxisLabelColor: tickColor,
      valAxisLabelFontFace: face,
      valAxisLabelFontSize: chart.valLabelSize ?? CHART_TICK_PT,
      valAxisLineShow: true,
      valAxisLineColor: axis,
      valAxisLineSize: 0.75,
      valAxisMajorTickMark: 'none' as const,
    }
    slide.addChart([
      {
        type: pres.ChartType.bar,
        data: columns.map(series => ({ name: series.name, labels: chart.categories, values: series.values })),
        options: {
          barDir: 'col',
          barGrouping: 'clustered',
          barGapWidthPct: 60,
          chartColors: columnColors,
          showValue: on,
          dataLabelPosition: 'inEnd',
        },
      },
      {
        type: pres.ChartType.line,
        data: lines.map(series => ({ name: series.name, labels: chart.categories, values: series.values })),
        options: {
          secondaryValAxis: true,
          chartColors: lineColors,
          showValue: false,
          lineSize: chart.lineWidth ?? 2.25,
          lineDataSymbol: 'circle',
          lineDataSymbolSize: chart.markerSize ?? 10,
          lineDataSymbolLineColor: chart.markerColor ? hex(colorRef(chart.markerColor, deck.theme, ink)) : lineColors[0],
          lineDataSymbolLineSize: 0,
        },
      },
    ], {
      ...base,
      showLegend: chart.showLegend ?? true,
      valAxisMinVal: undefined,
      valAxisMaxVal: undefined,
      valAxes: [
        {
          ...axisLabel,
          valAxisMinVal: chart.valMin ?? 0,
          valAxisMaxVal: chart.valMax ?? (on ? labelHeadroom(columns.flatMap(series => series.values)) : undefined),
          valGridLine: themedGrid('none'),
        },
        {
          ...axisLabel,
          valAxisMinVal: chart.valMin ?? 0,
          valAxisMaxVal: chart.valMax ?? (on ? labelHeadroom(lines.flatMap(series => series.values)) : undefined),
          valGridLine: { style: 'none' as const },
        },
      ],
    })
    return
  }
  if (kind === 'scatter' || kind === 'bubble') {
    const x = chart.series[0]?.x ?? []
    const xs = chart.series.flatMap(series => series.x ?? [])
    const ys = chart.series.flatMap(series => series.values)
    const labelScatter = kind === 'scatter' && on
    const xExtent = markerExtent(xs, kind === 'bubble' ? 0.45 : 0.14)
    const yExtent = markerExtent(ys, kind === 'bubble' ? 1.15 : (labelScatter ? 0.42 : 0.16))
    slide.addChart(kind === 'bubble' ? pres.ChartType.bubble : pres.ChartType.scatter, [
      { name: 'X', values: x },
      ...chart.series.map(series => ({
        name: series.name,
        labels: chart.categories,
        values: series.values,
        sizes: series.sizes,
      })),
    ], {
      ...base,
      lineSize: kind === 'scatter' ? 0 : (chart.lineWidth ?? 0),
      lineDataSymbol: 'circle',
      lineDataSymbolSize: chart.markerSize ?? (kind === 'bubble' ? 12 : 14),
      lineDataSymbolLineColor: chart.markerColor ? hex(colorRef(chart.markerColor, deck.theme, ink)) : ink,
      lineDataSymbolLineSize: 1.25,
      showLabel: labelScatter,
      dataLabelFormatScatter: labelScatter ? 'custom' : undefined,
      dataLabelPosition: labelScatter ? 't' : undefined,
      showLegend: chart.showLegend ?? chart.series.length > 1,
      catAxisMinVal: xExtent.min,
      catAxisMaxVal: xExtent.max,
      valAxisMinVal: chart.valMin ?? yExtent.min,
      valAxisMaxVal: chart.valMax ?? yExtent.max,
      catGridLine: themedGrid('solid'),
      valGridLine: themedGrid('solid'),
    })
    return
  }
  const pieLike = kind === 'pie' || kind === 'doughnut'
  const grouped = kind === 'stacked' || kind === 'stackedPercent'
  const bars = kind === 'bar' || kind === 'column' || grouped
  const type = kind === 'line'
    ? pres.ChartType.line
    : kind === 'area'
      ? pres.ChartType.area
      : kind === 'pie'
        ? pres.ChartType.pie
        : kind === 'doughnut'
          ? pres.ChartType.doughnut
          : kind === 'radar'
            ? pres.ChartType.radar
            : pres.ChartType.bar
  const flat = chart.series.flatMap(series => series.values)
  const needsHeadroom = on && (kind === 'bar' || kind === 'column' || kind === 'line' || kind === 'area')
  slide.addChart(type, rows, {
    ...base,
    barDir: kind === 'bar' ? 'bar' : 'col',
    // PowerPoint draws the first bar category at the bottom. maxMin matches the SVG, which draws it at the top.
    // pptxgenjs 3.12 types only list minMax; the writer emits the string as given.
    ...(kind === 'bar' ? { catAxisOrientation: 'maxMin' as 'minMax' } : {}),
    barGrouping: kind === 'stackedPercent' ? 'percentStacked' : grouped ? 'stacked' : kind === 'area' ? 'standard' : 'clustered',
    barGapWidthPct: grouped ? 46 : 70,
    chartColorsOpacity: kind === 'area' || kind === 'radar' ? 46 : undefined,
    radarStyle: kind === 'radar' ? 'filled' : undefined,
    lineSize: chart.lineWidth ?? 2.25,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: chart.markerSize ?? (kind === 'line' || kind === 'radar' ? 10 : 12),
    lineDataSymbolLineColor: chart.markerColor ? hex(colorRef(chart.markerColor, deck.theme, ink)) : ink,
    lineDataSymbolLineSize: 0,
    showLegend: legend,
    showValue: on && (bars || pieLike || kind === 'line' || kind === 'area'),
    showLabel: on && pieLike,
    ...(kind === 'bar' ? { catAxisLabelPos: 'none' as const } : {}),
    showPercent: pieLike ? false : undefined,
    showLeaderLines: on && pieLike,
    dataLabelPosition: pieLike ? 'outEnd' : grouped ? 'ctr' : (on && (kind === 'line' || kind === 'area') ? 't' : (on && bars ? 'inEnd' : undefined)),
    dataLabelColor: grouped ? insideLabel(palette, ink, inverse) : outside,
    dataBorder: pieLike ? { pt: 2, color: background } : base.dataBorder,
    valAxisLabelFormatCode: kind === 'stackedPercent' ? '0%' : undefined,
    valAxisMinVal: pieLike || kind === 'radar' ? undefined : kind === 'stackedPercent' ? 0 : (chart.valMin ?? (bars || kind === 'line' || kind === 'area' ? 0 : undefined)),
    valAxisMaxVal: pieLike || kind === 'radar' || kind === 'stackedPercent' ? undefined : (chart.valMax ?? (needsHeadroom ? labelHeadroom(flat) : undefined)),
    holeSize: kind === 'doughnut' ? (chart.holeSize ?? 62) : undefined,
    ...(kind === 'radar' ? { valGridLine: themedGrid('solid'), catGridLine: themedGrid('solid') } : {}),
  })
  if (on && pieLike) addPieLeaders(pres, slide, element, chart, muted)
  if (on && (kind === 'line' || kind === 'area')) addEdgeCallouts(slide, element, chart, kind, legend, face, outside)
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
  if (await polishCharts(zip, deck, platform)) changed = true
  if (await shrinkBubbleScale(zip)) changed = true
  if (!changed) return bytes
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

/** PptxGenJS leaves bubbleScale at the PowerPoint default, which clips the largest bubble against the plot. */
async function shrinkBubbleScale(zip: JSZip): Promise<boolean> {
  let changed = false
  for (const file of zip.file(/ppt\/charts\/chart\d+\.xml/)) {
    let xml = await file.async('string')
    if (!xml.includes('<c:bubbleChart') || xml.includes('<c:bubbleScale')) continue
    const start = xml.indexOf('<c:bubbleChart')
    const axis = xml.indexOf('<c:axId', start)
    if (axis < 0) continue
    xml = `${xml.slice(0, axis)}<c:bubbleScale val="48"/>${xml.slice(axis)}`
    zip.file(file.name, xml)
    changed = true
  }
  return changed
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

function readableOn(background: string, preferred: string, alternate: string): string {
  return contrastRatio(preferred, background) >= contrastRatio(alternate, background) ? preferred : alternate
}

function insideLabel(fills: string[], ink: string, inverse: string): string {
  const colors = fills.length > 0 ? fills : [ink]
  const score = (color: string) => colors.filter(fill => contrastRatio(color, fill) >= 3).length
  return score(inverse) >= score(ink) ? inverse : ink
}

function mixHex(from: string, to: string, toward: number): string {
  const bytes = (value: string) => [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16))
  const start = bytes(from)
  const end = bytes(to)
  return start.map((channel, index) => Math.round(channel * (1 - toward) + end[index]! * toward).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function quietColor(foreground: string, background: string, toward: number): string {
  return luminance(foreground) > luminance(background)
    ? mixHex(background, foreground, toward)
    : mixHex(foreground, background, toward)
}

function labelHeadroom(values: number[]): number | undefined {
  const finite = values.filter(value => Number.isFinite(value))
  if (finite.length === 0) return undefined
  const peak = Math.max(...finite)
  if (peak <= 0) return undefined
  return Math.ceil(peak * 1.22)
}

function plotBox(kind: ChartKind, legend: boolean, bounds: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const layout = chartLayout(kind, legend)
  return {
    x: bounds.x + layout.x * bounds.w,
    y: bounds.y + layout.y * bounds.h,
    w: layout.w * bounds.w,
    h: layout.h * bounds.h,
  }
}

function polar(cx: number, cy: number, radius: number, clockwiseFromTop: number): { x: number; y: number } {
  return {
    x: cx + radius * Math.sin(clockwiseFromTop),
    y: cy - radius * Math.cos(clockwiseFromTop),
  }
}

function addLeader(pres: PptxGenJS, slide: PptxGenJS.Slide, x1: number, y1: number, x2: number, y2: number, color: string, name: string): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.max(Math.hypot(dx, dy), 0.01)
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  slide.addShape(pres.ShapeType.line, {
    x: inches(cx - length / 2),
    y: inches(cy),
    w: inches(length),
    h: 0,
    rotate: Math.abs(angle) < 0.05 ? undefined : angle,
    line: { color, width: 1 },
    objectName: name,
  })
}

function addCallout(slide: PptxGenJS.Slide, text: string, x: number, y: number, w: number, h: number, face: string, color: string, name: string): void {
  slide.addText(text, {
    x: inches(x),
    y: inches(y),
    w: inches(w),
    h: inches(h),
    fontFace: face,
    fontSize: CHART_VALUE_PT,
    bold: true,
    color,
    align: 'center',
    valign: 'middle',
    margin: 0,
    wrap: false,
    fit: 'none',
    objectName: name,
  })
}

function magnitude(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** The HTML renderer parks pie labels just outside the rim and does not draw leader lines. */
function addPieLeaders(pres: PptxGenJS, slide: PptxGenJS.Slide, element: DeckElement, chart: ChartSpec, color: string): void {
  const values = chart.series[0]?.values ?? []
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return
  const bounds = element.bounds
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const radius = Math.min(bounds.w, bounds.h) * 0.42
  let theta = 0
  values.forEach((value, index) => {
    if (value <= 0) return
    const sweep = (value / total) * Math.PI * 2
    const mid = theta + sweep / 2
    theta += sweep
    const start = polar(cx, cy, radius + 0.5, mid)
    const end = polar(cx, cy, radius + 8, mid)
    addLeader(pres, slide, start.x, start.y, end.x, end.y, color, `${element.id}-leader-${index}`)
  })
}

function addEdgeCallouts(slide: PptxGenJS.Slide, element: DeckElement, chart: ChartSpec, kind: ChartKind, legend: boolean, face: string, color: string): void {
  const categories = chart.categories.length
  if (categories < 2) return
  const plot = plotBox(kind, legend, element.bounds)
  const valMin = chart.valMin ?? 0
  const valMax = chart.valMax ?? labelHeadroom(chart.series.flatMap(series => series.values))
  if (valMax === undefined || valMax <= valMin) return
  chart.series.forEach((series, seriesIndex) => {
    for (const point of keyIndexes(series.values)) {
      if (point !== 0) continue
      const value = series.values[point]
      if (value === undefined || !Number.isFinite(value)) continue
      const py = plot.y + plot.h - ((value - valMin) / (valMax - valMin)) * plot.h
      const text = magnitude(value)
      addCallout(slide, text, plot.x + 16, py - 18, Math.max(28, text.length * 8), 16, face, color, `${element.id}-edge-${seriesIndex}`)
    }
  })
}

function addWaterfallCallouts(slide: PptxGenJS.Slide, element: DeckElement, chart: ChartSpec, face: string, inverse: string, ink: string, peak: number): void {
  const values = chart.series[0]?.values ?? []
  if (values.length === 0) return
  const columns = waterfallColumns(values)
  const plot = plotBox('waterfall', false, element.bounds)
  const slot = plot.w / values.length
  const valMin = chart.valMin ?? 0
  const valMax = chart.valMax ?? labelHeadroom([peak]) ?? peak
  if (valMax <= valMin) return
  const yOf = (value: number) => plot.y + plot.h - ((value - valMin) / (valMax - valMin)) * plot.h
  values.forEach((_, index) => {
    const segments = [
      { base: 0, value: columns.total[index] ?? 0, text: magnitude(columns.total[index] ?? 0) },
      { base: columns.base[index] ?? 0, value: columns.up[index] ?? 0, text: `+${magnitude(columns.up[index] ?? 0)}` },
      { base: columns.base[index] ?? 0, value: columns.down[index] ?? 0, text: `\u2212${magnitude(columns.down[index] ?? 0)}` },
    ]
    for (const segment of segments) {
      if (segment.value === 0) continue
      const top = yOf(segment.base + segment.value)
      const bottom = yOf(segment.base)
      const boxW = Math.max(36, segment.text.length * 9)
      const boxH = 16
      const cx = plot.x + slot * (index + 0.5)
      const tall = bottom - top >= boxH + 2
      addCallout(
        slide,
        segment.text,
        cx - boxW / 2,
        tall ? (top + bottom) / 2 - boxH / 2 : top - boxH - 1,
        boxW,
        boxH,
        face,
        tall ? inverse : ink,
        `${element.id}-wf-${index}`,
      )
    }
  })
}

function chartLayout(kind: ChartKind, legend: boolean): { x: number; y: number; w: number; h: number } {
  const bottom = legend ? 0.18 : 0.12
  const frame = (x: number, y: number, w: number) => ({ x, y, w, h: Math.round((1 - y - bottom) * 1000) / 1000 })
  if (kind === 'bar') return frame(0.2, 0.06, 0.72)
  if (kind === 'pie' || kind === 'doughnut') return { x: 0.14, y: 0.08, w: 0.72, h: legend ? 0.7 : 0.8 }
  if (kind === 'radar') return { x: 0.14, y: 0.06, w: 0.72, h: legend ? 0.72 : 0.8 }
  if (kind === 'combo') return frame(0.1, 0.08, 0.74)
  if (kind === 'scatter' || kind === 'bubble') return frame(0.11, 0.08, 0.8)
  return frame(0.1, 0.08, 0.84)
}

function chartPart(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  if (target.startsWith('../')) return `ppt/${target.slice(3)}`
  return `ppt/slides/${target}`
}

async function polishCharts(zip: JSZip, deck: Deck, platform: PlatformName): Promise<boolean> {
  let changed = false
  for (let index = 0; index < deck.pages.length; index++) {
    const page = deck.pages[index]!
    const charts = page.elements.filter(element => element.type === 'chart' && element.chart)
    if (charts.length === 0) continue
    const relsFile = zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`)
    if (!relsFile) continue
    const rels = await relsFile.async('string')
    const targets = [...rels.matchAll(/relationships\/chart" Target="([^"]+)"/g)].map(match => chartPart(match[1]!))
    const background = colorRef(page.background, deck.theme, '$paper')
    for (let chartIndex = 0; chartIndex < charts.length; chartIndex++) {
      const target = targets[chartIndex]
      const element = charts[chartIndex]!
      if (!target) continue
      const file = zip.file(target)
      if (!file) continue
      const xml = await file.async('string')
      const next = polishChartXml(xml, deck, element, platform, background)
      if (next !== xml) {
        zip.file(target, next)
        changed = true
      }
    }
  }
  return changed
}

function polishChartXml(xml: string, deck: Deck, element: DeckElement, platform: PlatformName, pageBackground: string): string {
  const chart = element.chart!
  const face = resolveFontFace(deck, '$cjk', platform)
  const ink = hex(colorRef('$ink', deck.theme, '#111111'))
  const accent = hex(colorRef('$accent', deck.theme, ink))
  const inverse = hex(colorRef('$inverse', deck.theme, '#FFFFFF'))
  const background = hex(pageBackground)
  const outside = readableOn(background, ink, inverse)
  let next = xml
  if (chart.kind === 'pie' || chart.kind === 'doughnut') next = polishPie(next, accent, background, outside)
  if (chart.kind === 'bar' || chart.kind === 'column' || chart.kind === 'combo') {
    next = next.replace(/<c:dLblPos val="inEnd"\/>/g, '<c:dLblPos val="outEnd"/>')
  }
  if (chart.kind === 'bar' && chart.showValues !== false) next = polishBarLabels(next)
  if (chart.kind === 'combo') next = polishComboLines(next, chart)
  if ((chart.kind === 'line' || chart.kind === 'area') && chart.showValues !== false) next = polishKeyLabels(next, chart)
  if (chart.kind === 'scatter' && chart.showValues !== false) next = polishScatterLabels(next, face, ink)
  next = next.replace(/typeface="Arial"/g, `typeface="${escapeXml(face)}"`)
  return addEastAsiaFace(next, face)
}

function polishPie(xml: string, accent: string, background: string, label: string): string {
  // PptxGenJS hardcodes the series label: 18pt, black, percent, centered. Doughnut omits the series position.
  // The HTML renderer reads that series block and ignores the per-point flags.
  let next = xml
    .replace(/<a:schemeClr val="accent1"\/>/g, `<a:srgbClr val="${accent}"/>`)
    .replace(/<a:srgbClr val="F9F9F9"\/>/g, `<a:srgbClr val="${background}"/>`)
  const series = /<a:defRPr sz="1800"([\s\S]*?)<\/c:txPr>\s*(?:<c:dLblPos val="ctr"\/>)?\s*<c:showLegendKey val="0"\/>\s*<c:showVal val="0"\/>\s*<c:showCatName val="1"\/>\s*<c:showSerName val="0"\/>\s*<c:showPercent val="1"\/>/
  next = next.replace(series, (_all, inner: string) => {
    const body = inner.replace('val="000000"', `val="${label}"`)
    return `<a:defRPr sz="1200"${body}</c:txPr><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="0"/>`
  })
  next = next.replace(/<c:dLblPos val="ctr"\/>/g, '<c:dLblPos val="outEnd"/>')
  next = next.replace(/<c:dLbl>([\s\S]*?)<c:showLegendKey/g, (all, inner: string) => {
    if (inner.includes('dLblPos')) return all
    return `<c:dLbl>${inner}<c:dLblPos val="outEnd"/><c:showLegendKey`
  })
  next = next.replace(/<c:showPercent val="1"\/>/g, '<c:showPercent val="0"/>')
  if (!next.includes('<c:separator>')) next = next.replace('<c:showLeaderLines', '<c:separator> </c:separator><c:showLeaderLines')
  return next.replace(/<c:showLeaderLines val="0"\/>/g, '<c:showLeaderLines val="1"/>')
}

function polishBarLabels(xml: string): string {
  let next = xml.replace(/<c:showCatName val="0"\/>/g, '<c:showCatName val="1"/>')
  if (!next.includes('<c:separator>')) next = next.replace(/<c:showLeaderLines/g, '<c:separator> </c:separator><c:showLeaderLines')
  return next
}

function polishComboLines(xml: string, chart: ChartSpec): string {
  const roles = comboSeriesRoles(chart.series)
  const lineCounts = chart.series.filter((_, index) => roles[index] === 'line').map(series => series.values.length)
  let index = 0
  return xml.replace(/<c:lineChart>[\s\S]*?<\/c:lineChart>/g, block => block.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => {
    const count = lineCounts[index] ?? 0
    index += 1
    const labels = Array.from({ length: count }, (_, point) => deletedLabel(point)).join('')
    return series
      .replace('<c:dLbls>', `<c:dLbls>${labels}`)
      .replace(/<c:showVal val="0"\/>/g, '<c:showVal val="1"/>')
  }))
}

function polishKeyLabels(xml: string, chart: ChartSpec): string {
  let index = 0
  return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => {
    const values = chart.series[index]?.values ?? []
    index += 1
    const keep = new Set(keyIndexes(values))
    // A label centered on the first category sits on the value axis. That point is redrawn beside the marker.
    const labels = values.map((_, point) => keep.has(point) && point !== 0 ? '' : deletedLabel(point)).join('')
    if (!labels) return series
    return series.replace('<c:dLbls>', `<c:dLbls>${labels}`)
  })
}

function polishScatterLabels(xml: string, face: string, color: string): string {
  const typeface = escapeXml(face)
  const run = `<a:rPr lang="zh-CN" b="1" sz="1200" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${typeface}"/></a:rPr>`
  return xml.replace(/<a:rPr lang="[^"]*" dirty="0"\/>/g, run)
}

function deletedLabel(index: number): string {
  return `<c:dLbl><c:idx val="${index}"/><c:delete val="1"/></c:dLbl>`
}

function keyIndexes(values: number[]): number[] {
  const finite = values.map((value, index) => ({ value, index })).filter(item => Number.isFinite(item.value))
  if (finite.length === 0) return []
  let min = finite[0]!
  let max = finite[0]!
  for (const item of finite) {
    if (item.value < min.value) min = item
    if (item.value > max.value) max = item
  }
  return min.index === max.index ? [min.index] : [min.index, max.index]
}

function addEastAsiaFace(xml: string, face: string): string {
  const ea = `<a:ea typeface="${escapeXml(face)}"/>`
  return xml.replace(/<a:latin typeface="[^"]*"\/>(?!<a:ea\b)/g, match => `${match}${ea}`)
}

function markerExtent(values: number[], ratio: number): { min: number; max: number } {
  const finite = values.filter(value => Number.isFinite(value))
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = Math.max(max - min, 1)
  return { min: min - span * ratio, max: max + span * ratio }
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

function waterfallColumns(values: number[]): { base: number[]; total: number[]; up: number[]; down: number[] } {
  const parts = waterfallParts(values)
  return {
    base: parts.base,
    total: parts.up.map((value, index) => index === 0 || index === parts.up.length - 1 ? value : 0),
    up: parts.up.map((value, index) => index === 0 || index === parts.up.length - 1 ? 0 : value),
    down: parts.down,
  }
}
