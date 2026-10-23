import { contain, H, inset, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Narrative keynote: black field, gold spotlight, stacked comparison. */
export function paintStage(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'comparison': return comparison(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    default: return body(d, frame(d));
  }
}

function frame(d: Painter): Frame {
  d.shape('gold-line', 1.6, 0.55, 3.4, 0.08, { fill: d.p.accent });
  let y = 0.85;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.6, y, 28, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    y += 0.75;
  }
  d.text('title', d.slide.title, 1.6, y, 30.4, 2.9, { size: d.type.title, heading: true });
  y += 3.1;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.6, y, 29, 0.9, { size: d.type.body, color: d.p.muted });
    y += 1.0;
  }
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.9, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.9, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true });
  return { x: 1.6, y: y + 0.2, w: 30.6, h: 17.6 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('spot', 21.4, -2.6, 16.2, 16.2, { geometry: 'ellipse', fill: d.p.accent, opacity: '0.16' });
  d.shape('spot-core', 26.2, 2.0, 6.6, 6.6, { geometry: 'ellipse', fill: d.p.accent, opacity: '0.22' });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.6, 3.4, 22, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.6, 4.4, 24.6, 6.2, { size: d.type.hero, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.6, 11.0, 22, 2.0, { size: d.type.body, color: d.p.muted });
  d.shape('rule', 1.6, 13.4, 4.4, 0.08, { fill: d.p.accent });
  d.text('meta', `${s.presenter as string}  ·  ${s.date as string}`, 1.6, 13.8, 24, 1.6, { size: d.type.heading, color: d.p.mist, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 16.0, 22, 1.2, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.6, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  const num = inset(1.6, 2.0, 12, 3.4);
  d.text('section-number', s.number as string, num.x, num.y, num.w, num.h, { size: 56, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 1.6, 5.8, 30.6, 5.0, { size: d.type.hero, align: 'left', heading: true });
  d.shape('rule', 1.6, 11.1, 5.2, 0.08, { fill: d.p.accent });
  d.text('body', s.body as string, 1.6, 11.5, 28, 4.6, { size: d.type.heading, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('gold', 0, 16.55, W, 0.18, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.6, 2.2, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.6, 3.3, 30.6, 5.0, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.6, 8.7, 29, 4.2, { size: d.type.heading, color: d.p.muted });
  d.text('contact', s.contact as string, 1.6, 13.3, 29, 2.4, { size: d.type.heading, color: d.p.accent, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.6, 0.5, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.6, 1.3, 30.6, 2.2, { size: d.type.title, heading: true });
  d.shape('top', 0, 3.7, W, 7.35, { fill: d.p.surface });
  d.text('left-heading', left.heading, 1.6, 4.0, 30.6, 1.4, { size: d.type.heading, color: d.p.accent, heading: true });
  d.text('left-body', left.body, 1.6, 5.5, 30.6, 5.1, { size: d.type.body });
  d.text('right-heading', right.heading, 1.6, 11.3, 30.6, 1.4, { size: d.type.heading, heading: true });
  d.text('right-body', right.body, 1.6, 12.8, 30.6, 4.4, { size: d.type.body, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.7, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  const num = inset(1.4, 2.6, 30.8, 6.2);
  d.text('value', s.value as string, num.x, num.y, num.w, num.h, { size: d.type.number, color: d.p.accent, align: 'center', heading: true });
  d.text('label', s.label as string, 2.2, 9.1, 29.4, 1.6, { size: d.type.heading, align: 'center', heading: true });
  d.text('title', d.slide.title, 2.2, 11.0, 29.4, 2.2, { size: d.type.title, align: 'center', heading: true });
  d.text('context', s.context as string, 3.4, 13.4, 27, 3.4, { size: d.type.body, color: d.p.muted, align: 'center' });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.7, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  d.text('quote', s.quote as string, 2.6, 4.2, 28.6, 8.2, { size: d.type.quote, align: 'center', heading: true });
  d.shape('rule', 14.6, 12.8, 4.6, 0.08, { fill: d.p.accent });
  d.text('attribution', s.attribution as string, 2.6, 13.2, 28.6, 1.6, { size: d.type.body, color: d.p.muted, align: 'center' });
  d.text('title', d.slide.title, 2.6, 15.2, 28.6, 1.6, { size: d.type.label, color: d.p.mist, align: 'center', heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.7, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return list(d, box, true);
    case 'bullets': return list(d, box, false);
    case 'process': return cascade(d, box);
    case 'cards': return bands(d, box);
    case 'timeline': return years(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return corners(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function list(d: Painter, box: Frame, numbered: boolean): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (numbered) d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y, 2.6, step, { size: 24, color: d.p.accent, heading: true, valign: 'middle' });
    else d.shape(`dot-${i}`, box.x + 0.15, y + step / 2 - 0.16, 0.32, 0.32, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`item-${i}`, item, box.x + (numbered ? 3.0 : 1.0), y + 0.1, box.w - (numbered ? 3.2 : 1.2), step - 0.2, { size: d.type.heading, valign: 'middle' });
  });
}

function cascade(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    const pad = i * 1.4;
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x + pad, y, 2.4, 1.2, { size: d.type.label, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, box.x + pad + 2.6, y, box.w - pad - 2.8, 1.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + pad + 2.6, y + 1.3, box.w - pad - 2.8, step - 1.5, { size: d.type.body, color: d.p.muted });
  });
}

function bands(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.28;
  const h = (box.h - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * (h + gap);
    d.shape(`band-${i}`, box.x, y, box.w, h, { fill: d.p.surface });
    d.shape(`gold-${i}`, box.x, y, 0.22, h, { fill: d.p.accent });
    d.text(`title-${i}`, item.title, box.x + 0.7, y + 0.2, 10, h - 0.4, { size: d.type.heading, heading: true, valign: 'middle' });
    d.text(`body-${i}`, item.body, box.x + 11.0, y + 0.2, box.w - 11.5, h - 0.4, { size: d.type.body, color: d.p.muted, valign: 'middle' });
  });
}

function years(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.45;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`label-${i}`, item.label, x, box.y, w, 2.2, { size: 28, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, x, box.y + 2.4, w, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 4.8, w, box.h - 5.0, { size: d.type.body, color: d.p.muted });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const caption = 2.6;
  d.chart({ x: box.x, y: box.y, w: box.w, h: box.h - caption - 0.2 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.mist}`);
  d.text('insight', s.insight as string, box.x, box.y + box.h - caption, box.w, caption, { size: d.type.heading, color: d.p.accent, valign: 'middle' });
}

function corners(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.shape('v', box.x + box.w / 2 - 0.03, box.y, 0.06, box.h, { fill: d.p.accent });
  d.shape('h', box.x, box.y + box.h / 2 - 0.03, box.w, 0.06, { fill: d.p.accent });
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const w = box.w / 2 - 0.6;
  const h = box.h / 2 - 0.7;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (box.w / 2) + 0.3;
    const y = box.y + 0.8 + Math.floor(i / 2) * (box.h / 2);
    d.text(`cell-title-${i}`, cell.title, x, y, w, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x, y + 1.4, w, h - 1.6, { size: d.type.body, color: d.p.muted });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 12.8;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.5, y: box.y, w: box.w - textW - 0.5, h: box.h };
  d.shape('panel', media.x, media.y, media.w, media.h, { fill: d.p.surface });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.55, media.y + 0.55, media.w - 1.1, 2.4, { size: d.type.heading, heading: true });
    d.text('panel-body', panel.body, media.x + 0.55, media.y + 3.2, media.w - 1.1, media.h - 3.9, { size: d.type.body, color: d.p.muted });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.3, y: media.y + 0.3, w: media.w - 0.6, h: media.h - 0.6 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
