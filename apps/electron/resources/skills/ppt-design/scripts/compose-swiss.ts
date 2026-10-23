import { contain, H, inset, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Swiss-minimal: flush type, hairlines, one red plane, architectural numerals. */
export function paintSwiss(d: Painter): void {
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

function rule(d: Painter, name: string, x: number, y: number, w: number, h = 0.04): void {
  d.shape(name, x, y, w, h, { fill: d.p.rule });
}

function frame(d: Painter): Frame {
  d.shape('top-rule', 0, 0, W, 0.06, { fill: d.p.text });
  let y = 0.45;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.4, y, 26, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    y += 0.75;
  }
  d.text('title', d.slide.title, 1.4, y, 30.8, 2.9, { size: d.type.title, heading: true });
  y += 3.05;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.4, y, 30, 0.9, { size: d.type.body, color: d.p.muted });
    y += 1.0;
  }
  rule(d, 'head-rule', 1.4, y, 4.2, 0.1);
  y += 0.35;
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.9, 26, 0.85, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 17.9, 3.3, 0.85, { size: d.type.footer, color: d.p.text, align: 'right', valign: 'middle', heading: true });
  return { x: 1.4, y, w: 31.1, h: 17.65 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('mast', 0, 0, W, 2.6, { fill: d.p.text });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 0.75, 30, 1.1, { size: d.type.label, color: d.p.inverse, heading: true, bold: true, valign: 'middle' });
  d.shape('accent-plane', 0, 2.6, 0.55, 16.45, { fill: d.p.accent });
  d.text('title', d.slide.title, 1.9, 3.4, 30.2, 5.4, { size: d.type.hero, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.9, 9.0, 22, 2.2, { size: d.type.body, color: d.p.muted });
  rule(d, 'meta-rule', 1.9, 12.4, 30.1, 0.06);
  const metas: [string, string][] = [['讲者', s.presenter as string], ['日期', s.date as string], ['来源', d.slide.source ?? '现场材料']];
  metas.forEach((pair, i) => {
    const x = 1.9 + i * 10.2;
    if (i) d.shape(`meta-div-${i}`, x - 0.35, 12.7, 0.04, 4.6, { fill: d.p.rule });
    d.text(`meta-k-${i}`, pair[0], x, 12.85, 9.5, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    d.text(`meta-v-${i}`, pair[1], x, 13.65, 9.5, 2.8, { size: d.type.heading, heading: true });
  });
  d.text('page', pageNo(d.index), 29.4, 0.85, 3, 0.9, { size: d.type.footer, color: d.p.inverse, align: 'right', heading: true });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('red-column', 0, 0, 9.4, H, { fill: d.p.accent });
  const num = inset(0.7, 2.2, 8.0, 6.4);
  d.text('section-number', s.number as string, num.x, num.y, num.w, num.h, { size: 96, color: d.p.inverse, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 10.6, 3.4, 21.4, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 10.6, 4.4, 21.6, 4.6, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 10.6, 9.4, 21.4, 5.8, { size: d.type.heading });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 10.6, 16.0, 18, 1.2, { size: d.type.body, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 10.6, 17.7, 18, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, align: 'right', heading: true });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('field', 0, 0, W, H, { fill: d.p.text });
  d.shape('red', 0, 0, 0.55, H, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.8, 2.4, 29, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.8, 3.5, 30, 4.4, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.8, 8.3, 29, 4.2, { size: d.type.heading, color: d.p.mist });
  rule(d, 'close-rule', 1.8, 13.2, 5, 0.1);
  d.text('contact', s.contact as string, 1.8, 13.7, 29, 2.6, { size: d.type.heading, color: d.p.inverse, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.8, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.inverse, align: 'right', heading: true });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 0.7, 30, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 1.5, 30.8, 2.8, { size: d.type.title, heading: true });
  d.shape('split', 16.9, 4.7, 0.05, 12.4, { fill: d.p.text });
  d.text('left-heading', left.heading, 1.5, 4.8, 14.6, 1.8, { size: d.type.heading, heading: true });
  d.text('left-body', left.body, 1.5, 6.8, 14.6, 9.4, { size: d.type.body });
  d.text('right-heading', right.heading, 17.6, 4.8, 14.6, 1.8, { size: d.type.heading, color: d.p.accent, heading: true });
  d.text('right-body', right.body, 17.6, 6.8, 14.6, 9.4, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 17.8, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.8, 3.3, 0.85, { size: d.type.footer, align: 'right', heading: true });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 0.7, 30, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 1.5, 30.8, 2.4, { size: d.type.title, heading: true });
  const num = inset(1.5, 4.2, 20, 5.2);
  d.text('value', s.value as string, num.x, num.y, num.w, num.h, { size: d.type.number, color: d.p.accent, heading: true });
  d.shape('bar', 1.5, 9.6, 8.2, 0.22, { fill: d.p.text });
  d.text('label', s.label as string, 1.5, 10.1, 30.8, 1.6, { size: d.type.heading, heading: true });
  d.text('context', s.context as string, 1.5, 12.0, 30.8, 4.4, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 17.8, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.8, 3.3, 0.85, { size: d.type.footer, align: 'right', heading: true });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  d.shape('red', 0, 0, 0.55, H, { fill: d.p.accent });
  d.text('mark', '“', 1.6, 2.0, 6, 3.3, { size: 72, color: d.p.accent, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.6, 5.0, 30, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.6, 5.8, 30.4, 2.2, { size: d.type.title, heading: true });
  d.text('quote', s.quote as string, 1.6, 8.3, 30.4, 5.6, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, 1.6, 14.2, 30.4, 1.6, { size: d.type.body, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 1.6, 17.8, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.8, 3.3, 0.85, { size: d.type.footer, align: 'right', heading: true });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return rows(d, box, true);
    case 'bullets': return rows(d, box, false);
    case 'process': return process(d, box);
    case 'cards': return cards(d, box);
    case 'timeline': return timeline(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return matrix(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function rows(d: Painter, box: Frame, agenda: boolean): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (i) rule(d, `hair-${i}`, box.x, y, box.w);
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x, y + 0.15, 2.6, step - 0.3, {
      size: agenda ? 28 : d.type.label, color: d.p.accent, heading: true, valign: 'middle',
    });
    d.text(`item-${i}`, item, box.x + 3.1, y + 0.15, box.w - 3.3, step - 0.3, { size: agenda ? d.type.heading : d.type.body, valign: 'middle' });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.5;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  d.shape('axis', box.x, box.y + 1.15, box.w, 0.05, { fill: d.p.text });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`tick-${i}`, x, box.y + 0.95, 0.45, 0.45, { fill: d.p.accent });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), x, box.y + 1.7, w, 1.1, { size: 22, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, x, box.y + 2.9, w, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 5.3, w, box.h - 5.5, { size: d.type.body });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.55;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    if (i) d.shape(`col-${i}`, x - gap / 2, box.y, 0.04, box.h, { fill: d.p.rule });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), x, box.y, w, 1.1, { size: d.type.label, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, x, box.y + 1.3, w, 2.4, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 3.9, w, box.h - 4.1, { size: d.type.body });
  });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.45;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`label-${i}`, item.label, x, box.y, w, 1.8, { size: 26, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, x, box.y + 2.1, w, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x, box.y + 4.5, w, box.h - 4.7, { size: d.type.body });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const caption = 3.5;
  d.chart({ x: box.x, y: box.y, w: box.w, h: box.h - caption - 0.25 }, s as ChartSlots, `${d.p.accent},${d.p.text},${d.p.secondary}`);
  rule(d, 'cap-rule', box.x, box.y + box.h - caption, 3.4, 0.1);
  d.text('insight', s.insight as string, box.x, box.y + box.h - caption + 0.3, box.w, caption - 0.4, { size: d.type.heading, heading: true });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.75, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.text('y-axis-label', s.yLabel as string, box.x, box.y + box.h - 0.85, box.w, 0.8, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.shape('v', box.x + box.w / 2 - 0.03, box.y + 0.9, 0.06, box.h - 1.8, { fill: d.p.text });
  d.shape('h', box.x, box.y + box.h / 2 - 0.03, box.w, 0.06, { fill: d.p.text });
  const cells = s.cells as { title: string; body: string }[];
  const w = box.w / 2 - 0.55;
  const h = (box.h - 2.0) / 2 - 0.25;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (box.w / 2) + 0.3;
    const y = box.y + 1.0 + Math.floor(i / 2) * ((box.h - 2.0) / 2);
    d.text(`cell-title-${i}`, cell.title, x, y, w, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x, y + 1.4, w, h - 1.5, { size: d.type.body });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 14.2;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.6, y: box.y, w: box.w - textW - 0.6, h: box.h };
  d.shape('media-plane', media.x, media.y, media.w, media.h, { fill: d.p.text });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.55, media.y + 0.55, media.w - 1.1, 2.4, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text('panel-body', panel.body, media.x + 0.55, media.y + 3.2, media.w - 1.1, media.h - 3.9, { size: d.type.body, color: d.p.inverse });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ ...media, x: media.x + 0.3, y: media.y + 0.3, w: media.w - 0.6, h: media.h - 0.6 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
