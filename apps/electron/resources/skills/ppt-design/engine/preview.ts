import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartMax, waterfallColumns } from './chart-model';
import { wrapLines } from './text';
import { resolveColor, resolveSize } from './tokens';
import type { ChartElement, Deck, DeckElement, Page, ShapeElement, TextElement } from './types';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** librsvg walks the stack; put actually-installed CJK faces first for Linux previews. */
export function previewFontFamily(): string {
  return [
    'WenQuanYi Micro Hei',
    'Droid Sans Fallback',
    'Noto Sans CJK SC',
    'PingFang SC',
    'Microsoft YaHei',
    'Helvetica Neue',
    'Noto Sans',
    'Segoe UI',
    'Arial',
    'sans-serif',
  ].map(name => (name === 'sans-serif' ? name : `'${name}'`)).join(', ');
}

function svgText(deck: Deck, element: TextElement): string {
  const size = resolveSize(deck.theme, element.style);
  const lineHeight = (element.style?.lineHeight ?? 1.18) * size;
  const color = resolveColor(deck.theme, element.style?.color ?? 'text');
  const weight = element.style?.weight ?? 400;
  const align = element.style?.align ?? 'left';
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const x = align === 'center' ? element.bounds[0] + element.bounds[2] / 2
    : align === 'right' ? element.bounds[0] + element.bounds[2] : element.bounds[0];
  const lines = wrapLines(element.text, element.bounds[2], size);
  const tracking = element.style?.tracking ? ` letter-spacing="${element.style.tracking}"` : '';
  const startY = element.bounds[1] + size * 0.92;
  const tspans = lines.map((line, index) => `<tspan x="${x}" y="${startY + index * lineHeight}">${esc(line)}</tspan>`).join('');
  return `<text fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${previewFontFamily()}"${tracking}>${tspans}</text>`;
}

function svgShape(deck: Deck, element: ShapeElement): string {
  const [x, y, w, h] = element.bounds;
  const fill = element.fill ? resolveColor(deck.theme, element.fill) : 'none';
  const stroke = element.stroke ? `stroke="${resolveColor(deck.theme, element.stroke)}" stroke-width="${element.strokeWidth ?? 0.8}"` : 'stroke="none"';
  if (element.shape === 'line') {
    return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${stroke} fill="none"/>`;
  }
  if (element.shape === 'ellipse') {
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" ${stroke}/>`;
  }
  const radius = element.shape === 'roundRect' ? 6 : 0;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" ${stroke}/>`;
}

function label(x: number, y: number, text: string, fill: string, size = 11, anchor = 'middle'): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="400" text-anchor="${anchor}" font-family="${previewFontFamily()}">${esc(text)}</text>`;
}

function svgChart(deck: Deck, element: ChartElement): string {
  const [x, y, w, h] = element.bounds;
  const spec = element.chart;
  const ink = resolveColor(deck.theme, 'text');
  const muted = resolveColor(deck.theme, 'muted');
  const accent = resolveColor(deck.theme, spec.series[0]?.color ?? 'accent');
  const labelBand = 18;
  const plotH = Math.max(24, h - labelBand);
  const max = chartMax(spec);
  const cats = spec.categories;
  const count = Math.max(1, cats.length);

  if (spec.kind === 'line') {
    const raw = spec.series[0]?.values ?? [];
    const rawMax = Math.max(...raw, 1);
    const rawMin = Math.min(...raw, rawMax);
    const pad = Math.max(4, (rawMax - rawMin) * 0.35);
    const lo = Math.max(0, rawMin - pad);
    const hi = rawMax + pad * 0.25;
    const span = Math.max(1, hi - lo);
    const pts = raw.map((value, index) => {
      const px = x + (w * index) / Math.max(1, count - 1);
      const py = y + plotH - ((value - lo) / span) * (plotH - 8);
      return { px, py, value };
    });
    const polyline = pts.map(point => `${point.px},${point.py}`).join(' ');
    const dots = pts.map((point, index) => `<circle cx="${point.px}" cy="${point.py}" r="${index === pts.length - 1 ? 4 : 3}" fill="${index === pts.length - 1 ? accent : ink}"/>`).join('');
    const ticks = cats.map((name, index) => label(x + (w * index) / Math.max(1, count - 1), y + h - 2, name, muted, 11)).join('');
    return `<polyline fill="none" stroke="${ink}" stroke-width="1.8" points="${polyline}"/>${dots}${ticks}`;
  }

  if (spec.kind === 'pie' || spec.kind === 'doughnut') {
    let angle = -Math.PI / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 - 4;
    const inner = spec.kind === 'doughnut' ? r * 0.55 : 0;
    const values = spec.series[0]?.values ?? spec.series.map(item => item.values[0] ?? 0);
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const slices = values.map((value, index) => {
      const sweep = (Math.max(0, value) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const ix1 = cx + inner * Math.cos(angle);
      const iy1 = cy + inner * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const ix2 = cx + inner * Math.cos(angle);
      const iy2 = cy + inner * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      const color = resolveColor(deck.theme, spec.series[index]?.color ?? (index === 0 ? 'accent' : 'muted'));
      if (inner) {
        return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z" fill="${color}"/>`;
      }
      return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"/>`;
    }).join('');
    return slices;
  }

  const gap = 10;
  if (spec.kind === 'waterfall') {
    const columns = waterfallColumns(spec.series[0]?.values ?? []);
    const bw = (w - gap * (count - 1)) / count;
    const bars = columns.map((column, index) => {
      const bx = x + index * (bw + gap);
      const scale = (plotH - 6) / max;
      const upH = column.up * scale;
      const downH = column.down * scale;
      const baseY = y + plotH - column.base * scale;
      const up = upH ? `<rect x="${bx}" y="${baseY - upH}" width="${bw}" height="${upH}" fill="${index === columns.length - 1 ? ink : accent}"/>` : '';
      const down = downH ? `<rect x="${bx}" y="${baseY - downH}" width="${bw}" height="${downH}" fill="${muted}"/>` : '';
      const tick = label(bx + bw / 2, y + h - 2, cats[index] ?? '', muted, 11);
      return `${up}${down}${tick}`;
    }).join('');
    return bars;
  }

  const series = spec.series;
  const groupW = (w - gap * (count - 1)) / count;
  const inner = 3;
  const barW = Math.max(4, (groupW - inner * Math.max(0, series.length - 1)) / Math.max(1, series.length));
  if (spec.kind === 'bar') {
    const rowH = (plotH - gap * (count - 1)) / count;
    return cats.map((name, index) => {
      const by = y + index * (rowH + gap);
      const bars = series.map((item, seriesIndex) => {
        const bw = (Math.abs(item.values[index] ?? 0) / max) * (w - 72);
        const color = resolveColor(deck.theme, item.color ?? (seriesIndex === 0 ? 'muted' : 'accent'));
        return `<rect x="${x + 72}" y="${by + seriesIndex * (rowH / series.length)}" width="${bw}" height="${Math.max(6, rowH / series.length - 2)}" fill="${color}"/>`;
      }).join('');
      return `${label(x, by + rowH * 0.65, name, muted, 11, 'start')}${bars}`;
    }).join('');
  }

  return cats.map((name, index) => {
    const gx = x + index * (groupW + gap);
    const bars = series.map((item, seriesIndex) => {
      const value = Math.abs(item.values[index] ?? 0);
      const bh = (value / max) * (plotH - 8);
      const color = resolveColor(deck.theme, item.color ?? (seriesIndex === series.length - 1 ? 'accent' : 'muted'));
      return `<rect x="${gx + seriesIndex * (barW + inner)}" y="${y + plotH - bh}" width="${barW}" height="${bh}" fill="${color}"/>`;
    }).join('');
    return `${bars}${label(gx + groupW / 2, y + h - 2, name, muted, 11)}`;
  }).join('');
}

function svgImage(element: Extract<DeckElement, { type: 'image' }>): string {
  return `<image href="${esc(element.path)}" x="${element.bounds[0]}" y="${element.bounds[1]}" width="${element.bounds[2]}" height="${element.bounds[3]}" preserveAspectRatio="xMidYMid meet"/>`;
}

export function pageToSvg(deck: Deck, page: Page): string {
  const background = resolveColor(deck.theme, page.background ?? 'background');
  const body = [...page.elements]
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    .map(element => {
      if (element.type === 'shape') return svgShape(deck, element);
      if (element.type === 'text') return svgText(deck, element);
      if (element.type === 'image') return svgImage(element);
      return svgChart(deck, element);
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">\n<rect width="960" height="540" fill="${background}"/>\n${body}\n</svg>\n`;
}

async function rasterizeSvg(svgPath: string, pngPath: string, width = 1920, height = 1080): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    await sharp(svgPath, { density: 192 }).resize(width, height).png().toFile(pngPath);
    return true;
  } catch {
    return false;
  }
}

export async function writePagePreviews(deck: Deck, outDir: string): Promise<{ svgs: string[]; pngs: string[]; contactSheet?: string }> {
  mkdirSync(outDir, { recursive: true });
  const svgs: string[] = [];
  const pngs: string[] = [];
  for (const [index, page] of deck.pages.entries()) {
    const stem = `${String(index + 1).padStart(2, '0')}-${page.id}`;
    const svgPath = join(outDir, `${stem}.svg`);
    writeFileSync(svgPath, pageToSvg(deck, page));
    svgs.push(svgPath);
    const pngPath = join(outDir, `${stem}.png`);
    if (await rasterizeSvg(svgPath, pngPath)) pngs.push(pngPath);
  }
  let contactSheet: string | undefined;
  if (pngs.length === deck.pages.length) {
    try {
      const sharp = (await import('sharp')).default;
      const tileW = 480;
      const tileH = 270;
      const cols = 4;
      const rows = Math.ceil(pngs.length / cols);
      const composites = await Promise.all(pngs.map(async (file, index) => ({
        input: await sharp(file).resize(tileW, tileH).png().toBuffer(),
        left: (index % cols) * tileW,
        top: Math.floor(index / cols) * tileH,
      })));
      contactSheet = join(outDir, 'contact-sheet.png');
      await sharp({
        create: { width: cols * tileW, height: rows * tileH, channels: 3, background: '#111111' },
      }).composite(composites).png().toFile(contactSheet);
    } catch {
      contactSheet = undefined;
    }
  }
  return { svgs, pngs, contactSheet };
}
