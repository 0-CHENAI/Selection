import { contain, H, inset, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Engineering blueprint: navy sheet, cyan ticks, title block, dimensioned numerals. */
export function paintBlueprint(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    default: return body(d, frame(d));
  }
}

function ticks(d: Painter): void {
  for (let i = 1; i <= 5; i++) d.shape(`htick-${i}`, 0.4 + i * 5.5, 0.25, 1.1, 0.04, { fill: d.p.rule });
  for (let i = 1; i <= 3; i++) d.shape(`vtick-${i}`, 0.25, 0.5 + i * 4.5, 0.04, 1.1, { fill: d.p.rule });
}

function corner(d: Painter, name: string, x: number, y: number, flipX = 1, flipY = 1): void {
  d.shape(`${name}-h`, x, y, 1.3, 0.07, { fill: d.p.accent });
  d.shape(`${name}-v`, x + (flipX < 0 ? 1.23 : 0), y + (flipY < 0 ? -1.15 : 0), 0.07, 1.22, { fill: d.p.accent });
}

function frame(d: Painter): Frame {
  ticks(d);
  corner(d, 'tl', 0.35, 0.3);
  corner(d, 'br', 32.2, 17.55, -1, -1);
  let y = 0.55;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.3, y, 24, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    y += 0.75;
  }
  d.text('title', d.slide.title, 1.3, y, 28.4, 2.7, { size: d.type.title, heading: true });
  y += 2.9;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.3, y, 28, 0.85, { size: d.type.body, color: d.p.muted });
    y += 0.95;
  }
  d.shape('block', 0, 17.55, W, 1.5, { fill: d.p.surface });
  if (d.slide.source) d.text('source', d.slide.source, 1.3, 17.7, 24, 1.1, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', `SH.${pageNo(d.index)}`, 26.8, 17.7, 6.2, 1.1, { size: d.type.footer, color: d.p.accent, align: 'right', valign: 'middle', heading: true, bold: true });
  return { x: 1.25, y: y + 0.2, w: 31.3, h: 17.25 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  ticks(d);
  corner(d, 'tl', 0.4, 0.35);
  corner(d, 'tr', 32.15, 0.35, -1, 1);
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 2.0, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 3.0, 30.6, 5.4, { size: d.type.hero, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.5, 8.6, 28, 2.0, { size: d.type.body, color: d.p.muted });
  d.shape('title-block', 0, 12.7, W, 6.35, { fill: d.p.surface, line: `${d.p.accent}:1.25` });
  const cells: [string, string][] = [['讲者', s.presenter as string], ['日期', s.date as string], ['图号', 'CV-01'], ['备注', d.slide.source ?? '演示图纸']];
  cells.forEach((cell, i) => {
    const x = 0.4 + (i % 2) * 16.5;
    const y = 13.0 + Math.floor(i / 2) * 2.7;
    d.shape(`cell-rule-${i}`, x, y, 16.1, 0.04, { fill: d.p.rule });
    d.text(`k-${i}`, cell[0], x + 0.3, y + 0.15, 15.5, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    d.text(`v-${i}`, cell[1], x + 0.3, y + 0.85, 15.5, 1.5, { size: d.type.heading, heading: true });
  });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  ticks(d);
  corner(d, 'tl', 0.4, 0.35);
  d.shape('frame', 1.1, 1.1, 31.6, 14.8, { fill: 'none', line: `${d.p.accent}:1.25` });
  d.text('section-number', `SH.${s.number as string}`, 1.6, 1.6, 14, 2.4, { size: 32, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 1.6, 4.3, 30.4, 4.2, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.6, 8.8, 30.4, 6.2, { size: d.type.heading, color: d.p.muted });
  d.shape('block', 0, 16.3, W, 2.75, { fill: d.p.surface });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 16.6, 24, 1.8, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 16.6, 3.3, 1.8, { size: d.type.footer, color: d.p.accent, align: 'right', valign: 'middle', heading: true });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  ticks(d);
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 2.0, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 3.0, 30.6, 4.4, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.5, 7.7, 30.4, 4.6, { size: d.type.heading, color: d.p.muted });
  d.shape('block', 0, 13.4, W, 5.65, { fill: d.p.surface, line: `${d.p.accent}:1.25` });
  d.text('contact-k', 'NEXT', 1.4, 13.7, 8, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('contact', s.contact as string, 1.4, 14.6, 30.8, 2.8, { size: d.type.heading, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.6, 22, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.6, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  d.shape('dim-top', box.x + 4, box.y + 0.4, 16, 0.05, { fill: d.p.accent });
  d.shape('dim-l', box.x + 4, box.y + 0.2, 0.05, 0.45, { fill: d.p.accent });
  d.shape('dim-r', box.x + 20, box.y + 0.2, 0.05, 0.45, { fill: d.p.accent });
  const num = inset(box.x, box.y + 0.9, 22, 4.8);
  d.text('value', s.value as string, num.x, num.y, num.w, num.h, { size: d.type.number, color: d.p.accent, heading: true });
  d.text('label', s.label as string, box.x, box.y + 5.9, 30.8, 1.6, { size: d.type.heading, heading: true });
  d.text('context', s.context as string, box.x, box.y + 7.7, 30.8, box.h - 7.9, { size: d.type.body, color: d.p.muted });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  d.shape('callout', box.x, box.y, box.w, box.h, { fill: 'none', line: `${d.p.accent}:1.5` });
  d.text('quote', s.quote as string, box.x + 0.8, box.y + 0.7, box.w - 1.6, box.h - 3.6, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, box.x + 0.8, box.y + box.h - 2.6, box.w - 1.6, 1.8, { size: d.type.body, color: d.p.muted });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return sheets(d, box);
    case 'bullets': return callouts(d, box);
    case 'comparison': return frames(d, box);
    case 'process': return nodes(d, box);
    case 'cards': return codes(d, box);
    case 'timeline': return spine(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return grid(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function sheets(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.text(`num-${i}`, `SH.${String(i + 1).padStart(2, '0')}`, box.x, y, 4.4, step, { size: d.type.label, color: d.p.accent, heading: true, valign: 'middle' });
    d.shape(`line-${i}`, box.x + 4.6, y + step / 2, 1.4, 0.04, { fill: d.p.accent });
    d.text(`item-${i}`, item, box.x + 6.3, y + 0.15, box.w - 6.5, step - 0.3, { size: d.type.heading, valign: 'middle' });
  });
}

function callouts(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`box-${i}`, box.x + 2.2, y + 0.12, box.w - 2.2, step - 0.24, { fill: 'none', line: `${d.p.rule}:1` });
    d.shape(`leader-${i}`, box.x, y + step / 2, 2.2, 0.04, { fill: d.p.accent });
    d.shape(`node-${i}`, box.x, y + step / 2 - 0.18, 0.36, 0.36, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`item-${i}`, item, box.x + 2.55, y + 0.25, box.w - 2.9, step - 0.5, { size: d.type.body, valign: 'middle' });
  });
}

function frames(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  const w = (box.w - 0.45) / 2;
  ([left, right] as const).forEach((side, i) => {
    const x = box.x + i * (w + 0.45);
    d.shape(`frame-${i}`, x, box.y, w, box.h, { fill: 'none', line: `${d.p.accent}:1.25` });
    d.text(`${i}-heading`, side.heading, x + 0.45, box.y + 0.4, w - 0.9, 2.0, { size: d.type.heading, color: d.p.accent, heading: true });
    d.text(`${i}-body`, side.body, x + 0.45, box.y + 2.6, w - 0.9, box.h - 3.1, { size: d.type.body, color: d.p.muted });
  });
}

function nodes(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  d.shape('rail', box.x + w / 2, box.y + 0.85, box.w - w, 0.05, { fill: d.p.accent });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`node-${i}`, x + w / 2 - 0.55, box.y + 0.35, 1.1, 1.1, { fill: d.p.background, line: `${d.p.accent}:1.5` });
    d.text(`num-${i}`, String(i + 1), x + w / 2 - 0.55, box.y + 0.35, 1.1, 1.1, { size: 16, color: d.p.accent, align: 'center', valign: 'middle', heading: true, bold: true });
    d.shape(`mod-${i}`, x, box.y + 1.9, w, box.h - 1.9, { fill: 'none', line: `${d.p.rule}:1` });
    d.text(`title-${i}`, item.title, x + 0.3, box.y + 2.15, w - 0.6, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.3, box.y + 4.5, w - 0.6, box.h - 4.8, { size: d.type.body, color: d.p.muted });
  });
}

function codes(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`mod-${i}`, x, box.y, w, box.h, { fill: 'none', line: `${d.p.accent}:1.25` });
    d.text(`code-${i}`, String.fromCharCode(65 + i), x + 0.35, box.y + 0.3, w - 0.7, 1.3, { size: d.type.heading, color: d.p.secondary, heading: true });
    d.text(`title-${i}`, item.title, x + 0.35, box.y + 1.7, w - 0.7, 2.4, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.35, box.y + 4.3, w - 0.7, box.h - 4.7, { size: d.type.body, color: d.p.muted });
  });
}

function spine(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const step = box.h / items.length;
  d.shape('spine', box.x + 5.4, box.y, 0.05, box.h, { fill: d.p.accent });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`tick-${i}`, box.x + 5.15, y + 0.45, 0.55, 0.08, { fill: d.p.accent });
    d.text(`label-${i}`, item.label, box.x, y + 0.15, 5.0, step - 0.3, { size: d.type.heading, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`title-${i}`, item.title, box.x + 6.0, y + 0.15, 9.2, step - 0.3, { size: d.type.heading, heading: true, valign: 'middle' });
    d.text(`body-${i}`, item.body, box.x + 15.4, y + 0.15, box.w - 15.6, step - 0.3, { size: d.type.body, color: d.p.muted, valign: 'middle' });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const side = 8.8;
  d.shape('plot', box.x, box.y, box.w - side - 0.4, box.h, { fill: 'none', line: `${d.p.accent}:1.25` });
  d.chart({ x: box.x + 0.25, y: box.y + 0.25, w: box.w - side - 0.9, h: box.h - 0.5 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.mist}`);
  d.text('insight-k', 'NOTE', box.x + box.w - side, box.y, side, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('insight', s.insight as string, box.x + box.w - side, box.y + 1.0, side, box.h - 1.2, { size: d.type.heading, heading: true });
}

function grid(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.3;
  const w = (box.w - gap) / 2;
  const h = (box.h - 0.85 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (w + gap);
    const y = box.y + 0.8 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { fill: 'none', line: `${d.p.rule}:1` });
    d.text(`coord-${i}`, `${i % 2},${Math.floor(i / 2)}`, x + 0.3, y + 0.2, 3, 0.7, { size: d.type.label, color: d.p.secondary, heading: true });
    d.text(`cell-title-${i}`, cell.title, x + 0.4, y + 1.0, w - 0.8, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x + 0.4, y + 2.4, w - 0.8, h - 2.7, { size: d.type.body, color: d.p.muted });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 13.6;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.45, y: box.y, w: box.w - textW - 0.45, h: box.h };
  d.shape('frame', media.x, media.y, media.w, media.h, { fill: 'none', line: `${d.p.accent}:1.25` });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.45, media.y + 0.45, media.w - 0.9, 2.3, { size: d.type.heading, heading: true });
    d.text('panel-body', panel.body, media.x + 0.45, media.y + 3.0, media.w - 0.9, media.h - 3.6, { size: d.type.body, color: d.p.muted });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.25, y: media.y + 0.25, w: media.w - 0.5, h: media.h - 0.5 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
