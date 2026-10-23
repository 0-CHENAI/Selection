import type { Bounds, DeckElement, Page, Palette, ShapeElement, TextElement } from './types';

export function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '').trim();
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`invalid color ${color}`);
  }
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function normalizeHex(color: string, palette?: Palette): string {
  const raw = color.trim();
  if (raw.startsWith('#')) return raw.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  if (palette && raw in palette) return `#${(palette[raw as keyof Palette]).replace('#', '').toUpperCase()}`;
  throw new Error(`unresolved color token ${color}`);
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color.startsWith('#') ? color : `#${color}`);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function requiredContrast(fontSize: number, weight: number): number {
  return fontSize >= 24 || (fontSize >= 18.5 && weight >= 600) ? 3 : 4.5;
}

function containsPoint(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds[0] && x <= bounds[0] + bounds[2] && y >= bounds[1] && y <= bounds[1] + bounds[3];
}

export function backgroundBehind(page: Page, element: TextElement, pageBackground: string): string {
  const cx = element.bounds[0] + element.bounds[2] / 2;
  const cy = element.bounds[1] + element.bounds[3] / 2;
  let fill = pageBackground;
  let z = -1;
  page.elements.forEach((candidate, index) => {
    if (candidate.type !== 'shape' || candidate.shape === 'line') return;
    if (!candidate.fill || candidate.fill === 'none') return;
    if (!containsPoint(candidate.bounds, cx, cy)) return;
    const depth = candidate.z ?? index;
    if (depth >= z && (candidate.z ?? index) <= (element.z ?? page.elements.indexOf(element))) {
      z = depth;
      fill = candidate.fill;
    }
  });
  return fill;
}

export function isOpaqueFurniture(element: DeckElement): element is ShapeElement {
  return element.type === 'shape' && element.shape !== 'line' && Boolean(element.fill);
}
