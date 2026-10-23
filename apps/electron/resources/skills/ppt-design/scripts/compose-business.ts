import { contain, H, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** MBB / report_core: navy divider pages, banded content pages, equal evidence modules. */
export function paintBusiness(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    default: return body(d, frame(d));
  }
}

function frame(d: Painter): Frame {
  const eyebrow = d.slide.eyebrow;
  const subtitle = d.slide.subtitle;
  const band = 0.4 + (eyebrow ? 0.9 : 0) + 2.95 + (subtitle ? 0.9 : 0);
  d.shape('header-band', 0, 0, W, band, { fill: d.p.text });
  let y = 0.28;
  if (eyebrow) {
    d.text('eyebrow', eyebrow, 1.2, y, 30, 0.8, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
    y += 0.88;
  }
  d.text('title', d.slide.title, 1.2, y, 31.3, 2.85, { size: d.type.title, color: d.p.inverse, heading: true, valign: 'middle' });
  y += 2.95;
  if (subtitle) d.text('subtitle', subtitle, 1.2, y, 31.3, 0.8, { size: d.type.body, color: d.p.mist, valign: 'middle' });
  d.shape('footer-rule', 0, 17.72, W, 0.04, { fill: d.p.rule });
  footer(d, d.p.muted);
  const top = band + 0.38;
  return { x: 1.15, y: top, w: 31.55, h: 17.5 - top };
}

function footer(d: Painter, color: string): void {
  if (d.slide.source) d.text('source', d.slide.source, 1.2, 17.9, 26.2, 0.9, { size: d.type.footer, color, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 17.9, 3.3, 0.9, { size: d.type.footer, color, align: 'right', valign: 'middle' });
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('cover-field', 0, 0, 15.2, H, { fill: d.p.text });
  d.shape('cover-accent', 1.25, 3.55, 3.4, 0.18, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.25, 2.35, 12.6, 0.85, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('title', d.slide.title, 1.25, 4.05, 12.7, 4.6, { size: d.type.hero, color: d.p.inverse, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.25, 9.0, 12.7, 2.6, { size: d.type.body, color: d.p.mist });
  const metas: [string, string][] = [['讲者', s.presenter as string], ['日期', s.date as string]];
  if (d.slide.source) metas.push(['来源', d.slide.source]);
  const gap = 0.4;
  const h = (H - 1.7 - gap * 2) / 3;
  metas.forEach((pair, i) => {
    const y = 0.7 + i * (h + gap);
    d.shape(`meta-${i}`, 16.15, y, 16.7, h, { fill: d.p.surface });
    d.shape(`meta-bar-${i}`, 16.15, y, 0.22, h, { fill: d.p.accent });
    d.text(`meta-k-${i}`, pair[0], 16.75, y + 0.35, 15.6, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    d.text(`meta-v-${i}`, pair[1], 16.75, y + 1.2, 15.6, h - 1.6, { size: d.type.heading, valign: 'top' });
  });
  d.text('page', pageNo(d.index), 1.25, 17.85, 4, 0.85, { size: d.type.footer, color: d.p.mist, valign: 'middle' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('section-field', 0, 0, W, H, { fill: d.p.text });
  d.shape('section-accent', 0, 16.55, W, 2.5, { fill: d.p.accent });
  d.text('section-number', s.number as string, 19.2, 1.1, 13.2, 7.2, { size: 108, color: d.p.secondary, heading: true, align: 'right' });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 4.3, 16.5, 0.8, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 5.3, 16.8, 4.2, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.4, 10.2, 20, 4.6, { size: d.type.heading, color: d.p.mist });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.4, 16.9, 24, 1.5, { size: d.type.body, color: d.p.inverse, valign: 'middle' });
  d.text('page', pageNo(d.index), 28.5, 16.9, 4, 1.5, { size: d.type.footer, color: d.p.inverse, align: 'right', valign: 'middle' });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 15.2, 18, 0.9, { size: d.type.footer, color: d.p.mist });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  d.shape('closing-field', 0, 0, W, H, { fill: d.p.text });
  d.shape('closing-bar', 0, 14.7, W, 4.35, { fill: d.p.inverse });
  d.shape('closing-accent', 1.4, 4.6, 3.6, 0.18, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 3.3, 28, 0.9, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('title', d.slide.title, 1.4, 5.1, 30, 3.6, { size: d.type.hero, color: d.p.inverse, heading: true });
  d.text('body', s.body as string, 1.4, 9.1, 28, 4.2, { size: d.type.heading, color: d.p.mist });
  d.text('contact-k', '下一步', 1.4, 15.15, 8, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('contact', s.contact as string, 1.4, 16.05, 28, 1.8, { size: d.type.heading, color: d.p.text });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.4, 13.5, 24, 0.9, { size: d.type.body, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 16.7, 3.3, 1.2, { size: d.type.footer, color: d.p.muted, align: 'right', valign: 'middle' });
  if (d.slide.source) d.text('source', d.slide.source, 18, 15.15, 12, 0.8, { size: d.type.footer, color: d.p.muted, align: 'right' });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  d.shape('kpi-field', 0, 0, 15.4, H, { fill: d.p.text });
  d.shape('kpi-accent', 1.3, 3.3, 3.2, 0.16, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.3, 2.15, 12.6, 0.8, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('value', s.value as string, 1.2, 4.0, 13, 4.2, { size: d.type.number, color: d.p.inverse, heading: true });
  d.text('label', s.label as string, 1.3, 8.6, 12.6, 2.6, { size: d.type.heading, color: d.p.inverse, heading: true });
  d.text('title', d.slide.title, 16.5, 1.8, 15.8, 3.4, { size: d.type.title, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 16.5, 5.4, 15.8, 1.6, { size: d.type.body, color: d.p.muted });
  const contextY = d.slide.subtitle ? 7.3 : 5.8;
  d.shape('kpi-context', 16.5, contextY, 15.9, 17.3 - contextY, { fill: d.p.surface });
  d.text('context', s.context as string, 17.1, contextY + 0.5, 14.7, 17.3 - contextY - 1.1, { size: d.type.body });
  if (d.slide.source) d.text('source', d.slide.source, 1.3, 17.7, 12.6, 0.9, { size: d.type.footer, color: d.p.mist });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.9, { size: d.type.footer, color: d.p.muted, align: 'right' });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  d.shape('quote-field', 0, 0, 8.4, H, { fill: d.p.text });
  d.text('mark', '“', 0.7, 3.2, 7, 5.5, { size: 96, color: d.p.accent, heading: true, align: 'center' });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 9.4, 1.5, 22, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 9.4, 2.5, 22.6, 2.6, { size: d.type.title, heading: true });
  d.text('quote', s.quote as string, 9.4, 5.6, 22.6, 8.2, { size: d.type.quote, heading: true });
  d.shape('quote-rule', 9.4, 14.2, 3.2, 0.12, { fill: d.p.accent });
  d.text('attribution', s.attribution as string, 9.4, 14.6, 22.6, 1.6, { size: d.type.body, color: d.p.muted });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 9.4, 16.3, 22, 0.9, { size: d.type.label, color: d.p.muted });
  if (d.slide.source) d.text('source', d.slide.source, 9.4, 17.7, 18, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.9, { size: d.type.footer, color: d.p.muted, align: 'right' });
}

function body(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  switch (d.slide.layout) {
    case 'agenda': return rows(d, box, s.items as string[], true);
    case 'bullets': return rows(d, box, s.items as string[], false);
    case 'comparison': return comparison(d, box);
    case 'process': return process(d, box);
    case 'cards': return cards(d, box);
    case 'timeline': return timeline(d, box);
    case 'chart': return chart(d, box);
    case 'matrix': return matrix(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function rows(d: Painter, box: Frame, items: string[], agenda: boolean): void {
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (agenda) {
      if (i % 2 === 0) d.shape(`row-${i}`, box.x, y + 0.08, box.w, step - 0.16, { fill: d.p.surface });
      d.shape(`badge-${i}`, box.x + 0.4, y + (step - 1.5) / 2, 1.5, 1.5, { fill: d.p.accent });
      d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x + 0.4, y + (step - 1.5) / 2, 1.5, 1.5, { size: d.type.label, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
      d.text(`item-${i}`, item, box.x + 2.4, y + 0.2, box.w - 3.1, step - 0.4, { size: d.type.heading, valign: 'middle' });
    } else {
      d.shape(`card-${i}`, box.x, y + 0.12, box.w, step - 0.24, { fill: d.p.surface });
      d.shape(`bar-${i}`, box.x, y + 0.12, 0.42, step - 0.24, { fill: i === 0 ? d.p.accent : d.p.text });
      d.text(`item-${i}`, item, box.x + 1.05, y + 0.3, box.w - 1.6, step - 0.6, { size: d.type.body, valign: 'middle' });
    }
  });
}

function comparison(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const gap = 0.45;
  const w = (box.w - gap) / 2;
  (['left', 'right'] as const).forEach((key, i) => {
    const x = box.x + i * (w + gap);
    const side = s[key] as { heading: string; body: string };
    d.shape(`card-${key}`, x, box.y, w, box.h, { fill: d.p.surface });
    d.shape(`head-${key}`, x, box.y, w, 1.7, { fill: i === 0 ? d.p.text : d.p.accent });
    d.text(`${key}-heading`, side.heading, x + 0.5, box.y + 0.2, w - 1, 1.35, { size: d.type.heading, color: d.p.inverse, heading: true, valign: 'middle' });
    d.text(`${key}-body`, side.body, x + 0.55, box.y + 2.15, w - 1.1, box.h - 2.7, { size: d.type.body });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.42;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  d.shape('rail', box.x + w / 2, box.y + 0.7, box.w - w, 0.14, { fill: d.p.accent });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`node-${i}`, x + w / 2 - 0.72, box.y + 0.12, 1.44, 1.44, { geometry: 'ellipse', fill: d.p.text });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), x + w / 2 - 0.72, box.y + 0.12, 1.44, 1.44, { size: 14, color: d.p.inverse, align: 'center', valign: 'middle', heading: true, bold: true });
    d.shape(`card-${i}`, x, box.y + 2.05, w, box.h - 2.05, { fill: d.p.surface });
    d.text(`title-${i}`, item.title, x + 0.35, box.y + 2.3, w - 0.7, 2.4, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.35, box.y + 4.85, w - 0.7, box.h - 5.2, { size: d.type.body });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`card-${i}`, x, box.y, w, box.h, { fill: d.p.surface });
    d.shape(`stripe-${i}`, x, box.y, w, 0.42, { fill: i % 2 === 0 ? d.p.accent : d.p.text });
    d.text(`title-${i}`, item.title, x + 0.4, box.y + 0.8, w - 0.8, 2.6, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.4, box.y + 3.6, w - 0.8, box.h - 4.1, { size: d.type.body });
  });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const gap = 0.4;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  d.shape('time-bar', box.x, box.y + 1.55, box.w, 0.16, { fill: d.p.text });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.text(`label-${i}`, item.label, x, box.y, w, 1.15, { size: d.type.heading, color: d.p.accent, heading: true });
    d.shape(`node-${i}`, x + 0.15, box.y + 1.28, 0.7, 0.7, { geometry: 'ellipse', fill: d.p.accent });
    d.shape(`card-${i}`, x, box.y + 2.35, w, box.h - 2.35, { fill: d.p.surface });
    d.text(`title-${i}`, item.title, x + 0.4, box.y + 2.6, w - 0.8, 2.2, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.4, box.y + 5.0, w - 0.8, box.h - 5.4, { size: d.type.body });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const insightW = 9.1;
  const chartW = box.w - insightW - 0.4;
  d.shape('chart-well', box.x, box.y, chartW, box.h, { fill: d.p.surface });
  d.chart({ x: box.x + 0.25, y: box.y + 0.25, w: chartW - 0.5, h: box.h - 0.5 }, s as ChartSlots, `${d.p.accent},${d.p.text},${d.p.secondary}`);
  d.shape('insight', box.x + chartW + 0.4, box.y, insightW, box.h, { fill: d.p.text });
  d.text('insight-k', '读数', box.x + chartW + 0.85, box.y + 0.5, insightW - 1.2, 0.7, { size: d.type.label, color: d.p.mist, heading: true, bold: true });
  d.text('insight', s.insight as string, box.x + chartW + 0.85, box.y + 1.5, insightW - 1.3, box.h - 2.2, { size: d.type.heading, color: d.p.inverse, heading: true });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x + 4.2, box.y, box.w - 4.2, 0.9, { size: d.type.body, color: d.p.accent, align: 'center' });
  d.text('y-axis-label', s.yLabel as string, box.x, box.y + 1.1, 3.6, box.h - 1.1, { size: d.type.body, color: d.p.accent });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.35;
  const w = (box.w - 4.2 - gap) / 2;
  const h = (box.h - 1.2 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + 4.2 + (i % 2) * (w + gap);
    const y = box.y + 1.15 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { fill: d.p.surface });
    d.shape(`cell-head-${i}`, x, y, w, 1.4, { fill: i === 0 ? d.p.accent : d.p.text });
    d.text(`cell-title-${i}`, cell.title, x + 0.4, y + 0.12, w - 0.8, 1.15, { size: d.type.heading, color: d.p.inverse, heading: true, valign: 'middle' });
    d.text(`cell-body-${i}`, cell.body, x + 0.4, y + 1.65, w - 0.8, h - 2.0, { size: d.type.body });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 13.4;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.5, y: box.y, w: box.w - textW - 0.5, h: box.h };
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.shape('intentional-text-panel', media.x, media.y, media.w, media.h, { fill: d.p.text });
    d.text('panel-headline', panel.headline, media.x + 0.55, media.y + 0.55, media.w - 1.1, 2.4, { size: d.type.heading, color: d.p.inverse, heading: true });
    d.text('panel-body', panel.body, media.x + 0.55, media.y + 3.3, media.w - 1.1, media.h - 4, { size: d.type.body, color: d.p.mist });
  } else {
    d.shape('image-well', media.x, media.y, media.w, media.h, { fill: d.p.surface });
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ ...media, x: media.x + 0.3, y: media.y + 0.3, w: media.w - 0.6, h: media.h - 0.6 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
