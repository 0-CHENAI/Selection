/** How long the Max field fades in and out. Keep in sync with PromptBarEffects.css. */
export const EFFORT_FIELD_FADE_MS = 260

export type EffortRgb = readonly [number, number, number]

export interface EffortShaderTheme {
  ember: EffortRgb
  mid: EffortRgb
  core: EffortRgb
  track: EffortRgb
  heat: number
  exposure: number
  floor: number
  rise: number
  chroma: number
}

export const EFFORT_THEME_VARS = {
  heat: '--prompt-effort-heat',
  exposure: '--prompt-effort-exposure',
  floor: '--prompt-effort-floor',
  rise: '--prompt-effort-rise',
  chroma: '--prompt-effort-chroma',
} as const

const LIGHT_FALLBACK: EffortShaderTheme = {
  ember: [0.56, 0.44, 0.76],
  mid: [0.5, 0.36, 0.78],
  core: [0.78, 0.7, 0.9],
  track: [0.9, 0.88, 0.96],
  heat: 0.58,
  exposure: 0.8,
  floor: 0.05,
  rise: 0.2,
  chroma: 1,
}

const DARK_FALLBACK: EffortShaderTheme = {
  ember: [0.28, 0.1, 0.58],
  mid: [0.62, 0.32, 1],
  core: [1, 0.94, 0.98],
  track: [0.18, 0.14, 0.26],
  heat: 1.2,
  exposure: 1.1,
  floor: 0,
  rise: 0.12,
  chroma: 0,
}

export function effortThemeFallback(isDark: boolean): EffortShaderTheme {
  return isDark ? DARK_FALLBACK : LIGHT_FALLBACK
}

function srgbEncode(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
}

/** CSS Color 4 OKLab to encoded sRGB. Computed colors often come back as oklch. */
function oklabToSrgb(lightness: number, a: number, b: number): EffortRgb {
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s = lightness - 0.0894841775 * a - 1.2914855480 * b
  const l3 = l ** 3
  const m3 = m ** 3
  const s3 = s ** 3
  return [
    srgbEncode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    srgbEncode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    srgbEncode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3),
  ]
}

function component(raw: string): number {
  return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
}

/** Parse a color the browser already resolved, including oklch/oklab used values. */
export function parseCssColor(value: string): EffortRgb | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex?.[1]) {
    const raw = hex[1]
    const full = raw.length === 3 ? [...raw].map(channel => channel + channel).join('') : raw
    const bits = Number.parseInt(full, 16)
    return [(bits >> 16) / 255, ((bits >> 8) & 255) / 255, (bits & 255) / 255]
  }
  const srgb = /^color\(\s*srgb\s+([0-9.]+%?)\s+([0-9.]+%?)\s+([0-9.]+%?)/.exec(text)
  if (srgb?.[1] && srgb[2] && srgb[3]) return [component(srgb[1]), component(srgb[2]), component(srgb[3])]
  const oklch = /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([+-]?[0-9.]+)/.exec(text)
  if (oklch?.[1] && oklch[2] && oklch[3]) {
    const hue = Number(oklch[3]) * Math.PI / 180
    const chroma = Number(oklch[2])
    return oklabToSrgb(component(oklch[1]), Math.cos(hue) * chroma, Math.sin(hue) * chroma)
  }
  const oklab = /^oklab\(\s*([0-9.]+%?)\s+([+-]?[0-9.]+)\s+([+-]?[0-9.]+)/.exec(text)
  if (oklab?.[1] && oklab[2] && oklab[3]) return oklabToSrgb(component(oklab[1]), Number(oklab[2]), Number(oklab[3]))
  const rgb = /^rgba?\(\s*([0-9.]+)(%?)(?:[,\s/]+)([0-9.]+)(%?)(?:[,\s/]+)([0-9.]+)(%?)/.exec(text)
  if (!rgb?.[1] || !rgb[3] || !rgb[5]) return null
  const channel = (raw: string, percent: string | undefined) => {
    const amount = Number(raw)
    return percent ? amount / 100 : amount / 255
  }
  return [channel(rgb[1], rgb[2]), channel(rgb[3], rgb[4]), channel(rgb[5], rgb[6])]
}

let colorProbe: CanvasRenderingContext2D | null | undefined

/**
 * Resolve a computed color. Chrome keeps oklch in both getComputedStyle and
 * canvas fillStyle, so parse that directly and only sample pixels as a backup.
 */
export function resolveCssColor(value: string): EffortRgb | null {
  const direct = parseCssColor(value)
  if (direct) return direct
  const trimmed = value.trim()
  if (!trimmed || typeof document === 'undefined') return null
  if (colorProbe === undefined) colorProbe = document.createElement('canvas').getContext('2d')
  if (!colorProbe) return null
  const sentinel = '#010203'
  colorProbe.fillStyle = sentinel
  colorProbe.fillStyle = trimmed
  if (colorProbe.fillStyle === sentinel) return null
  colorProbe.clearRect(0, 0, 1, 1)
  colorProbe.fillRect(0, 0, 1, 1)
  const pixel = colorProbe.getImageData(0, 0, 1, 1).data
  if (!pixel || pixel[3] === 0) return null
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]
}

export function readEffortShaderTheme(style: Pick<CSSStyleDeclaration, 'color' | 'borderTopColor' | 'borderRightColor' | 'borderBottomColor' | 'getPropertyValue'>, isDark: boolean): EffortShaderTheme {
  const fallback = effortThemeFallback(isDark)
  const color = (value: string, backup: EffortRgb) => resolveCssColor(value) ?? backup
  const unit = (name: string, backup: number) => {
    const parsed = Number.parseFloat(style.getPropertyValue(name))
    return Number.isFinite(parsed) ? parsed : backup
  }
  return {
    ember: color(style.color, fallback.ember),
    mid: color(style.borderTopColor, fallback.mid),
    core: color(style.borderRightColor, fallback.core),
    track: color(style.borderBottomColor, fallback.track),
    heat: unit(EFFORT_THEME_VARS.heat, fallback.heat),
    exposure: unit(EFFORT_THEME_VARS.exposure, fallback.exposure),
    floor: unit(EFFORT_THEME_VARS.floor, fallback.floor),
    rise: unit(EFFORT_THEME_VARS.rise, fallback.rise),
    chroma: unit(EFFORT_THEME_VARS.chroma, fallback.chroma),
  }
}
