import { checkDeck } from './check.ts'
import { contrastRatio, luminance } from './contrast.ts'
import type { Deck, DeckElement, Theme } from './types.ts'
import { DECK_FORMAT, DECK_VERSION } from './types.ts'

const HEX = /^#[0-9A-Fa-f]{6}$/

export type BrandThemeInput = {
  id?: string
  name: string
  primary: string
  secondary: string
  logo?: string
}

const SANS = {
  cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
  latin: { mac: 'Arial', win: 'Arial', linux: 'Arial' },
}

/** Replace the deck theme. Page colors stay as tokens, so any theme can restyle a locked layout. */
export function applyTheme(deck: Deck, theme: Theme): Deck {
  return {
    ...deck,
    theme: {
      ...theme,
      colors: { ...theme.colors },
      fonts: {
        cjk: { ...theme.fonts.cjk },
        latin: { ...theme.fonts.latin },
      },
      type: {
        display: { ...theme.type.display },
        title: { ...theme.type.title },
        body: { ...theme.type.body },
        caption: { ...theme.type.caption },
      },
    },
  }
}

/**
 * Build contrast-safe tokens from a primary and secondary color.
 * Paper stays light unless both inputs are already a dark field.
 * `logo` is stored and not drawn until a page image uses that path.
 */
export function generateBrandTheme(input: BrandThemeInput): Theme {
  const primary = normalizeHex(input.primary, 'primary')
  const secondary = normalizeHex(input.secondary, 'secondary')
  const darkField = luminance(primary) < 0.16 && luminance(secondary) < 0.28
  const paper = darkField ? darkPaper(primary) : lightPaper(primary)
  const ink = darkField
    ? paintUntil('#F4F1EA', paper, 4.5)
    : paintUntil(luminance(primary) < 0.25 ? primary : secondary, paper, 4.5)
  const accentSource = contrastRatio(secondary, paper) >= 3 ? secondary : primary
  const muted = paintUntil(mix(ink, paper, 0.42), paper, 4.5)
  let surface = mix(paper, ink, darkField ? 0.14 : 0.06)
  if (contrastRatio(ink, surface) < 4.5) surface = mix(paper, ink, 0.03)
  const accent = paintOn(accentSource, [paper, surface], 3)
  const line = mix(paper, muted, 0.4)
  const inverse = contrastingInk(accent, paper, ink)
  const signal = paintUntil(contrastRatio(primary, paper) >= 3 ? primary : secondary, paper, 3)
  const id = (input.id?.trim() || slug(input.name) || 'brand')
  return {
    id,
    name: input.name.trim() || id,
    margin: 48,
    colors: {
      ink: ink.toUpperCase(),
      paper: paper.toUpperCase(),
      muted: muted.toUpperCase(),
      accent: accent.toUpperCase(),
      line: line.toUpperCase(),
      surface: surface.toUpperCase(),
      inverse: inverse.toUpperCase(),
      signal: signal.toUpperCase(),
      good: status('good', paper),
      watch: status('watch', paper),
      bad: status('bad', paper),
    },
    fonts: SANS,
    type: {
      display: { min: 32, max: 72 },
      title: { min: 22, max: 40 },
      body: { min: 14, max: 22 },
      caption: { min: 10, max: 14 },
    },
    source: `用户品牌：主色 ${primary.toUpperCase()}，辅色 ${secondary.toUpperCase()}`,
    logo: input.logo?.trim() || undefined,
  }
}

/**
 * Probe page: body ink, caption muted, inverse on the accent panel,
 * and 16pt bold accent used as text on both paper and a surface card.
 * Style reference pages put accent numbers in both of those places.
 */
export function checkTheme(theme: Theme): ReturnType<typeof checkDeck> {
  const deck: Deck = {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: theme.name,
    canvas: { width: 960, height: 540 },
    theme,
    pages: [
      {
        id: 'probe',
        layout: 'theme-probe',
        background: '$paper',
        elements: [
          probeText('ink', '正文颜色需要能读完', 48, 48, 420, 36, 18, '$ink'),
          probeText('muted', '辅助颜色需要分开', 48, 100, 420, 28, 16, '$muted'),
          {
            id: 'accent',
            type: 'shape',
            shape: 'rect',
            role: 'panel',
            bounds: { x: 48, y: 160, w: 280, h: 72 },
            fill: '$accent',
          },
          probeText('inverse', '强调上的字', 64, 176, 248, 40, 18, '$inverse', 'bold'),
          {
            id: 'surface',
            type: 'shape',
            shape: 'rect',
            role: 'panel',
            bounds: { x: 400, y: 160, w: 280, h: 72 },
            fill: '$surface',
          },
          probeText('on-surface', '面板上的正文', 416, 176, 248, 40, 16, '$ink'),
          probeText('accent-paper', '01', 48, 268, 120, 28, 16, '$accent', 'bold'),
          {
            id: 'accent-card',
            type: 'shape',
            shape: 'rect',
            role: 'panel',
            bounds: { x: 200, y: 252, w: 160, h: 60 },
            fill: '$surface',
          },
          probeText('accent-on-card', '01', 224, 268, 112, 28, 16, '$accent', 'bold'),
        ],
      },
    ],
  }
  return checkDeck(deck)
}

function probeText(id: string, text: string, x: number, y: number, w: number, h: number, size: number, color: string, weight?: 'bold'): DeckElement {
  return {
    id,
    type: 'text',
    bounds: { x, y, w, h },
    text,
    textCapacity: { maxChars: Array.from(text).length, maxLines: 1 },
    font: { family: '$cjk', size, weight, color, align: 'left', valign: 'middle' },
  }
}

function normalizeHex(value: string, label: string): string {
  const hex = value.trim().toUpperCase()
  if (!HEX.test(hex)) throw new Error(`${label} 必须是 #RRGGBB`)
  return hex
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgb(r: number, g: number, b: number): string {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase()
}

function mix(a: string, b: string, t: number): string {
  const left = channels(a)
  const right = channels(b)
  return rgb(
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  )
}

function lighten(hex: string, t: number): string {
  return mix(hex, '#FFFFFF', t)
}

function darken(hex: string, t: number): string {
  return mix(hex, '#000000', t)
}

/** Move one step at a time until the color clears `minimum` on every background. */
function paintOn(start: string, backgrounds: string[], minimum: number): string {
  const ok = (color: string) => backgrounds.every(background => contrastRatio(color, background) + 0.02 >= minimum)
  if (ok(start)) return start
  const towardDark = backgrounds.every(background => luminance(background) >= 0.5)
  const first = towardDark ? (color: string) => darken(color, 0.08) : (color: string) => lighten(color, 0.08)
  const second = towardDark ? (color: string) => lighten(color, 0.08) : (color: string) => darken(color, 0.08)
  for (const step of [first, second]) {
    let cursor = start
    for (let index = 0; index < 32; index++) {
      cursor = step(cursor)
      if (ok(cursor)) return cursor
    }
  }
  return towardDark ? '#141414' : '#F5F5F5'
}

function paintUntil(start: string, background: string, minimum: number): string {
  if (contrastRatio(start, background) + 0.02 >= minimum) return start
  let darker = start
  let lighter = start
  for (let step = 0; step < 28; step++) {
    darker = darken(darker, 0.1)
    lighter = lighten(lighter, 0.1)
    const darkOk = contrastRatio(darker, background) + 0.02 >= minimum
    const lightOk = contrastRatio(lighter, background) + 0.02 >= minimum
    if (darkOk && lightOk) return luminance(darker) < luminance(background) ? darker : lighter
    if (darkOk) return darker
    if (lightOk) return lighter
  }
  return luminance(background) > 0.5 ? '#141414' : '#F5F5F5'
}

function lightPaper(primary: string): string {
  const tinted = luminance(primary) > 0.45 ? mix('#F7F5F1', primary, 0.08) : '#F7F5F1'
  return luminance(tinted) < 0.82 ? '#F7F5F1' : tinted
}

function darkPaper(primary: string): string {
  let paper = luminance(primary) < 0.05 ? lighten(primary, 0.08) : darken(primary, 0.2)
  paper = paintUntil(paper, '#F5F5F5', 4.5)
  return paper
}

function contrastingInk(accent: string, paper: string, ink: string): string {
  const prefer = contrastRatio(paper, accent) >= contrastRatio(ink, accent) ? paper : ink
  return paintUntil(prefer, accent, 4.5)
}

function status(kind: 'good' | 'watch' | 'bad', paper: string): string {
  const seed = kind === 'good' ? '#2E7D5B' : kind === 'watch' ? '#B7791F' : '#B4342C'
  return paintUntil(seed, paper, 3).toUpperCase()
}
