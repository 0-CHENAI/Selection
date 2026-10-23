import { contain, H, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** editorial + editorial_bleed: edge-bleed color, drop numerals, vertical reading, no shared card grid. */
export function paintEditorial(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'comparison': return comparison(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    case 'image-text': return imageText(d);
    default: return body(d, frame(d));
  }
}

function frame(d: Painter): Frame {
  d.shape('spine', 0, 0, 0.7, H, { fill: d.p.accent });
  let y = 0.4;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.4, y, 28, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
    y += 0.88;
  }
  d.text('title', d.slide.title, 1.4, y, 30.5, 2.5, { size: d.type.title, heading: true });
  y += 2.6;
  d.shape('title-rule', 1.4, y, 3.6, 0.16, { fill: d.p.accent });
  y += 0.4;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.4, y, 30, 1.1, { size: d.type.body, color: d.p.muted });
    y += 1.2;
  }
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.85, 26, 0.9, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 17.85, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', valign: 'middle', heading: true });
  const top = y + 0.2;
  return { x: 1.35, y: top, w: 31.2, h: 17.55 - top };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('bleed', 18.4, 0, W - 18.4, H, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.2, 2.3, 16, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.shape('kicker-rule', 1.2, 3.3, 2.8, 0.16, { fill: d.p.text });
  d.text('title', d.slide.title, 1.2, 3.8, 16.2, 4.8, { size: d.type.hero, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.2, 9.0, 16, 3.2, { size: d.type.body, color: d.p.muted });
  d.text('meta-k1', '讲者', 19.3, 5.4, 13, 0.7, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('presenter', s.presenter as string, 19.3, 6.2, 13, 2.2, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.text('meta-k2', '日期', 19.3, 9.2, 13, 0.7, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('date', s.date as string, 19.3, 10.0, 13, 1.8, { size: d.type.heading, color: d.p.inverse, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.2, 16.6, 16, 1.4, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 19.3, 17.5, 13, 0.9, { size: d.type.footer, color: d.p.mist, align: 'right' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('field', 0, 0, W, H, { fill: d.p.secondary });
  d.text('section-number', s.number as string, -0.4, 1.0, 16, 8, { size: 120, color: d.p.accent, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 14.5, 4.6, 17.5, 0.8, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('title', d.slide.title, 1.5, 9.2, 30, 3.8, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.5, 13.3, 24, 3.4, { size: d.type.heading, color: d.p.mist });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.5, 16.8, 22, 1.2, { size: d.type.body, color: d.p.inverse });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 28.8, 17.7, 3.6, 0.85, { size: d.type.footer, color: d.p.inverse, align: 'right', heading: true });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('field', 0, 0, W, H, { fill: d.p.accent });
  d.shape('strip', 0, 14.6, W, 4.45, { fill: d.p.background });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 2.4, 28, 0.8, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('title', d.slide.title, 1.5, 3.5, 30, 4.2, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.5, 8.2, 28, 4.4, { size: d.type.heading, color: d.p.inverse });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.5, 12.8, 28, 1.3, { size: d.type.body, color: d.p.mist });
  d.text('contact', s.contact as string, 1.5, 15.4, 28, 2.4, { size: d.type.heading, color: d.p.text, heading: true, valign: 'middle' });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 17.85, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.85, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  d.shape('left-bleed', 0, 0, 16.93, H, { fill: d.p.accent });
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.1, 1.2, 14.5, 0.7, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('title', d.slide.title, 1.1, 2.1, 14.6, 3.6, { size: d.type.title, color: d.p.inverse, heading: true });
  d.text('left-heading', left.heading, 1.1, 6.2, 14.6, 2.2, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.text('left-body', left.body, 1.1, 8.6, 14.6, 7.2, { size: d.type.body, color: d.p.inverse });
  d.text('right-heading', right.heading, 18.0, 2.1, 14.4, 2.4, { size: d.type.heading, heading: true });
  d.shape('right-rule', 18.0, 4.7, 2.6, 0.14, { fill: d.p.secondary });
  d.text('right-body', right.body, 18.0, 5.2, 14.4, 10, { size: d.type.body });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 18.0, 15.6, 14.4, 1.3, { size: d.type.label, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 18.0, 17.6, 11, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.4, 17.6, 3.2, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  d.shape('spine', 0, 0, 1.15, H, { fill: d.p.secondary });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 2.0, 1.3, 28, 0.7, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 2.0, 2.1, 29, 2.2, { size: d.type.title, heading: true });
  d.text('value', s.value as string, 1.8, 4.6, 20, 4.2, { size: 88, color: d.p.accent, heading: true });
  d.shape('rule', 2.0, 9.0, 8.5, 0.22, { fill: d.p.accent });
  d.text('label', s.label as string, 2.0, 9.5, 29, 1.8, { size: d.type.heading, heading: true });
  d.shape('hairline', 2.0, 11.6, 29.5, 0.04, { fill: d.p.rule });
  d.text('context', s.context as string, 2.0, 12.0, 29.5, 4.4, { size: d.type.body });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 2.0, 16.5, 24, 1.0, { size: d.type.label, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 2.0, 17.75, 24, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.75, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  d.shape('spine', 0, 0, 2.6, H, { fill: d.p.secondary });
  d.text('mark', '“', 0.15, 6.2, 2.3, 3.2, { size: 48, color: d.p.inverse, align: 'center', heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 4.2, 2.6, 26, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.shape('rule-top', 14.2, 3.6, 5.4, 0.12, { fill: d.p.accent });
  d.text('title', d.slide.title, 4.0, 4.0, 27, 2.2, { size: d.type.title, align: 'center', heading: true });
  d.text('quote', s.quote as string, 4.4, 6.6, 26.2, 6.2, { size: d.type.quote, align: 'center', heading: true });
  d.shape('rule-bottom', 14.2, 13.1, 5.4, 0.12, { fill: d.p.accent });
  d.text('attribution', s.attribution as string, 4.4, 13.5, 26.2, 1.6, { size: d.type.body, color: d.p.muted, align: 'center' });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 4.4, 15.4, 26, 1.1, { size: d.type.label, color: d.p.muted, align: 'center' });
  if (d.slide.source) d.text('source', d.slide.source, 4.2, 17.75, 22, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.75, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true });
}

function imageText(d: Painter): void {
  const s = d.slide.slots;
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.15, 1.2, 13, 0.7, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 1.15, 2.1, 13.2, 3.4, { size: d.type.title, heading: true });
  d.shape('rule', 1.15, 5.7, 2.4, 0.14, { fill: d.p.accent });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.15, 6.1, 13.2, 1.5, { size: d.type.body, color: d.p.muted });
  const bodyY = d.slide.subtitle ? 7.8 : 6.2;
  d.text('body', s.body as string, 1.15, bodyY, 13.2, 9.2, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.15, 17.7, 13, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 1.15, 16.7, 6, 0.8, { size: d.type.footer, color: d.p.accent, heading: true });
  const media: Frame = { x: 15.6, y: 0, w: W - 15.6, h: H };
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.shape('intentional-text-panel', media.x, media.y, media.w, media.h, { fill: d.p.secondary });
    d.text('panel-headline', panel.headline, media.x + 0.7, 2.2, media.w - 1.4, 3.2, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text('panel-body', panel.body, media.x + 0.7, 6.0, media.w - 1.4, 10, { size: d.type.body, color: d.p.mist });
  } else {
    d.shape('image-bleed', media.x, media.y, media.w, media.h, { fill: d.p.secondary });
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x, y: media.y, w: media.w, h: media.h }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return agenda(d, box);
    case 'bullets': return bullets(d, box);
    case 'process': return process(d, box);
    case 'cards': return cards(d, box);
    case 'timeline': return timeline(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return matrix(d, box);
    default: break;
  }
}

function agenda(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  d.shape('column-rule', box.x + 4.3, box.y, 0.06, box.h, { fill: d.p.rule });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (i > 0) d.shape(`hair-${i}`, box.x, y, box.w, 0.03, { fill: d.p.rule });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y, 3.8, step, { size: 32, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`item-${i}`, item, box.x + 4.8, y + 0.15, box.w - 5.1, step - 0.3, { size: d.type.heading, valign: 'middle' });
  });
}

function bullets(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const leadH = box.h * 0.38;
  d.shape('lead', box.x, box.y, box.w, leadH, { fill: d.p.surface });
  d.shape('lead-bar', box.x, box.y, 0.35, leadH, { fill: d.p.accent });
  d.text('item-0', items[0], box.x + 0.9, box.y + 0.35, box.w - 1.5, leadH - 0.7, { size: d.type.heading, valign: 'middle' });
  const rest = items.slice(1);
  const cols = rest.length === 1 ? 1 : 2;
  const rows = Math.ceil(rest.length / cols);
  const top = box.y + leadH + 0.35;
  const h = (box.y + box.h - top - 0.3 * (rows - 1)) / rows;
  const gap = 0.45;
  const w = (box.w - gap * (cols - 1)) / cols;
  rest.forEach((item, i) => {
    const x = box.x + (i % cols) * (w + gap);
    const y = top + Math.floor(i / cols) * (h + 0.3);
    d.text(`num-${i}`, String(i + 2).padStart(2, '0'), x, y, w, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
    d.text(`item-${i + 1}`, item, x, y + 0.9, w, h - 1.0, { size: d.type.body });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  d.shape('spine', box.x + 3.5, box.y, 0.08, box.h, { fill: d.p.accent });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y, 3.1, step, { size: 28, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`title-${i}`, item.title, box.x + 4.1, y + 0.15, box.w - 4.3, 1.3, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 4.1, y + 1.5, box.w - 4.3, step - 1.7, { size: d.type.body });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.3;
  const h = (box.h - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * (h + gap);
    d.shape(`index-${i}`, box.x, y, 3.3, h, { fill: i % 2 === 0 ? d.p.accent : d.p.secondary });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y, 3.3, h, { size: d.type.heading, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
    d.text(`title-${i}`, item.title, box.x + 3.8, y + 0.2, box.w - 4.1, 1.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 3.8, y + 1.45, box.w - 4.1, h - 1.7, { size: d.type.body });
  });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`label-${i}`, item.label, x, box.y, w, 1.6, { size: 28, color: d.p.accent, heading: true });
  });
  d.shape('rule', box.x, box.y + 1.85, box.w, 0.18, { fill: d.p.text });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`title-${i}`, item.title, x, box.y + 2.3, w, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 4.7, w, box.h - 4.9, { size: d.type.body });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const side = 9.4;
  d.chart({ x: box.x, y: box.y, w: box.w - side - 0.5, h: box.h }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.text}`);
  d.shape('note-rule', box.x + box.w - side, box.y, 0.12, box.h, { fill: d.p.accent });
  d.text('insight-k', '读图', box.x + box.w - side + 0.5, box.y, side - 0.7, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('insight', s.insight as string, box.x + box.w - side + 0.5, box.y + 1.1, side - 0.7, box.h - 1.3, { size: d.type.heading, heading: true });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const midX = box.x + box.w / 2;
  const midY = box.y + box.h / 2;
  d.shape('cross-v', midX - 0.08, box.y + 1.0, 0.16, box.h - 1.0, { fill: d.p.text });
  d.shape('cross-h', box.x, midY - 0.08, box.w, 0.16, { fill: d.p.text });
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.8, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.text('y-axis-label', s.yLabel as string, box.x, box.y + box.h - 0.8, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const w = box.w / 2 - 0.5;
  const h = (box.h - 2.0) / 2 - 0.25;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (box.w / 2) + 0.35;
    const y = box.y + 1.05 + Math.floor(i / 2) * ((box.h - 2.0) / 2);
    d.text(`cell-title-${i}`, cell.title, x, y, w, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x, y + 1.4, w, h - 1.5, { size: d.type.body });
  });
}
