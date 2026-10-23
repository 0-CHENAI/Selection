import { contain, H, inset, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Workshop teaching: cream field, coral lesson tiles, inset step numbers. */
export function paintWorkshop(d: Painter): void {
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
  d.shape('top-slab', 0, 0, W, 0.28, { fill: d.p.secondary });
  let y = 0.5;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.2, y, 28, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    y += 0.75;
  }
  d.text('title', d.slide.title, 1.2, y, 31.2, 2.85, { size: d.type.title, heading: true });
  y += 3.0;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.2, y, 30, 0.9, { size: d.type.body, color: d.p.muted });
    y += 1.0;
  }
  if (d.slide.source) d.text('source', d.slide.source, 1.2, 17.9, 26, 0.85, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 17.9, 3.3, 0.85, { size: d.type.footer, color: d.p.secondary, align: 'right', valign: 'middle', heading: true });
  return { x: 1.15, y: y + 0.15, w: 31.55, h: 17.6 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  ['01', '02', '03'].forEach((label, i) => {
    const x = 2.2 + i * 10.2;
    d.shape(`disc-${i}`, x, 1.3, 3.3, 3.3, { geometry: 'ellipse', fill: i === 1 ? d.p.accent : d.p.secondary });
    d.text(`disc-n-${i}`, label, x, 1.3, 3.3, 3.3, { size: 22, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
  });
  d.shape('slab', 0, 10.4, W, 8.65, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 10.7, 30, 0.75, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 11.5, 30.8, 4.0, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('meta', `${s.presenter as string}  ·  ${s.date as string}`, 1.5, 15.8, 24, 1.4, { size: d.type.body, color: d.p.inverse });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 17.3, 24, 1.1, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 17.4, 3.3, 1.0, { size: d.type.footer, color: d.p.inverse, align: 'right' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('right-slab', 19.6, 0, 14.27, H, { fill: d.p.accent });
  const num = inset(20.3, 3.2, 12.6, 6.4);
  d.text('section-number', s.number as string, num.x, num.y, num.w, num.h, { size: 96, color: d.p.inverse, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 3.6, 17, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 4.6, 17.2, 5.2, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.4, 10.2, 17.2, 6.2, { size: d.type.heading });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.7, 16, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.4, 17.6, 3.2, 0.9, { size: d.type.footer, color: d.p.inverse, align: 'right' });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('slab', 0, 12.6, W, 6.45, { fill: d.p.secondary });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 1.8, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 2.8, 30.8, 4.0, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.4, 7.1, 30.8, 4.6, { size: d.type.heading });
  d.text('contact', s.contact as string, 1.4, 13.4, 30.8, 3.6, { size: d.type.heading, color: d.p.inverse, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.5, 22, 0.9, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 17.5, 3.3, 0.9, { size: d.type.footer, color: d.p.inverse, align: 'right' });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  const w = (box.w - 0.5) / 2;
  d.shape('board-l', box.x, box.y, w, box.h, { geometry: 'roundRect', fill: d.p.surface });
  d.shape('board-r', box.x + w + 0.5, box.y, w, box.h, { geometry: 'roundRect', fill: d.p.accent });
  d.text('left-heading', left.heading, box.x + 0.5, box.y + 0.45, w - 1, 2.0, { size: d.type.heading, heading: true });
  d.text('left-body', left.body, box.x + 0.5, box.y + 2.6, w - 1, box.h - 3.2, { size: d.type.body });
  d.text('right-heading', right.heading, box.x + w + 1.0, box.y + 0.45, w - 1, 2.0, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.text('right-body', right.body, box.x + w + 1.0, box.y + 2.6, w - 1, box.h - 3.2, { size: d.type.body, color: d.p.inverse });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  d.shape('tile', box.x, box.y, 13.6, box.h, { geometry: 'roundRect', fill: d.p.accent });
  const num = inset(box.x + 0.6, box.y + 1.4, 12.4, 5.2);
  d.text('value', s.value as string, num.x, num.y, num.w, num.h, { size: d.type.number, color: d.p.inverse, heading: true });
  d.text('label', s.label as string, box.x + 0.7, box.y + 7.2, 12.2, 4.2, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.shape('context', box.x + 14.1, box.y, 17.45, box.h, { geometry: 'roundRect', fill: d.p.surface });
  d.text('title-repeat', d.slide.title, box.x + 14.6, box.y + 0.5, 16.5, 2.6, { size: d.type.heading, heading: true });
  d.text('context', s.context as string, box.x + 14.6, box.y + 3.3, 16.5, box.h - 3.9, { size: d.type.body });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  d.shape('bubble', box.x, box.y, box.w, box.h, { geometry: 'roundRect', fill: d.p.surface });
  d.text('mark', '“', box.x + 0.6, box.y + 0.3, 4, 2.2, { size: 48, color: d.p.accent, heading: true });
  d.text('quote', s.quote as string, box.x + 1.0, box.y + 2.6, box.w - 2, 6.4, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, box.x + 1.0, box.y + box.h - 3.2, box.w - 2, 2.2, { size: d.type.body, color: d.p.muted });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return tiles(d, box);
    case 'bullets': return checks(d, box);
    case 'process': return process(d, box);
    case 'cards': return cards(d, box);
    case 'timeline': return timeline(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return matrix(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function tiles(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.4;
  const w = (box.w - gap) / cols;
  const h = (box.h - gap * (rows - 1)) / rows;
  items.forEach((item, i) => {
    const x = box.x + (i % cols) * (w + gap);
    const y = box.y + Math.floor(i / cols) * (h + gap);
    d.shape(`tile-${i}`, x, y, w, h, { geometry: 'roundRect', fill: i % 2 === 0 ? d.p.surface : d.p.secondary });
    const color = i % 2 === 0 ? d.p.text : d.p.inverse;
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), x + 0.45, y + 0.3, 2.4, 1.1, { size: d.type.label, color: i % 2 === 0 ? d.p.accent : d.p.mist, heading: true, bold: true });
    d.text(`item-${i}`, item, x + 0.5, y + 1.5, w - 1.0, h - 2.0, { size: d.type.heading, color });
  });
}

function checks(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`row-${i}`, box.x, y + 0.12, box.w, step - 0.24, { geometry: 'roundRect', fill: d.p.surface });
    d.shape(`dot-${i}`, box.x + 0.45, y + step / 2 - 0.4, 0.8, 0.8, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`item-${i}`, item, box.x + 1.7, y + 0.25, box.w - 2.2, step - 0.5, { size: d.type.body, valign: 'middle' });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`card-${i}`, box.x, y + 0.1, box.w, step - 0.2, { geometry: 'roundRect', fill: d.p.surface });
    d.shape(`num-well-${i}`, box.x + 0.25, y + 0.25, 2.5, step - 0.5, { geometry: 'roundRect', fill: d.p.accent });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x + 0.25, y + 0.25, 2.5, step - 0.5, { size: 22, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
    d.text(`title-${i}`, item.title, box.x + 3.1, y + 0.25, box.w - 3.5, 1.25, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 3.1, y + 1.55, box.w - 3.5, step - 1.9, { size: d.type.body });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`card-${i}`, x, box.y, w, box.h, { geometry: 'roundRect', fill: i % 2 === 0 ? d.p.accent : d.p.secondary });
    d.text(`title-${i}`, item.title, x + 0.4, box.y + 0.5, w - 0.8, 2.6, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text(`body-${i}`, item.body, x + 0.4, box.y + 3.3, w - 0.8, box.h - 3.9, { size: d.type.body, color: d.p.inverse });
  });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`chip-${i}`, x, box.y, w, 1.7, { geometry: 'roundRect', fill: d.p.accent });
    d.text(`label-${i}`, item.label, x + 0.25, box.y + 0.15, w - 0.5, 1.4, { size: d.type.heading, color: d.p.inverse, align: 'center', valign: 'middle', heading: true });
    d.text(`title-${i}`, item.title, x + 0.2, box.y + 2.0, w - 0.4, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.2, box.y + 4.4, w - 0.4, box.h - 4.6, { size: d.type.body });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const note = 8.6;
  d.shape('well', box.x, box.y, box.w - note - 0.4, box.h, { geometry: 'roundRect', fill: d.p.surface });
  d.chart({ x: box.x + 0.25, y: box.y + 0.25, w: box.w - note - 0.9, h: box.h - 0.5 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.text}`);
  d.shape('note', box.x + box.w - note, box.y, note, box.h, { geometry: 'roundRect', fill: d.p.secondary });
  d.text('insight-k', '看这里', box.x + box.w - note + 0.45, box.y + 0.45, note - 0.9, 0.8, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('insight', s.insight as string, box.x + box.w - note + 0.45, box.y + 1.5, note - 0.9, box.h - 2.1, { size: d.type.heading, color: d.p.inverse, heading: true });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.35;
  const w = (box.w - gap) / 2;
  const h = (box.h - 0.9 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (w + gap);
    const y = box.y + 0.85 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { geometry: 'roundRect', fill: i === 0 ? d.p.accent : d.p.surface });
    const color = i === 0 ? d.p.inverse : d.p.text;
    d.text(`cell-title-${i}`, cell.title, x + 0.4, y + 0.3, w - 0.8, 1.4, { size: d.type.heading, color, heading: true });
    d.text(`cell-body-${i}`, cell.body, x + 0.4, y + 1.8, w - 0.8, h - 2.2, { size: d.type.body, color });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 13.8;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.45, y: box.y, w: box.w - textW - 0.45, h: box.h };
  d.shape('well', media.x, media.y, media.w, media.h, { geometry: 'roundRect', fill: d.p.secondary });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.5, media.y + 0.5, media.w - 1, 2.4, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text('panel-body', panel.body, media.x + 0.5, media.y + 3.1, media.w - 1, media.h - 3.7, { size: d.type.body, color: d.p.inverse });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.3, y: media.y + 0.3, w: media.w - 0.6, h: media.h - 0.6 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
