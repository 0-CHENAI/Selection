/** Selection deck format. 960×540 pt is the 16:9 slide (13.333×7.5 in). */

export const DECK_FORMAT = 'selection-deck' as const
export const DECK_VERSION = 1 as const
/** Version 2 is the import project. Version 1 files stay valid and do not gain these fields. */
export type DeckVersion = 1 | 2

export type DeckSource = {
  kind: 'import' | 'template-project' | 'authored'
  fileName?: string
  sha256?: string
}

export type DeckLayoutRef = {
  master?: string
  layout?: string
}

export type DeckCrop = { l: number; t: number; r: number; b: number }

export type DeckMask = {
  shape: 'rect' | 'roundRect' | 'ellipse' | 'path'
  path?: string
}

export type DeckTextRun = {
  text: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
}

/** Route B. Present only on objects the project must not restyle. */
export type DeckRetained = {
  feature: string
  message: string
}

/** Same field meanings as a notes JSON blob `dsh.template-images/v1`. */
export type ImageSlotContract = {
  schema: 'dsh.template-images/v1'
  layoutId: string
  pageRole: string
  style: {
    medium: string
    palette: string
    lighting: string
    tone: string
    textTreatment: string
    continuity: string
  }
  contentPolicy?: 'provided-facts-or-qualitative'
  slots: ImageSlot[]
}

export type ImageSlot = {
  elementId: string
  role: string
  contentSources: string[]
  sourcePolicy: 'contextual-scene' | 'provided-portrait' | 'native-graphic'
  subject: string
  composition: string
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  reuseGroup: string
  maskElementIds: string[]
}
export const CANVAS_WIDTH = 960
export const CANVAS_HEIGHT = 540

/** Point sizes for the canvases ppt-master layouts use. 1 px at 96 dpi is 0.75 pt. */
export const CANVAS_PRESETS = [
  { id: 'ppt169', label: '16:9', width: 960, height: 540 },
  { id: 'ppt43', label: '4:3', width: 768, height: 576 },
  { id: 'moments', label: '1:1', width: 810, height: 810 },
  { id: 'story', label: '9:16', width: 810, height: 1440 },
  { id: 'xiaohongshu', label: '3:4', width: 931.5, height: 1245 },
] as const

export type CanvasPresetId = (typeof CANVAS_PRESETS)[number]['id']

export function canvasBySize(width: number, height: number): (typeof CANVAS_PRESETS)[number] | null {
  return CANVAS_PRESETS.find(item => Math.abs(item.width - width) < 0.2 && Math.abs(item.height - height) < 0.2) ?? null
}

/** Preset sizes, plus the other canvases in the ppt-master examples (A4, banners, 1920×1080). */
export function canvasSupported(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  if (canvasBySize(width, height)) return true
  return width >= 200 && height >= 200 && width <= 2000 && height <= 2000
}

export type PlatformName = 'mac' | 'win' | 'linux'

export type Bounds = { x: number; y: number; w: number; h: number }

export type TextCapacity = { maxChars: number; maxLines: number }

export type FontPair = { mac: string; win: string; linux: string }

export type TypeRange = { min: number; max: number }

export type Theme = {
  id: string
  name: string
  margin: number
  colors: Record<string, string>
  fonts: { cjk: FontPair; latin: FontPair }
  type: { display: TypeRange; title: TypeRange; body: TypeRange; caption: TypeRange }
  /** Where the palette, type scale, and layout idea came from. */
  source: string
  /** Optional user logo path. The deck draws it only from an image whose src is this path. */
  logo?: string
}

export type ShapeName = 'rect' | 'roundRect' | 'ellipse' | 'line' | 'path'

export type ColorStop = { offset: number; color: string }

/** 0° points to the right and increases clockwise, matching SVG user space (y down). */
export type GradientFill = {
  kind: 'linear' | 'radial'
  angle?: number
  stops: ColorStop[]
  cx?: number
  cy?: number
  /** When true, the angle is absolute (OOXML lin scaled="0"). Otherwise it follows the shape box. */
  absolute?: boolean
}

/** PowerPoint preset pattern, used for paper grain and halftone. */
export type PatternFill = {
  preset: string
  foreground: string
  background: string
}

export type ShadowSpec = {
  color: string
  opacity?: number
  blur?: number
  offset?: number
  angle?: number
}
export type ElementRole = 'panel' | 'rule' | 'decoration' | 'content'
export type FontFamilyToken = '$cjk' | '$latin'
export type TextAlign = 'left' | 'center' | 'right'
export type TextValign = 'top' | 'middle' | 'bottom'
export type LineStyle = 'solid' | 'dash' | 'dot'
export type LineArrow = 'start' | 'end' | 'both'

/** Latin face plus the CJK face for each platform. Names only; no font files. */
export type FontFace = {
  latin: string
  cjk: FontPair
}

export type ChartKind = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'waterfall' | 'area' | 'scatter' | 'bubble' | 'radar' | 'combo' | 'stacked' | 'stackedPercent'
export type GridStyle = 'solid' | 'dash' | 'dot' | 'none'
export type ChartSeriesRender = 'column' | 'line'

export type ChartSeries = {
  name: string
  values: number[]
  /** Scatter and bubble X coordinates. Every series on the chart shares this list. */
  x?: number[]
  /** Bubble sizes. Positive, one per category. */
  sizes?: number[]
  /** Combo series drawn as columns or a line. Omit and the last series is the line. */
  render?: ChartSeriesRender
}

/** Last series is the line when no series sets `render`. An explicit render wins. */
export function comboSeriesRoles(series: ChartSeries[]): ChartSeriesRender[] {
  const explicit = series.some(item => item.render)
  return series.map((item, index) => item.render ?? (explicit || index < series.length - 1 ? 'column' : 'line'))
}

export type ChartSpec = {
  kind: ChartKind
  categories: string[]
  series: ChartSeries[]
  /** Token (`$accent`), `#RRGGBB`, or `#RRGGBBAA`. Waterfall uses background, increase, decrease. The total is `$ink`. */
  colors?: string[]
  showValues?: boolean
  showLegend?: boolean
  /** Value axis. Omit to start bars and columns at 0. */
  valMin?: number
  valMax?: number
  /** Doughnut hole as a percent of the diameter. */
  holeSize?: number
  lineWidth?: number
  markerSize?: number
  markerColor?: string
  grid?: GridStyle
  catLabelSize?: number
  valLabelSize?: number
  catLabelColor?: string
  valLabelColor?: string
}

export type TableCell = {
  text: string
  bold?: boolean
  fill?: string
  color?: string
  align?: TextAlign
}

export type TableSpec = {
  /** Column widths as fractions of the table width. */
  columns: number[]
  /** Row heights in points. Omit to split the table height evenly. */
  rowHeights?: number[]
  rows: TableCell[][]
  fontSize: number
  fontFamily: FontFamilyToken
  face?: FontFace
  color: string
  fill: string
  border: { color: string; width: number }
  header?: { bold?: boolean; color?: string; fill?: string }
}

export type LineSpec = {
  color: string
  width: number
  style?: LineStyle
  /** Endpoints relative to the element bounds. */
  points?: { x1: number; y1: number; x2: number; y2: number }
}

/** A chart drawn by an installed external skill and placed as a picture. */
export type ChartImageSpec = {
  skill: string
  format: 'svg' | 'png'
  /** Original data table. The same text belongs in the page notes. */
  data: string
}

export type DeckElement = {
  id: string
  type: 'text' | 'shape' | 'image' | 'chart' | 'table'
  bounds: Bounds
  role?: ElementRole
  /** Clockwise degrees. Rotates around the center of bounds. */
  rotate?: number
  text?: string
  textCapacity?: TextCapacity
  font?: {
    family: FontFamilyToken
    size: number
    weight?: 'regular' | 'bold'
    italic?: boolean
    /** Arabic and Hebrew paragraphs. The box is still positioned from the SVG anchor. */
    rtl?: boolean
    color?: string
    align?: TextAlign
    valign?: TextValign
    /** Exact line spacing as a multiple of font size. */
    leading?: number
    tracking?: number
    /** Per-element faces. Latin and CJK are written as separate PPT runs. */
    face?: FontFace
  }
  shape?: ShapeName
  /** Token, `#RRGGBB`, or `#RRGGBBAA`. Omitted on rules. */
  fill?: string
  line?: LineSpec
  /** Corner radius in points for roundRect. */
  radius?: number
  /** SVG path in the element's own box, origin at the top-left, units in points. */
  path?: string
  /** `evenodd` punches holes. The default is the nonzero winding rule. */
  pathRule?: 'evenodd' | 'nonzero'
  gradient?: GradientFill
  pattern?: PatternFill
  shadow?: ShadowSpec
  /** `fill` stretches the bitmap to the box. `contain` keeps the aspect ratio. */
  fit?: 'fill' | 'contain'
  /** Triangle arrow on a line. */
  arrow?: LineArrow
  src?: string
  alt?: string
  chart?: ChartSpec
  /** Present when this image is a chart from an external skill. */
  chartImage?: ChartImageSpec
  table?: TableSpec
  /** Set when this shape was expanded out of a group. */
  group?: { id: string }
  crop?: DeckCrop
  mask?: DeckMask
  link?: { href: string }
  runs?: DeckTextRun[]
  retained?: DeckRetained
}

export type DeckPage = {
  id: string
  layout: string
  name?: string
  background: string
  elements: DeckElement[]
  notes?: string
  layoutRef?: DeckLayoutRef
  /** Same contract as a notes JSON blob. Optional so version 1 pages stay unchanged. */
  imageSlots?: ImageSlotContract
}

export type Deck = {
  format: typeof DECK_FORMAT
  version: DeckVersion
  /** Import provenance. Omitted on version 1. */
  source?: DeckSource
  title: string
  canvas: { width: number; height: number }
  theme: Theme
  pages: DeckPage[]
  /**
   * `example` is a converted reference deck. Contrast, orphan and the advisory
   * composition warnings are skipped because the pages were already published;
   * schema, capacity, and bounds still run.
   */
  profile?: 'authored' | 'example'
}

export type IssueCode =
  | 'schema'
  | 'out_of_bounds'
  | 'overlap'
  | 'over_capacity'
  | 'contrast'
  | 'orphan'
  | 'literal_newline'
  | 'adjacent_layout'
  | 'layout_repetition'
  | 'cover_focus'
  | 'chart_data'
  | 'chart_series_color'
  | 'image_fit'
  | 'image_crop'
  | 'remote_image'
  | 'missing_asset'
  | 'empty_picture_slot'
  | 'text_drift'
  | 'text_occlusion'
  | 'unreconciled'
  | 'font'

export type IssueSeverity = 'error' | 'warning'

export type DeckIssue = {
  code: IssueCode
  pageId?: string
  elementId?: string
  message: string
  /** Omitted issues are errors. Warnings do not block export. */
  severity?: IssueSeverity
}

export type RenderStatus = 'ok' | 'needs_revision' | 'error'

export type ScreenshotResult = {
  available: boolean
  renderer?: 'officecli' | 'libreoffice'
  files: string[]
  reason?: string
}
