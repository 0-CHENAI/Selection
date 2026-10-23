function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const raw = hex.replace('#', '')
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
