import { defaultLeading } from '../engine/metrics.ts'
import { CANVAS_HEIGHT, CANVAS_WIDTH, DECK_FORMAT, DECK_VERSION, type ChartSpec, type Deck, type DeckElement, type DeckPage, type TextCapacity, type Theme } from '../engine/types.ts'

/** Small theme for engine tests. Not a shipped style. */
export const fixtureTheme: Theme = {
  id: 'fixture',
  name: 'Fixture',
  margin: 48,
  colors: {
    ink: '#111111',
    paper: '#F5F3EE',
    muted: '#5C5A55',
    accent: '#C41628',
    line: '#CBC8C0',
    surface: '#E8E5DE',
    inverse: '#FFFFFF',
  },
  fonts: {
    cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
    latin: { mac: 'Helvetica Neue', win: 'Arial', linux: 'Noto Sans' },
  },
  type: {
    display: { min: 44, max: 84 },
    title: { min: 28, max: 36 },
    body: { min: 16, max: 22 },
    caption: { min: 11, max: 14 },
  },
  source: 'Test fixture. Not a shipped presentation style.',
}

type TextOpts = {
  color?: string
  bold?: boolean
  family?: '$cjk' | '$latin'
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  leading?: number
  tracking?: number
}

export function text(id: string, value: string, x: number, y: number, w: number, h: number, size: number, opts: TextOpts = {}): DeckElement {
  const leading = opts.leading ?? defaultLeading(size)
  const bold = opts.bold ?? false
  return {
    id,
    type: 'text',
    bounds: { x, y, w, h },
    text: value,
    textCapacity: capacity(value, w, h, size, leading),
    font: {
      family: opts.family ?? '$cjk',
      size,
      weight: bold ? 'bold' : 'regular',
      color: opts.color ?? '$ink',
      align: opts.align,
      valign: opts.valign ?? 'top',
      leading,
      tracking: opts.tracking,
    },
  }
}

function capacity(value: string, width: number, height: number, size: number, leading: number): TextCapacity {
  const maxLines = Math.max(1, Math.floor((height + 0.5) / (size * leading)))
  const perLine = Math.max(1, Math.floor(width / size))
  const glyphs = Array.from(value.replaceAll('\n', '')).length
  return { maxChars: Math.max(glyphs, perLine * maxLines), maxLines }
}

export function panel(id: string, x: number, y: number, w: number, h: number, fill: string, role: 'panel' | 'decoration' = 'panel'): DeckElement {
  return { id, type: 'shape', shape: 'rect', role, bounds: { x, y, w, h }, fill }
}

export function rule(id: string, x: number, y: number, w: number, h: number, color = '$line', width = 1): DeckElement {
  return { id, type: 'shape', shape: 'line', role: 'rule', bounds: { x, y, w, h }, line: { color, width } }
}

export function chart(id: string, x: number, y: number, w: number, h: number, spec: ChartSpec): DeckElement {
  return { id, type: 'chart', role: 'content', bounds: { x, y, w, h }, chart: spec }
}

export function makeDeck(title: string, theme: Theme, pages: DeckPage[]): Deck {
  return { format: DECK_FORMAT, version: DECK_VERSION, title, canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }, theme, pages }
}

export function makePage(id: string, layout: string, name: string, background: string, elements: DeckElement[], notes: string): DeckPage {
  return { id, layout, name, background, elements, notes }
}

export type Chrome = {
  kicker: string
  title: string
  source: string
  pageNo: string
  ink?: string
  muted?: string
  accent?: string
  line?: string
}

/** Shared content-page furniture. Body region is y 122–476. */
export function chrome(frame: Chrome): DeckElement[] {
  const ink = frame.ink ?? '$ink'
  const muted = frame.muted ?? '$muted'
  const accent = frame.accent ?? '$accent'
  const line = frame.line ?? '$line'
  return [
    text('kicker', frame.kicker, 48, 26, 560, 20, 13, { bold: true, color: accent }),
    text('exhibit', `图示 ${frame.pageNo}`, 680, 26, 232, 20, 12, { color: muted, align: 'right' }),
    rule('top-rule', 48, 52, 864, 1, line, 1),
    text('title', frame.title, 48, 62, 864, 46, 32, { bold: true, color: ink }),
    rule('footer-rule', 48, 488, 864, 1, line, 1),
    text('source', frame.source, 48, 500, 740, 24, 12, { color: muted }),
    text('page-no', frame.pageNo, 820, 500, 92, 24, 12, { bold: true, color: ink, align: 'right', family: '$latin' }),
  ]
}
