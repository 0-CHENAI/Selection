/** Selection deck format. 960×540 pt is the 16:9 slide (13.333×7.5 in). */

export const DECK_FORMAT = 'selection-deck' as const
export const DECK_VERSION = 1 as const
export const CANVAS_WIDTH = 960
export const CANVAS_HEIGHT = 540

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
}

export type ShapeName = 'rect' | 'roundRect' | 'ellipse' | 'line'
export type ElementRole = 'panel' | 'rule' | 'decoration' | 'content'
export type FontFamilyToken = '$cjk' | '$latin'
export type TextAlign = 'left' | 'center' | 'right'
export type TextValign = 'top' | 'middle' | 'bottom'

export type ChartKind = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'waterfall'

export type ChartSpec = {
  kind: ChartKind
  categories: string[]
  series: { name: string; values: number[] }[]
  /** Token (`$accent`) or `#RRGGBB`. Waterfall uses background, up, down. */
  colors?: string[]
  showValues?: boolean
  showLegend?: boolean
}

export type DeckElement = {
  id: string
  type: 'text' | 'shape' | 'image' | 'chart'
  bounds: Bounds
  role?: ElementRole
  text?: string
  textCapacity?: TextCapacity
  font?: {
    family: FontFamilyToken
    size: number
    weight?: 'regular' | 'bold'
    color?: string
    align?: TextAlign
    valign?: TextValign
    /** Exact line spacing as a multiple of font size. */
    leading?: number
    tracking?: number
  }
  shape?: ShapeName
  /** Token or hex. Omitted on rules. */
  fill?: string
  line?: { color: string; width: number }
  /** Corner radius in points for roundRect. */
  radius?: number
  /** Draw a triangle at the end of a rule. */
  arrow?: 'end'
  src?: string
  alt?: string
  chart?: ChartSpec
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
  canvas: { width: typeof CANVAS_WIDTH; height: typeof CANVAS_HEIGHT }
  theme: Theme
  pages: DeckPage[]
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
