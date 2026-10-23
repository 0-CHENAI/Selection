import { contain, H, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Data journalism / operating review: rail, KPI strip, chart-first callouts. */
export function paintDataBrief(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    case 'chart': return chart(d);
    default: return body(d, frame(d));
  }
}

function frame(d: Painter): Frame {
  d.shape('rail', 0, 0, 4.6, H, { fill: d.p.text });
  d.text('page', pageNo(d.index), 0.35, 0.7, 3.9, 1.3, { size: 22, color: d.p.accent, heading: true, bold: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 0.35, 2.2, 3.9, 4.6, { size: d.type.label, color: d.p.mist, heading: true });
  d.text('title', d.slide.title, 5.0, 0.55, 27.4, 2.7, { size: d.type.title, heading: true });
  let y = 3.4;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 5.0, y, 27, 0.85, { size: d.type.body, color: d.p.muted });
    y += 0.95;
  }
  if (d.slide.source) d.text('source', d.slide.source, 5.0, 17.95, 22, 0.8, { size: d.type.footer, color: d.p.muted });
  return { x: 5.0, y: y + 0.15, w: 27.5, h: 17.7 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('head', 0, 0, W, 3.1, { fill: d.p.text });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.3, 0.85, 30, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.3, 1.6, 31.2, 1.3, { size: 28, color: d.p.inverse, heading: true, valign: 'middle' });
  const tiles: [string, string][] = [['讲者', s.presenter as string], ['日期', s.date as string], ['口径', d.slide.source ?? '演示测算']];
  tiles.forEach((tile, i) => {
    const x = 1.2 + i * 10.7;
    d.shape(`kpi-${i}`, x, 3.6, 10.3, 10.4, { fill: i === 1 ? d.p.secondary : d.p.surface });
    d.shape(`tick-${i}`, x, 3.6, 10.3, 0.22, { fill: d.p.accent });
    d.text(`k-${i}`, tile[0], x + 0.5, 4.1, 9.3, 0.8, { size: d.type.label, color: i === 1 ? d.p.mist : d.p.accent, heading: true, bold: true });
    d.text(`v-${i}`, tile[1], x + 0.5, 5.2, 9.3, 8.0, { size: d.type.heading, color: i === 1 ? d.p.inverse : d.p.text, heading: true });
  });
  d.shape('foot', 0, 14.5, W, 4.55, { fill: d.p.text });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.3, 15.0, 31, 2.4, { size: d.type.body, color: d.p.inverse });
  d.text('page', pageNo(d.index), 29.2, 17.6, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('field', 0, 0, W, H, { fill: d.p.text });
  d.shape('tick', 0, 0, W, 0.22, { fill: d.p.accent });
  d.text('section-number', s.number as string, 1.4, 1.6, 12, 3.6, { size: 56, color: d.p.accent, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 5.4, 30, 0.8, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 6.3, 30.8, 4.2, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.4, 10.9, 30.8, 5.4, { size: d.type.heading, color: d.p.mist });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.6, 24, 0.9, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 17.6, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('field', 0, 0, W, 12.4, { fill: d.p.text });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 1.4, 30, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 2.4, 30.8, 3.8, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.4, 6.6, 30.8, 4.6, { size: d.type.heading, color: d.p.mist });
  d.shape('action', 0, 12.4, W, 6.65, { fill: d.p.accent });
  d.text('contact', s.contact as string, 1.4, 13.2, 30.8, 3.8, { size: d.type.heading, color: d.p.inverse, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.5, 22, 0.9, { size: d.type.footer, color: d.p.text });
  d.text('page', pageNo(d.index), 29.2, 17.5, 3.3, 0.9, { size: d.type.footer, color: d.p.text, align: 'right' });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  d.shape('strip', 0, 0, W, 7.4, { fill: d.p.text });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.3, 0.55, 30, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('value', s.value as string, 1.3, 1.4, 20, 4.2, { size: d.type.number, color: d.p.accent, heading: true });
  d.text('label', s.label as string, 1.3, 5.7, 31, 1.3, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.text('title', d.slide.title, 1.3, 7.8, 31.2, 2.4, { size: d.type.title, heading: true });
  d.text('context', s.context as string, 1.3, 10.5, 31.2, 6.0, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.3, 17.8, 24, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.8, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right' });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  d.shape('pull', box.x, box.y, 0.28, box.h, { fill: d.p.accent });
  d.text('quote', s.quote as string, box.x + 0.8, box.y + 0.3, box.w - 1.1, box.h - 3.4, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, box.x + 0.8, box.y + box.h - 2.8, box.w - 1.1, 2.2, { size: d.type.body, color: d.p.muted });
}

function chart(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  const side = 9.0;
  d.shape('plot', box.x, box.y, box.w - side - 0.35, box.h, { fill: d.p.surface });
  d.chart({ x: box.x + 0.2, y: box.y + 0.2, w: box.w - side - 0.75, h: box.h - 0.4 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.text}`);
  d.shape('call', box.x + box.w - side, box.y, side, box.h, { fill: d.p.text });
  d.text('insight-k', '读数', box.x + box.w - side + 0.4, box.y + 0.4, side - 0.8, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('insight', s.insight as string, box.x + box.w - side + 0.4, box.y + 1.3, side - 0.8, box.h - 1.9, { size: d.type.heading, color: d.p.inverse, heading: true });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return table(d, box);
    case 'bullets': return table(d, box);
    case 'comparison': return comparison(d, box);
    case 'process': return funnel(d, box);
    case 'cards': return tiles(d, box);
    case 'timeline': return gantt(d, box);
    case 'matrix': return matrix(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function table(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (i % 2 === 0) d.shape(`row-${i}`, box.x, y, box.w, step, { fill: d.p.surface });
    d.shape(`bar-${i}`, box.x, y + 0.2, 0.18, step - 0.4, { fill: d.p.accent });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x + 0.45, y, 2.0, step, { size: d.type.label, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`item-${i}`, item, box.x + 2.6, y + 0.15, box.w - 2.9, step - 0.3, { size: d.type.heading, valign: 'middle' });
  });
}

function comparison(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  const w = (box.w - 0.4) / 2;
  ([left, right] as const).forEach((side, i) => {
    const x = box.x + i * (w + 0.4);
    d.shape(`col-${i}`, x, box.y, w, box.h, { fill: d.p.surface });
    d.shape(`spark-${i}`, x, box.y, w * (i === 0 ? 0.45 : 0.78), 0.28, { fill: i === 0 ? d.p.muted : d.p.accent });
    d.text(`${i}-heading`, side.heading, x + 0.45, box.y + 0.6, w - 0.9, 2.0, { size: d.type.heading, heading: true });
    d.text(`${i}-body`, side.body, x + 0.45, box.y + 2.8, w - 0.9, box.h - 3.3, { size: d.type.body });
  });
}

function funnel(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    const insetX = i * 0.55;
    d.shape(`bar-${i}`, box.x + insetX, y + 0.12, box.w - insetX * 2, step - 0.24, { fill: i === 0 ? d.p.accent : d.p.surface });
    const color = i === 0 ? d.p.inverse : d.p.text;
    d.text(`title-${i}`, item.title, box.x + insetX + 0.45, y + 0.2, box.w - insetX * 2 - 0.9, 1.2, { size: d.type.heading, color, heading: true });
    d.text(`body-${i}`, item.body, box.x + insetX + 0.45, y + 1.45, box.w - insetX * 2 - 0.9, step - 1.75, { size: d.type.body, color });
  });
}

function tiles(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.35;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`tile-${i}`, x, box.y, w, box.h, { fill: d.p.surface });
    d.shape(`tick-${i}`, x, box.y, w, 0.2, { fill: i === 0 ? d.p.accent : d.p.secondary });
    d.text(`title-${i}`, item.title, x + 0.35, box.y + 0.5, w - 0.7, 2.4, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.35, box.y + 3.1, w - 0.7, box.h - 3.5, { size: d.type.body });
  });
}

function gantt(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.text(`label-${i}`, item.label, box.x, y, 4.6, step, { size: d.type.heading, color: d.p.accent, heading: true, valign: 'middle' });
    d.shape(`bar-${i}`, box.x + 5.0, y + step * 0.28, 6 + i * 3.2, step * 0.44, { fill: d.p.secondary });
    d.text(`title-${i}`, item.title, box.x + 5.15, y + 0.1, 14, 1.1, { size: d.type.label, color: d.p.inverse, heading: true });
    d.text(`body-${i}`, item.body, box.x + 19.2, y + 0.15, box.w - 19.4, step - 0.3, { size: d.type.body, valign: 'middle' });
  });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x, box.y, box.w, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.3;
  const w = (box.w - gap) / 2;
  const h = (box.h - 0.85 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + (i % 2) * (w + gap);
    const y = box.y + 0.8 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { fill: d.p.surface });
    d.shape(`tick-${i}`, x, y, 0.2, h, { fill: d.p.accent });
    d.text(`cell-title-${i}`, cell.title, x + 0.5, y + 0.25, w - 0.8, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x + 0.5, y + 1.7, w - 0.8, h - 2.0, { size: d.type.body });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 12.4;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.4, y: box.y, w: box.w - textW - 0.4, h: box.h };
  d.shape('exhibit', media.x, media.y, media.w, media.h, { fill: d.p.surface });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.45, media.y + 0.4, media.w - 0.9, 2.2, { size: d.type.heading, heading: true });
    d.text('panel-body', panel.body, media.x + 0.45, media.y + 2.8, media.w - 0.9, media.h - 3.3, { size: d.type.body });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.25, y: media.y + 0.25, w: media.w - 0.5, h: media.h - 0.5 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
