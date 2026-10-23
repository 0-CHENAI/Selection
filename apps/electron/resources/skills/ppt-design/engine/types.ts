/** Selection Deck Document — 960×540 pt canvas, independently specified. */

export const CANVAS = { width: 960, height: 540, unit: 'pt' as const };
export const DECK_VERSION = 1 as const;

export type Bounds = readonly [x: number, y: number, w: number, h: number];

export type TextCapacity = {
  maxLines: number;
  maxCharsPerLine: number;
};

export type FontPair = {
  latin: string;
  cjk: string;
};

export type PlatformFonts = {
  darwin: FontPair;
  win32: FontPair;
  linux: FontPair;
};

export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  rule: string;
  inverse: string;
  wash: string;
};

export type TypeScale = {
  hero: number;
  title: number;
  heading: number;
  body: number;
  label: number;
  number: number;
  footer: number;
  caption: number;
};

export type Theme = {
  id: string;
  name: string;
  palette: Palette;
  fonts: { heading: PlatformFonts; body: PlatformFonts };
  type: TypeScale;
  margin: number;
};

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type FontRole = 'heading' | 'body';
export type TypeRole = keyof TypeScale;

export type TextStyle = {
  role?: TypeRole;
  font?: FontRole;
  size?: number;
  color?: string;
  weight?: 400 | 600 | 700;
  align?: TextAlign;
  valign?: VerticalAlign;
  lineHeight?: number;
  tracking?: number;
};

export type ShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'line';

export type ChartKind = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'waterfall';

export type ChartSeries = {
  name: string;
  values: number[];
  color?: string;
};

export type ChartSpec = {
  kind: ChartKind;
  categories: string[];
  series: ChartSeries[];
  showValues?: boolean;
  hideBase?: boolean;
};

export type TextElement = {
  id: string;
  type: 'text';
  bounds: Bounds;
  text: string;
  textCapacity: TextCapacity;
  style?: TextStyle;
  z?: number;
};

export type ShapeElement = {
  id: string;
  type: 'shape';
  bounds: Bounds;
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  z?: number;
};

export type ImageElement = {
  id: string;
  type: 'image';
  bounds: Bounds;
  path: string;
  alt: string;
  z?: number;
};

export type ChartElement = {
  id: string;
  type: 'chart';
  bounds: Bounds;
  chart: ChartSpec;
  z?: number;
};

export type DeckElement = TextElement | ShapeElement | ImageElement | ChartElement;

export const LAYOUT_IDS = [
  'cover',
  'conclusion',
  'evidence-tree',
  'matrix',
  'waterfall',
  'trend-callouts',
  'scorecard',
  'gantt',
  'architecture',
  'case-compare',
  'funnel',
  'closing',
] as const;

export type LayoutId = (typeof LAYOUT_IDS)[number];

export type Page = {
  id: string;
  layout: LayoutId;
  background?: string;
  notes?: string;
  source?: string;
  elements: DeckElement[];
};

export type Deck = {
  version: typeof DECK_VERSION;
  canvas: { width: 960; height: 540; unit: 'pt' };
  theme: Theme;
  pages: Page[];
  meta?: {
    title?: string;
    language?: 'zh' | 'en';
    attribution?: string;
  };
};

export type IssueCode =
  | 'schema'
  | 'out_of_bounds'
  | 'overlap'
  | 'over_capacity'
  | 'contrast'
  | 'orphan'
  | 'literal_newline'
  | 'adjacent_layout'
  | 'missing_image';

export type DeckIssue = {
  code: IssueCode;
  pageId: string;
  elementId?: string;
  message: string;
};

export type CheckReport = {
  ok: boolean;
  issues: DeckIssue[];
};

export type RenderResult =
  | { outcome: 'GENERATED_UNREVIEWED'; path: string; pages: number; style: string; visualReviewRequired: true }
  | { outcome: 'needs_revision'; issues: DeckIssue[] };
