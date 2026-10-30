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
  /** Default runs deck_check and writes nothing on needs_revision. False skips the check and still writes, for an in-progress preview. */
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

/** Shape name is the deck element id. OfficeCLI addresses it as `/slide[n]/shape[@name=<id>]`. Chart decorations use `${id}-…`. */
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
const CHART_TICK_PT = 12
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
  const tickColor = chart.valLabelColor
    ? hex(colorRef(chart.valLabelColor, deck.theme, ticks))
    : deeperTick(ticks, ink)
  const categoryColor = chart.catLabelColor
    ? hex(colorRef(chart.catLabelColor, deck.theme, outside))
    : (numericAxis ? tickColor : outside)
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
    // The HTML preview shrinks native value ticks. The redrawn text is what the page shows.
    valAxisLabelPos: 'none' as const,
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
    const scale = chartValueScale(chart, [peak], false)
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
      valAxisMinVal: scale.min,
      valAxisMaxVal: scale.max,
      valAxisMajorUnit: scale.step,
    })
    if (on) addWaterfallCallouts(slide, element, chart, face, inverse, outside, scale)
    addValueTicks(pres, slide, element, plotBox('waterfall', false, element.bounds), scale, face, tickColor, background, 'left')
    return
  }
  if (kind === 'combo') {
    const roles = comboSeriesRoles(chart.series)
    const columns = chart.series.filter((_, index) => roles[index] === 'column')
    const lines = chart.series.filter((_, index) => roles[index] === 'line')
    let colorIndex = 0
    const columnColors = columns.map(() => palette[colorIndex++] ?? palette[0]!)
    const lineColors = lines.map(() => palette[colorIndex++] ?? palette[0]!)
    const columnScale = chartValueScale(chart, columns.flatMap(series => series.values), true)
    const lineScale = chartValueScale(chart, lines.flatMap(series => series.values), true)
    const legend = chart.showLegend ?? true
    const axisLabel = {
      valAxisLabelColor: tickColor,
      valAxisLabelFontFace: face,
      valAxisLabelFontSize: chart.valLabelSize ?? CHART_TICK_PT,
      valAxisLabelPos: 'none' as const,
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
          barGapWidthPct: 100,
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
      // The HTML preview draws a combo line from plot edge to plot edge and ignores the
      // secondary scale. Native legend is off so the chart box maps 1:1 onto the slide;
      // addComboOverlay repaints the line on the column centers and the right-hand ticks.
      barDir: 'col',
      showLegend: false,
      layout: chartLayout(kind, legend),
      barGapWidthPct: 100,
      valAxisMinVal: undefined,
      valAxisMaxVal: undefined,
      valAxes: [
        {
          ...axisLabel,
          valAxisMinVal: columnScale.min,
          valAxisMaxVal: columnScale.max,
          valAxisMajorUnit: columnScale.step,
          valGridLine: themedGrid('none'),
        },
        {
          ...axisLabel,
          valAxisMinVal: lineScale.min,
          valAxisMaxVal: lineScale.max,
          valAxisMajorUnit: lineScale.step,
          valGridLine: { style: 'none' as const },
        },
      ],
    })
    addComboOverlay(pres, slide, element, chart, {
      background,
      ink,
      inverse,
      face,
      axis,
      tickColor,
      columnColors,
      lineColors,
      columnScale,
      lineScale,
      legend,
      labels: on,
    })
    return
  }
  if (kind === 'scatter' || kind === 'bubble') {
    const x = chart.series[0]?.x ?? []
    const xs = chart.series.flatMap(series => series.x ?? [])
    const ys = chart.series.flatMap(series => series.values)
    const labelScatter = kind === 'scatter' && on
    const xScale = paddedScale(xs, kind === 'bubble' ? 0.35 : 0.16)
    const yScale = chart.valMax !== undefined || chart.valMin !== undefined
      ? chartValueScale(chart, ys, kind === 'bubble')
      : paddedScale(ys, kind === 'bubble' ? 0.45 : (labelScatter ? 0.28 : 0.16))
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
      // Bubble keeps the native series for PowerPoint and repaints the plot. The HTML
      // preview ignores the axis extent, pins the first bubble to the spine, and numbers
      // the category axis 12, 17, 22. Scatter's category ticks stay at 9pt black.
      showLegend: kind === 'bubble' ? false : (chart.showLegend ?? chart.series.length > 1),
      catAxisMinVal: xScale.min,
      catAxisMaxVal: xScale.max,
      catAxisMajorUnit: xScale.step,
      valAxisMinVal: yScale.min,
      valAxisMaxVal: yScale.max,
      valAxisMajorUnit: yScale.step,
      catGridLine: themedGrid('solid'),
      valGridLine: themedGrid('solid'),
    })
    if (kind === 'scatter') {
      addValueTicks(pres, slide, element, plotBox('scatter', false, element.bounds), yScale, face, tickColor, background, 'left')
      addScatterCategoryTicks(pres, slide, element, xScale, face, tickColor, background)
    }
    if (kind === 'bubble') {
      addBubbleOverlay(pres, slide, element, chart, {
        background,
        ink,
        face,
        axis,
        grid: gridTint,
        tickColor,
        colors: palette,
        xScale,
        yScale,
        legend: chart.showLegend ?? chart.series.length > 1,
      })
    }
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
  const flat = kind === 'stacked' ? columnSums(chart.series) : chart.series.flatMap(series => series.values)
  const needsHeadroom = on && (kind === 'bar' || kind === 'column' || kind === 'line' || kind === 'area')
  const scale = kind === 'stackedPercent'
    ? { min: 0, max: 1, step: 0.2 }
    : kind === 'radar'
      ? chartValueScale({ ...chart, valMin: chart.valMin ?? 0 }, flat, false)
      : (pieLike ? undefined : chartValueScale(chart, flat, needsHeadroom))
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
    showLegend: kind === 'radar' ? false : legend,
    showValue: on && (bars || pieLike || kind === 'line' || kind === 'area'),
    showLabel: on && pieLike,
    ...(kind === 'bar' ? { catAxisLabelPos: 'none' as const } : {}),
    showPercent: pieLike ? false : undefined,
    showLeaderLines: on && pieLike,
    dataLabelPosition: pieLike ? 'outEnd' : grouped ? 'ctr' : (on && (kind === 'line' || kind === 'area') ? 't' : (on && bars ? 'inEnd' : undefined)),
    dataLabelColor: grouped ? insideLabel(palette, ink, inverse) : outside,
    dataBorder: pieLike ? { pt: 2, color: background } : base.dataBorder,
    valAxisLabelFormatCode: kind === 'stackedPercent' ? '0%' : undefined,
    valAxisMinVal: scale?.min,
    valAxisMaxVal: scale?.max,
    valAxisMajorUnit: scale?.step,
    holeSize: kind === 'doughnut' ? (chart.holeSize ?? 62) : undefined,
    ...(kind === 'radar' ? { valGridLine: themedGrid('solid'), catGridLine: themedGrid('solid') } : {}),
  })
  if (on && pieLike) addPieLeaders(pres, slide, element, chart, muted)
  if (on && (kind === 'line' || kind === 'area')) addEdgeCallouts(slide, element, chart, kind, legend, face, outside)
  if (kind === 'radar') addRadarValueLabels(pres, slide, element, chart, legend, face, tickColor, background, ink, palette)
  if (scale && (kind === 'column' || kind === 'line' || kind === 'area' || kind === 'stacked' || kind === 'stackedPercent')) {
    addValueTicks(pres, slide, element, plotBox(kind, legend, element.bounds), scale, face, tickColor, background, 'left', kind === 'stackedPercent' ? formatPercentTick : formatTick)
  }
  if (scale && kind === 'bar') addValueTicks(pres, slide, element, plotBox(kind, legend, element.bounds), scale, face, tickColor, background, 'bottom')
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
  // PptxGenJS places notesMasterIdLst after sldIdLst. CT_Presentation requires
  // master lists before the slide list; preserve their contents and relationships.
  const presentation = zip.file('ppt/presentation.xml')
  if (presentation) {
    const xml = await presentation.async('string')
    const next = xml.replace(/(<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>)(<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>)/, '$2$1')
    if (next !== xml) {
      zip.file('ppt/presentation.xml', next)
      changed = true
    }
  }
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

type AxisScale = { min: number; max: number; step: number }

function cleanNumber(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** 1-2-5 step aimed at about four intervals across `span`. */
function niceStep(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const rough = span / 4
  const mag = 10 ** Math.floor(Math.log10(rough))
  const residual = rough / mag
  const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10
  return cleanNumber(nice * mag)
}

/** Snap an axis so the labeled ticks are round. Headroom keeps outside labels off the frame. */
function niceAxis(min: number, max: number, headroom: boolean): AxisScale {
  let lo = Number.isFinite(min) ? min : 0
  let hi = Number.isFinite(max) ? max : lo + 1
  if (hi < lo) [lo, hi] = [hi, lo]
  if (hi === lo) hi = lo + Math.max(Math.abs(lo), 1)
  const span = hi - lo
  const step = niceStep(headroom ? span * 1.18 : span)
  const axisMin = lo === 0 ? 0 : cleanNumber(Math.floor(lo / step) * step)
  let axisMax = cleanNumber(Math.ceil((hi - axisMin) / step) * step + axisMin)
  if (axisMax < hi) axisMax = cleanNumber(axisMax + step)
  if (headroom && (axisMax - hi) / step < 0.6) axisMax = cleanNumber(axisMax + step)
  return { min: axisMin, max: axisMax, step }
}

function chartValueScale(chart: ChartSpec, values: number[], headroom: boolean): AxisScale {
  const finite = values.filter(value => Number.isFinite(value))
  const dataMax = finite.length ? Math.max(...finite) : 0
  const dataMin = finite.length ? Math.min(...finite) : 0
  const min = chart.valMin ?? Math.min(0, dataMin)
  if (chart.valMax !== undefined) {
    const max = chart.valMax
    return { min, max, step: niceStep(Math.max(max - min, Math.abs(dataMax) || 1)) }
  }
  return niceAxis(min, Math.max(dataMax, min), headroom)
}

function paddedScale(values: number[], ratio: number): AxisScale {
  const finite = values.filter(value => Number.isFinite(value))
  if (finite.length === 0) return { min: 0, max: 1, step: 1 }
  const dataMin = Math.min(...finite)
  const dataMax = Math.max(...finite)
  const span = Math.max(dataMax - dataMin, 1)
  const lo = dataMin >= 0 ? Math.max(0, dataMin - span * ratio) : dataMin - span * ratio
  return niceAxis(lo, dataMax + span * ratio, false)
}

function columnSums(series: ChartSpec['series']): number[] {
  const count = Math.max(...series.map(item => item.values.length), 0)
  return Array.from({ length: count }, (_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0))
}

function deeperTick(color: string, ink: string): string {
  if (color.toUpperCase() === ink.toUpperCase()) return color.toUpperCase()
  return mixHex(color, ink, 0.45)
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

function addLeader(pres: PptxGenJS, slide: PptxGenJS.Slide, x1: number, y1: number, x2: number, y2: number, color: string, name: string, width = 1): void {
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
    line: { color, width },
    objectName: name,
  })
}

function addCallout(slide: PptxGenJS.Slide, text: string, x: number, y: number, w: number, h: number, face: string, color: string, name: string, bold = true, align: 'center' | 'left' | 'right' = 'center'): void {
  slide.addText(text, {
    x: inches(x),
    y: inches(y),
    w: inches(w),
    h: inches(h),
    fontFace: face,
    fontSize: CHART_VALUE_PT,
    bold,
    color,
    align,
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
  const scale = chartValueScale(chart, chart.series.flatMap(series => series.values), true)
  if (scale.max <= scale.min) return
  const yOf = (value: number) => plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h
  chart.series.forEach((series, seriesIndex) => {
    for (const point of keyIndexes(series.values)) {
      if (point !== 0 && point !== categories - 1) continue
      const value = series.values[point]
      if (value === undefined || !Number.isFinite(value)) continue
      const text = magnitude(value)
      const boxW = Math.max(28, text.length * 8)
      const py = yOf(value)
      const steps = Math.round((value - scale.min) / scale.step)
      const tickY = yOf(scale.min + steps * scale.step)
      // A value that lands on a tick sits on the axis label. Move that callout into the plot.
      const tight = point === 0 && Math.abs(py - tickY) < 8
      const x = point === 0 ? plot.x + (tight ? 56 : 28) : plot.x + plot.w - 28 - boxW
      addCallout(slide, text, x, tight ? py - 28 : py - 20, boxW, 16, face, color, point === 0 ? `${element.id}-edge-${seriesIndex}` : `${element.id}-edge-${seriesIndex}-end`)
    }
  })
}

function addWaterfallCallouts(slide: PptxGenJS.Slide, element: DeckElement, chart: ChartSpec, face: string, inverse: string, ink: string, scale: AxisScale): void {
  const values = chart.series[0]?.values ?? []
  if (values.length === 0) return
  const columns = waterfallColumns(values)
  const plot = plotBox('waterfall', false, element.bounds)
  const slot = plot.w / values.length
  const valMin = scale.min
  const valMax = scale.max
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

function formatTick(value: number): string {
  const rounded = cleanNumber(value)
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function formatPercentTick(value: number): string {
  return `${formatTick(value * 100)}%`
}

/** Native value ticks render smaller and lighter in the HTML preview than a text box. Draw both sides as the same 12pt text. */
function addValueTicks(
  pres: PptxGenJS,
  slide: PptxGenJS.Slide,
  element: DeckElement,
  plot: { x: number; y: number; w: number; h: number },
  scale: AxisScale,
  face: string,
  color: string,
  background: string,
  edge: 'left' | 'bottom',
  format: (value: number) => string = formatTick,
): void {
  const span = scale.max - scale.min
  if (!(span > 0)) return
  const values = axisTicks(scale)
  if (values.length === 0) return
  if (edge === 'left') {
    const gutter = plot.x - element.bounds.x
    if (gutter > 4) {
      slide.addShape(pres.ShapeType.rect, {
        x: inches(element.bounds.x),
        y: inches(plot.y - 12),
        w: inches(gutter - 1),
        h: inches(plot.h + 24),
        fill: { color: background },
        line: { color: background, pt: 0 },
        objectName: `${element.id}-ltick-cover`,
      })
    }
    values.forEach((value, index) => {
      const text = format(value)
      const boxW = Math.max(24, text.length * 8)
      const y = plot.y + plot.h - ((value - scale.min) / span) * plot.h
      addCallout(slide, text, plot.x - boxW - 6, y - 8, boxW, 16, face, color, `${element.id}-ltick-${index}`, false, 'right')
    })
    return
  }
  const below = element.bounds.y + element.bounds.h - plot.y - plot.h
  slide.addShape(pres.ShapeType.rect, {
    x: inches(plot.x - 8),
    y: inches(plot.y + plot.h + 1),
    w: inches(plot.w + 16),
    h: inches(Math.max(16, below - 1)),
    fill: { color: background },
    line: { color: background, pt: 0 },
    objectName: `${element.id}-btick-cover`,
  })
  values.forEach((value, index) => {
    const text = format(value)
    const boxW = Math.max(18, text.length * 8)
    const x = plot.x + ((value - scale.min) / span) * plot.w
    addCallout(slide, text, x - boxW / 2, plot.y + plot.h + 3, boxW, 16, face, color, `${element.id}-btick-${index}`, false)
  })
}

function addComboOverlay(
  pres: PptxGenJS,
  slide: PptxGenJS.Slide,
  element: DeckElement,
  chart: ChartSpec,
  paint: {
    background: string
    ink: string
    inverse: string
    face: string
    axis: string
    tickColor: string
    columnColors: string[]
    lineColors: string[]
    columnScale: AxisScale
    lineScale: AxisScale
    legend: boolean
    labels: boolean
  },
): void {
  const roles = comboSeriesRoles(chart.series)
  const columns = chart.series.filter((_, index) => roles[index] === 'column')
  const lines = chart.series.filter((_, index) => roles[index] === 'line')
  const count = chart.categories.length
  if (count === 0 || columns.length === 0) return
  const plot = plotBox('combo', paint.legend, element.bounds)
  const slot = plot.w / count
  const yOf = (value: number, scale: AxisScale) => {
    const span = scale.max - scale.min
    if (!(span > 0)) return plot.y + plot.h
    return plot.y + plot.h - ((value - scale.min) / span) * plot.h
  }
  const columnTop = (index: number) => yOf(Math.max(...columns.map(series => series.values[index] ?? 0), paint.columnScale.min), paint.columnScale)
  // The preview draws the native line on the plot edges. Cover that plot and paint the line on the column centers.
  slide.addShape(pres.ShapeType.rect, {
    x: inches(plot.x - 3),
    y: inches(plot.y - 2),
    w: inches(plot.w + 8),
    h: inches(plot.h + 4),
    fill: { color: paint.background },
    line: { color: paint.background, pt: 0 },
    objectName: `${element.id}-plot-cover`,
  })
  const barWidth = slot / (columns.length + 1)
  const cluster = barWidth * columns.length
  const clusterStart = (slot - cluster) / 2
  const taken: Array<{ x: number; y: number; w: number; h: number }> = []
  const overlaps = (box: { x: number; y: number; w: number; h: number }, gap = 2) => taken.some(item =>
    box.x < item.x + item.w + gap && box.x + box.w + gap > item.x && box.y < item.y + item.h + gap && box.y + box.h + gap > item.y)
  const columnBoxes: Array<{ x: number; y: number; w: number; h: number; text: string; color: string; name: string }> = []
  columns.forEach((series, seriesIndex) => {
    const color = paint.columnColors[seriesIndex] ?? paint.ink
    series.values.forEach((value, index) => {
      if (!Number.isFinite(value)) return
      const top = yOf(value, paint.columnScale)
      const bottom = yOf(paint.columnScale.min, paint.columnScale)
      const x = plot.x + slot * index + clusterStart + seriesIndex * barWidth
      const height = Math.max(bottom - top, 0.4)
      slide.addShape(pres.ShapeType.rect, {
        x: inches(x),
        y: inches(Math.min(top, bottom)),
        w: inches(barWidth),
        h: inches(height),
        fill: { color },
        line: { color, pt: 0 },
        objectName: `${element.id}-col-${seriesIndex}-${index}`,
      })
      if (!paint.labels) return
      const text = magnitude(value)
      const boxW = Math.max(28, text.length * 8)
      const lineNear = lines.some(line => {
        const sample = line.values[index]
        return Number.isFinite(sample) && Math.abs(yOf(sample!, paint.lineScale) - top) < 36
      })
      const inside = lineNear && height > 24
      const box = {
        x: x + barWidth / 2 - boxW / 2,
        y: inside ? Math.min(top, bottom) + 3 : Math.min(top, bottom) - 16,
        w: boxW,
        h: 16,
      }
      taken.push(box)
      columnBoxes.push({ ...box, text, color: inside ? paint.inverse : paint.ink, name: `${element.id}-col-label-${seriesIndex}-${index}` })
    })
  })
  const linePoints: Array<{ seriesIndex: number; index: number; x: number; y: number; value: number; color: string }> = []
  lines.forEach((series, seriesIndex) => {
    const color = paint.lineColors[seriesIndex] ?? paint.ink
    const points = series.values.map((value, index) => ({ index, value, x: plot.x + slot * (index + 0.5), y: yOf(value, paint.lineScale) }))
      .filter(point => Number.isFinite(point.value))
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!
      const point = points[index]!
      addLeader(pres, slide, previous.x, previous.y, point.x, point.y, color, `${element.id}-line-${seriesIndex}-${index}`, 2.25)
    }
    for (const point of points) {
      slide.addShape(pres.ShapeType.ellipse, {
        x: inches(point.x - 4),
        y: inches(point.y - 4),
        w: inches(8),
        h: inches(8),
        fill: { color },
        line: { color, pt: 0 },
        objectName: `${element.id}-marker-${seriesIndex}-${point.index}`,
      })
      taken.push({ x: point.x - 4, y: point.y - 4, w: 8, h: 8 })
      linePoints.push({ seriesIndex, index: point.index, x: point.x, y: point.y, value: point.value, color })
    }
  })
  for (const box of columnBoxes) addCallout(slide, box.text, box.x, box.y, box.w, box.h, paint.face, box.color, box.name)
  const segments = linePoints.map(point => {
    const neighbors = linePoints.filter(other => other.seriesIndex === point.seriesIndex && Math.abs(other.index - point.index) === 1)
    return { point, neighbors }
  })
  for (const { point, neighbors } of segments) {
    if (!paint.labels) continue
    const text = magnitude(point.value)
    const boxW = Math.max(22, text.length * 9)
    const boxH = 16
    const barTop = columnTop(point.index)
    const candidates = [
      { x: point.x - boxW / 2, y: point.y - boxH - 6 },
      { x: point.x - boxW / 2, y: point.y + 8 },
      { x: point.x + 12, y: point.y - boxH / 2 },
      { x: point.x - boxW - 12, y: point.y - boxH / 2 },
    ]
    const placed = candidates
      .map(candidate => ({ ...candidate, w: boxW, h: boxH }))
      .filter(candidate => candidate.x >= plot.x + 1 && candidate.y >= plot.y + 1 && candidate.x + candidate.w <= plot.x + plot.w - 1 && candidate.y + candidate.h <= plot.y + plot.h - 1)
      .filter(candidate => !overlaps(candidate) && !lineHitsBox(candidate, point, neighbors))
    const box = placed[0] ?? candidates.map(candidate => ({ ...candidate, w: boxW, h: boxH })).find(candidate => !overlaps(candidate)) ?? {
      x: Math.max(plot.x + 1, Math.min(point.x - boxW / 2, plot.x + plot.w - boxW - 1)),
      y: Math.max(plot.y + 1, point.y - boxH - 6),
      w: boxW,
      h: boxH,
    }
    taken.push(box)
    const onBar = box.y + box.h / 2 > barTop + 2
    addCallout(slide, text, box.x, box.y, box.w, box.h, paint.face, onBar ? paint.inverse : paint.ink, `${element.id}-line-label-${point.seriesIndex}-${point.index}`)
  }
  const leftGutter = plot.x - element.bounds.x
  if (leftGutter > 4) {
    slide.addShape(pres.ShapeType.rect, {
      x: inches(element.bounds.x),
      y: inches(plot.y - 12),
      w: inches(leftGutter - 1),
      h: inches(plot.h + 24),
      fill: { color: paint.background },
      line: { color: paint.background, pt: 0 },
      objectName: `${element.id}-ltick-cover`,
    })
  }
  const rightWidth = Math.max(28, element.bounds.x + element.bounds.w - plot.x - plot.w - 2)
  slide.addShape(pres.ShapeType.rect, {
    x: inches(plot.x + plot.w + 1),
    y: inches(plot.y - 12),
    w: inches(rightWidth),
    h: inches(plot.h + 24),
    fill: { color: paint.background },
    line: { color: paint.background, pt: 0 },
    objectName: `${element.id}-rtick-cover`,
  })
  addLeader(pres, slide, plot.x, plot.y, plot.x, plot.y + plot.h, paint.axis, `${element.id}-axis-y`, 0.75)
  addLeader(pres, slide, plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, paint.axis, `${element.id}-axis-x`, 0.75)
  addLeader(pres, slide, plot.x + plot.w, plot.y, plot.x + plot.w, plot.y + plot.h, paint.axis, `${element.id}-axis-y2`, 0.75)
  const ticks: number[] = []
  for (let value = paint.lineScale.min; value <= paint.lineScale.max + paint.lineScale.step * 0.001; value += paint.lineScale.step) ticks.push(cleanNumber(value))
  ticks.forEach((value, index) => {
    addCallout(slide, formatTick(value), plot.x + plot.w + 6, yOf(value, paint.lineScale) - 8, Math.max(24, rightWidth - 8), 16, paint.face, paint.tickColor, `${element.id}-rtick-${index}`, false, 'left')
  })
  axisTicks(paint.columnScale).forEach((value, index) => {
    const text = formatTick(value)
    const boxW = Math.max(24, text.length * 8)
    addCallout(slide, text, plot.x - boxW - 6, yOf(value, paint.columnScale) - 8, boxW, 16, paint.face, paint.tickColor, `${element.id}-ltick-${index}`, false, 'right')
  })
  if (!paint.legend) return
  const items = [
    ...columns.map((series, index) => ({ name: series.name, color: paint.columnColors[index] ?? paint.ink, line: false })),
    ...lines.map((series, index) => ({ name: series.name, color: paint.lineColors[index] ?? paint.ink, line: true })),
  ]
  const pieces = items.map(item => ({ ...item, textW: Math.max(28, Array.from(item.name).length * 13) }))
  const total = pieces.reduce((sum, item) => sum + 18 + item.textW, 0) + Math.max(0, pieces.length - 1) * 18
  let cursor = element.bounds.x + (element.bounds.w - total) / 2
  const rowY = element.bounds.y + element.bounds.h - 22
  pieces.forEach((item, index) => {
    if (item.line) addLeader(pres, slide, cursor, rowY + 8, cursor + 14, rowY + 8, item.color, `${element.id}-legend-line-${index}`, 2.25)
    else {
      slide.addShape(pres.ShapeType.rect, {
        x: inches(cursor),
        y: inches(rowY + 2),
        w: inches(12),
        h: inches(12),
        fill: { color: item.color },
        line: { color: item.color, pt: 0 },
        objectName: `${element.id}-legend-swatch-${index}`,
      })
    }
    addCallout(slide, item.name, cursor + 16, rowY, item.textW, 16, paint.face, paint.ink, `${element.id}-legend-${index}`, false, 'left')
    cursor += 18 + item.textW + 18
  })
}

function lineHitsBox(
  box: { x: number; y: number; w: number; h: number },
  point: { x: number; y: number },
  neighbors: Array<{ x: number; y: number }>,
): boolean {
  return neighbors.some(other => {
    for (let step = 1; step <= 16; step++) {
      const t = step / 16
      const x = point.x + (other.x - point.x) * t
      const y = point.y + (other.y - point.y) * t
      if (x >= box.x - 1 && x <= box.x + box.w + 1 && y >= box.y - 1 && y <= box.y + box.h + 1) return true
    }
    return false
  })
}

function axisTicks(scale: AxisScale): number[] {
  if (!(scale.step > 0) || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return []
  const ticks: number[] = []
  for (let value = scale.min; value <= scale.max + scale.step * 0.001; value += scale.step) ticks.push(cleanNumber(value))
  return ticks
}

function addSwatchLegend(pres: PptxGenJS, slide: PptxGenJS.Slide, element: DeckElement, face: string, ink: string, items: Array<{ name: string; color: string }>): void {
  const pieces = items.map(item => ({ ...item, textW: Math.max(28, Array.from(item.name).length * 13) }))
  const total = pieces.reduce((sum, item) => sum + 16 + item.textW, 0) + Math.max(0, pieces.length - 1) * 16
  let cursor = element.bounds.x + (element.bounds.w - total) / 2
  const rowY = element.bounds.y + element.bounds.h - 22
  pieces.forEach((item, index) => {
    slide.addShape(pres.ShapeType.rect, {
      x: inches(cursor),
      y: inches(rowY + 2),
      w: inches(12),
      h: inches(12),
      fill: { color: item.color },
      line: { color: item.color, pt: 0 },
      objectName: `${element.id}-legend-swatch-${index}`,
    })
    addCallout(slide, item.name, cursor + 16, rowY, item.textW, 16, face, ink, `${element.id}-legend-${index}`, false, 'left')
    cursor += 16 + item.textW + 16
  })
}

/** The preview paints scatter category ticks at 9pt black and ignores the axis text style. */
function addScatterCategoryTicks(pres: PptxGenJS, slide: PptxGenJS.Slide, element: DeckElement, scale: AxisScale, face: string, color: string, background: string): void {
  const plot = plotBox('scatter', false, element.bounds)
  if (!(scale.max > scale.min)) return
  // Cover only the band under the axis. The value-axis zero sits on the spine and must stay visible.
  slide.addShape(pres.ShapeType.rect, {
    x: inches(plot.x - 8),
    y: inches(plot.y + plot.h + 2),
    w: inches(plot.w + 16),
    h: inches(18),
    fill: { color: background },
    line: { color: background, pt: 0 },
    objectName: `${element.id}-xtick-cover`,
  })
  axisTicks(scale).forEach((value, index) => {
    const text = formatTick(value)
    const boxW = Math.max(22, text.length * 8)
    const x = plot.x + ((value - scale.min) / (scale.max - scale.min)) * plot.w - boxW / 2
    addCallout(slide, text, x, plot.y + plot.h + 3, boxW, 16, face, color, `${element.id}-xtick-${index}`, false)
  })
}

function addBubbleOverlay(
  pres: PptxGenJS,
  slide: PptxGenJS.Slide,
  element: DeckElement,
  chart: ChartSpec,
  paint: {
    background: string
    ink: string
    face: string
    axis: string
    grid: string
    tickColor: string
    colors: string[]
    xScale: AxisScale
    yScale: AxisScale
    legend: boolean
  },
): void {
  const plot = plotBox('bubble', paint.legend, element.bounds)
  const xSpan = paint.xScale.max - paint.xScale.min
  const ySpan = paint.yScale.max - paint.yScale.min
  if (!(xSpan > 0) || !(ySpan > 0)) return
  const xOf = (value: number) => plot.x + ((value - paint.xScale.min) / xSpan) * plot.w
  const yOf = (value: number) => plot.y + plot.h - ((value - paint.yScale.min) / ySpan) * plot.h
  const paper = {
    fill: { color: paint.background },
    line: { color: paint.background, pt: 0 },
  }
  slide.addShape(pres.ShapeType.rect, {
    ...paper,
    x: inches(plot.x - 2),
    y: inches(plot.y - 10),
    w: inches(plot.w + 8),
    h: inches(plot.h + 28),
    objectName: `${element.id}-plot-cover`,
  })
  slide.addShape(pres.ShapeType.rect, {
    ...paper,
    x: inches(element.bounds.x),
    y: inches(plot.y - 10),
    w: inches(Math.max(8, plot.x - element.bounds.x)),
    h: inches(plot.h + 20),
    objectName: `${element.id}-ytick-cover`,
  })
  for (const value of axisTicks(paint.yScale)) {
    const y = yOf(value)
    addLeader(pres, slide, plot.x, y, plot.x + plot.w, y, paint.grid, `${element.id}-grid-y-${formatTick(value)}`, 0.75)
  }
  for (const value of axisTicks(paint.xScale)) {
    const x = xOf(value)
    addLeader(pres, slide, x, plot.y, x, plot.y + plot.h, paint.grid, `${element.id}-grid-x-${formatTick(value)}`, 0.75)
  }
  addLeader(pres, slide, plot.x, plot.y, plot.x, plot.y + plot.h, paint.axis, `${element.id}-axis-y`, 0.75)
  addLeader(pres, slide, plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, paint.axis, `${element.id}-axis-x`, 0.75)
  chart.series.forEach((series, seriesIndex) => {
    const color = paint.colors[seriesIndex] ?? paint.ink
    series.values.forEach((value, index) => {
      const x = series.x?.[index]
      const size = series.sizes?.[index]
      if (!Number.isFinite(value) || x === undefined || !Number.isFinite(x) || !size || size <= 0) return
      const radius = Math.max(5, (11.3 + 0.8 * size) * (plot.w / 878))
      slide.addShape(pres.ShapeType.ellipse, {
        x: inches(xOf(x) - radius),
        y: inches(yOf(value) - radius),
        w: inches(radius * 2),
        h: inches(radius * 2),
        fill: { color, transparency: 40 },
        line: { color, pt: 0 },
        objectName: `${element.id}-bubble-${seriesIndex}-${index}`,
      })
    })
  })
  axisTicks(paint.yScale).forEach((value, index) => {
    const text = formatTick(value)
    addCallout(slide, text, plot.x - 36, yOf(value) - 8, 30, 16, paint.face, paint.tickColor, `${element.id}-ytick-${index}`, false, 'right')
  })
  axisTicks(paint.xScale).forEach((value, index) => {
    const text = formatTick(value)
    const boxW = Math.max(22, text.length * 8)
    addCallout(slide, text, xOf(value) - boxW / 2, plot.y + plot.h + 4, boxW, 16, paint.face, paint.tickColor, `${element.id}-xtick-${index}`, false)
  })
  if (paint.legend) addSwatchLegend(pres, slide, element, paint.face, paint.ink, chart.series.map((series, index) => ({ name: series.name, color: paint.colors[index] ?? paint.ink })))
}

/** The preview hardcodes radar value labels at 8pt, on top of the filled polygon. */
function addRadarValueLabels(pres: PptxGenJS, slide: PptxGenJS.Slide, element: DeckElement, chart: ChartSpec, legend: boolean, face: string, color: string, background: string, ink: string, colors: string[]): void {
  const plot = plotBox('radar', legend, element.bounds)
  const scale = chartValueScale({ ...chart, valMin: chart.valMin ?? 0 }, chart.series.flatMap(series => series.values), false)
  const span = scale.max - scale.min
  if (!(span > 0)) return
  const cx = plot.x + plot.w / 2
  const cy = plot.y + plot.h * 0.611
  const radius = plot.h * 0.457
  for (const value of axisTicks(scale)) {
    if (value <= scale.min) continue
    const y = cy - ((value - scale.min) / span) * radius
    const text = formatTick(value)
    const boxW = 16
    const boxH = 14
    const x = cx + 7
    slide.addShape(pres.ShapeType.rect, {
      x: inches(x - 1),
      y: inches(y - boxH / 2),
      w: inches(boxW + 2),
      h: inches(boxH),
      fill: { color: background },
      line: { color: background, pt: 0 },
      objectName: `${element.id}-valtick-chip-${text}`,
    })
    addCallout(slide, text, x, y - boxH / 2, boxW, boxH, face, color, `${element.id}-valtick-${text}`, false, 'left')
  }
  if (!legend) return
  addSwatchLegend(pres, slide, element, face, ink, chart.series.map((series, index) => ({
    name: series.name,
    color: colors[index] ?? ink,
  })))
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
  if (chart.kind === 'combo') {
    next = polishComboLines(next, chart)
    next = polishComboAxes(next)
  }
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
    // The preview ignores per-point deletes and paints showVal at the plot edge, which clips 8 and 9.
    return series
      .replace('<c:dLbls>', `<c:dLbls>${labels}`)
      .replace(/<c:showVal val="[01]"\/>/g, '<c:showVal val="0"/>')
  }))
}

/** The secondary value axis otherwise crosses a category axis that was never written. */
function polishComboAxes(xml: string): string {
  const bar = xml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)
  const cat = bar?.[0].match(/<c:axId val="(\d+)"\/>/)
  if (!cat) return xml
  const catId = cat[1]
  return xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, block => {
    if (!block.includes('<c:axPos val="r"/>')) return block
    const next = block.replace(/<c:crossAx val="\d+"\/>/, `<c:crossAx val="${catId}"/>`)
    return next.includes('<c:crossBetween')
      ? next.replace(/<c:crossBetween val="[^"]+"\/>/, '<c:crossBetween val="between"/>')
      : next.replace('</c:valAx>', '<c:crossBetween val="between"/></c:valAx>')
  })
}

function polishKeyLabels(xml: string, chart: ChartSpec): string {
  let index = 0
  return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => {
    const values = chart.series[index]?.values ?? []
    index += 1
    const keep = new Set(keyIndexes(values))
    const last = values.length - 1
    // Labels centered on either end sit on the frame. Those points are redrawn inside the plot.
    const labels = values.map((_, point) => keep.has(point) && point !== 0 && point !== last ? '' : deletedLabel(point)).join('')
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
