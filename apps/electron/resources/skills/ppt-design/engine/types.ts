/** Selection deck format. 960×540 pt is the 16:9 slide (13.333×7.5 in). */

export const DECK_FORMAT = 'selection-deck' as const
export const DECK_VERSION = 1 as const
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

export type ChartKind = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'waterfall'
export type GridStyle = 'solid' | 'dash' | 'dot' | 'none'

export type ChartSpec = {
  kind: ChartKind
  categories: string[]
  series: { name: string; values: number[] }[]
  /** Token (`$accent`), `#RRGGBB`, or `#RRGGBBAA`. Waterfall uses background, up, down. */
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
  table?: TableSpec
}

export type DeckPage = {
  id: string
  layout: string
  name?: string
  background: string
  elements: DeckElement[]
  notes?: string
}

export type Deck = {
  format: typeof DECK_FORMAT
  version: typeof DECK_VERSION
  title: string
  canvas: { width: number; height: number }
  theme: Theme
  pages: DeckPage[]
  /**
   * `example` is a converted reference deck. Contrast and orphan checks are skipped
   * because the pages were already published; schema, capacity, and bounds still run.
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
  | 'unreconciled'
  | 'font'

export type DeckIssue = {
  code: IssueCode
  pageId?: string
  elementId?: string
  message: string
}

export type RenderStatus = 'ok' | 'needs_revision' | 'error'

export type ScreenshotResult = {
  available: boolean
  renderer?: 'officecli' | 'libreoffice'
  files: string[]
  reason?: string
}
