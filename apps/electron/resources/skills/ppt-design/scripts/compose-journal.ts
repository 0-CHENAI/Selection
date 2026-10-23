import { contain, H, inset, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Ink journal: rice paper, notebook margin, red seal, ink rules. */
export function paintJournal(d: Painter): void {
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

function seal(d: Painter, name: string, x: number, y: number, size = 2.2): void {
  d.shape(name, x, y, size, size, { geometry: 'ellipse', fill: d.p.accent });
}

function frame(d: Painter): Frame {
  d.shape('margin', 0, 0, 3.1, H, { fill: d.p.surface });
  d.shape('margin-rule', 3.1, 0, 0.05, H, { fill: d.p.rule });
  d.text('page', pageNo(d.index), 0.35, 16.8, 2.4, 1.5, { size: d.type.footer, color: d.p.accent, align: 'center', heading: true });
  let y = 0.5;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 3.6, y, 28, 0.7, { size: d.type.label, color: d.p.accent, heading: true });
    y += 0.75;
  }
  d.text('title', d.slide.title, 3.6, y, 28.6, 2.85, { size: d.type.title, heading: true });
  y += 3.0;
  d.shape('ink', 3.6, y, 4.6, 0.1, { fill: d.p.text });
  y += 0.35;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 3.6, y, 28, 0.9, { size: d.type.body, color: d.p.muted });
    y += 1.0;
  }
  if (d.slide.source) d.text('source', d.slide.source, 3.6, 17.9, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  return { x: 3.55, y: y + 0.1, w: 28.8, h: 17.6 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('margin', 0, 0, 4.0, H, { fill: d.p.secondary });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 4.6, 2.3, 22, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 4.6, 3.3, 22.8, 6.0, { size: d.type.hero, heading: true });
  d.shape('ink', 4.6, 9.6, 6.4, 0.14, { fill: d.p.text });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 4.6, 10.0, 20, 2.4, { size: d.type.body, color: d.p.muted });
  d.text('meta', `${s.presenter as string}  ·  ${s.date as string}`, 4.6, 12.8, 20, 1.6, { size: d.type.heading, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 4.6, 14.8, 18, 1.4, { size: d.type.footer, color: d.p.muted });
  seal(d, 'seal', 29.4, 14.8, 2.8);
  d.text('page', pageNo(d.index), 0.4, 16.8, 3.2, 1.5, { size: d.type.footer, color: d.p.inverse, align: 'center' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('margin', 0, 0, 5.2, H, { fill: d.p.secondary });
  d.text('title', d.slide.title, 0.45, 1.6, 4.3, 14.6, { size: 22, color: d.p.inverse, heading: true });
  const num = inset(6.0, 1.4, 6.4, 4.4);
  seal(d, 'seal', num.x, num.y, 3.4);
  d.text('section-number', s.number as string, num.x, num.y, 3.4, 3.4, { size: 28, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
  d.text('body', s.body as string, 6.0, 6.4, 26.2, 8.8, { size: d.type.heading });
  if (d.slide.source) d.text('source', d.slide.source, 6.0, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.4, 17.7, 3.2, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('margin', 0, 0, 3.1, H, { fill: d.p.surface });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 3.7, 2.2, 26, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 3.7, 3.2, 24.4, 4.4, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 3.7, 8.0, 24, 4.6, { size: d.type.heading });
  d.text('contact', s.contact as string, 3.7, 13.0, 22, 2.6, { size: d.type.heading, heading: true });
  seal(d, 'seal', 29.2, 14.6, 2.8);
  if (d.slide.source) d.text('source', d.slide.source, 3.7, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.muted });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  d.shape('fold-a', 16.85, 0, 0.05, H, { fill: d.p.text });
  d.shape('fold-b', 17.05, 0, 0.05, H, { fill: d.p.text });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.2, 0.6, 14, 0.7, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 1.2, 1.4, 14.8, 3.2, { size: d.type.title, heading: true });
  d.text('left-heading', left.heading, 1.2, 5.0, 14.8, 1.8, { size: d.type.heading, heading: true });
  d.text('left-body', left.body, 1.2, 7.0, 14.8, 9.4, { size: d.type.body });
  d.text('right-heading', right.heading, 17.6, 1.4, 14.8, 2.2, { size: d.type.heading, heading: true });
  d.text('right-body', right.body, 17.6, 3.8, 14.8, 12.6, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.2, 17.7, 14, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.4, 17.7, 3.2, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  const num = inset(box.x, box.y, 18, 4.6);
  d.text('value', s.value as string, num.x, num.y, num.w, num.h, { size: d.type.number, color: d.p.accent, heading: true });
  d.shape('ink', box.x, box.y + 4.8, 9.2, 0.18, { fill: d.p.text });
  d.text('label', s.label as string, box.x, box.y + 5.2, 28, 1.6, { size: d.type.heading, heading: true });
  d.text('context', s.context as string, box.x, box.y + 7.0, 28.4, box.h - 7.2, { size: d.type.body });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  seal(d, 'mark', box.x, box.y + 0.2, 1.8);
  d.text('quote', s.quote as string, box.x + 2.2, box.y + 0.3, box.w - 2.4, 7.2, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, box.x + 2.2, box.y + 7.8, box.w - 2.4, 1.8, { size: d.type.body, color: d.p.muted });
  d.text('title', d.slide.title, box.x + 2.2, box.y + 10.0, box.w - 2.4, 2.0, { size: d.type.label, color: d.p.mist, heading: true });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return notes(d, box, true);
    case 'bullets': return notes(d, box, false);
    case 'process': return process(d, box);
    case 'cards': return stacked(d, box);
    case 'timeline': return dates(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return cross(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function notes(d: Painter, box: Frame, numbered: boolean): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (i) d.shape(`hair-${i}`, box.x, y, box.w, 0.03, { fill: d.p.rule });
    if (numbered) d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y, 2.4, step, { size: 24, color: d.p.accent, heading: true, valign: 'middle' });
    else d.shape(`tick-${i}`, box.x + 0.1, y + step / 2 - 0.08, 0.9, 0.16, { fill: i === 0 ? d.p.accent : d.p.text });
    d.text(`item-${i}`, item, box.x + (numbered ? 2.7 : 1.3), y + 0.15, box.w - (numbered ? 2.9 : 1.5), step - 0.3, { size: numbered ? d.type.heading : d.type.body, valign: 'middle' });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  d.shape('spine', box.x + 1.05, box.y + 0.3, 0.06, box.h - 0.6, { fill: d.p.text });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`dot-${i}`, box.x + 0.75, y + 0.35, 0.66, 0.66, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`title-${i}`, item.title, box.x + 1.8, y + 0.2, box.w - 2.0, 1.3, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 1.8, y + 1.6, box.w - 2.0, step - 1.8, { size: d.type.body });
  });
}

function stacked(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.28;
  const h = (box.h - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * (h + gap);
    d.shape(`tick-${i}`, box.x, y, 0.18, h, { fill: d.p.text });
    d.text(`title-${i}`, item.title, box.x + 0.55, y + 0.15, box.w - 0.7, 1.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 0.55, y + 1.4, box.w - 0.7, h - 1.6, { size: d.type.body });
  });
}

function dates(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`label-${i}`, item.label, x, box.y, w, 1.8, { size: 24, color: d.p.accent, heading: true });
    d.shape(`ink-${i}`, x, box.y + 1.95, Math.min(2.8, w), 0.1, { fill: d.p.text });
    d.text(`title-${i}`, item.title, x, box.y + 2.3, w, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 4.7, w, box.h - 4.9, { size: d.type.body });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const side = 8.4;
  d.chart({ x: box.x, y: box.y, w: box.w - side - 0.45, h: box.h }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.text}`);
  d.shape('note-rule', box.x + box.w - side, box.y, 0.08, box.h, { fill: d.p.accent });
  d.text('insight-k', '批注', box.x + box.w - side + 0.4, box.y, side - 0.5, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('insight', s.insight as string, box.x + box.w - side + 0.4, box.y + 1.0, side - 0.5, box.h - 1.2, { size: d.type.heading, heading: true });
}

function cross(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.shape('v', box.x + box.w / 2 - 0.04, box.y + 0.8, 0.08, box.h - 0.8, { fill: d.p.text });
  d.shape('h', box.x, box.y + box.h / 2 - 0.04, box.w, 0.08, { fill: d.p.text });
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const w = box.w / 2 - 0.55;
  const h = (box.h - 1.6) / 2 - 0.2;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (box.w / 2) + 0.3;
    const y = box.y + 0.9 + Math.floor(i / 2) * ((box.h - 1.4) / 2);
    d.text(`cell-title-${i}`, cell.title, x, y, w, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x, y + 1.4, w, h - 1.5, { size: d.type.body });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 13.2;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.45, y: box.y, w: box.w - textW - 0.45, h: box.h };
  d.shape('wash', media.x, media.y, media.w, media.h, { fill: d.p.secondary });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.5, media.y + 0.5, media.w - 1, 2.4, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text('panel-body', panel.body, media.x + 0.5, media.y + 3.1, media.w - 1, media.h - 3.7, { size: d.type.body, color: d.p.inverse });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.25, y: media.y + 0.25, w: media.w - 0.5, h: media.h - 0.5 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
