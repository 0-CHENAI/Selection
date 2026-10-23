function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const raw = hex.replace('#', '').slice(0, 6)
  const n = Number.parseInt(raw, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG AA: 4.5 for body, 3.0 for large text (24pt, or 18pt bold). */
export function contrastMinimum(fontSize: number, bold: boolean): number {
  if (fontSize >= 24 || (bold && fontSize >= 18)) return 3
  return 4.5
}

/** `#RRGGBB` plus 0–1 alpha. Eight-digit colors use the last byte as alpha. */
export function splitColor(hex: string): { rgb: string; alpha: number } {
  const raw = hex.replace('#', '')
  const rgb = `#${raw.slice(0, 6).toUpperCase()}`
  if (raw.length >= 8) return { rgb, alpha: Number.parseInt(raw.slice(6, 8), 16) / 255 }
  return { rgb, alpha: 1 }
}

/** Porter-Duff source-over. The result is opaque `#RRGGBB`. */
export function composite(over: string, under: string): string {
  const src = splitColor(over)
  const dst = splitColor(under)
  if (src.alpha >= 0.999) return src.rgb
  if (src.alpha <= 0.001) return dst.rgb
  const mix = (a: number, b: number) => Math.round(a * src.alpha + b * (1 - src.alpha))
  const left = channels(src.rgb)
  const right = channels(dst.rgb)
  return '#' + [mix(left.r, right.r), mix(left.g, right.g), mix(left.b, right.b)].map(channelByte => channelByte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function channels(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
