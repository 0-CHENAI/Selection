import { contain, H, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** Academic research: running header, two-column body, figure captions, footnote band. */
export function paintAcademic(d: Painter): void {
  switch (d.slide.layout) {
    case 'cover': return cover(d);
    case 'section': return section(d);
    case 'closing': return closing(d);
    case 'comparison': return comparison(d);
    case 'big-number': return kpi(d);
    case 'quote': return quote(d);
    case 'chart': return chart(d);
    default: return body(d, frame(d));
  }
}

function chrome(d: Painter): void {
  d.shape('run-rule', 1.4, 0.55, 31.1, 0.05, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.4, 0.68, 22, 0.8, { size: d.type.label, color: d.p.accent, heading: true });
  d.text('page', pageNo(d.index), 29.2, 0.68, 3.3, 0.8, { size: d.type.footer, color: d.p.muted, align: 'right' });
  d.shape('foot-band', 0, 17.85, W, 1.2, { fill: d.p.surface });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 18.0, 31, 0.85, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
}

function frame(d: Painter): Frame {
  chrome(d);
  d.text('title', d.slide.title, 1.4, 1.5, 31, 2.7, { size: d.type.title, heading: true });
  d.shape('title-rule', 1.4, 4.3, 4.0, 0.07, { fill: d.p.secondary });
  let y = 4.55;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.4, y, 31, 0.9, { size: d.type.body, color: d.p.muted });
    y += 1.05;
  }
  return { x: 1.4, y, w: 31.1, h: 17.55 - y };
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('top-rule', 8.5, 2.3, 16.9, 0.08, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 3, 2.6, 27.8, 0.8, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.text('title', d.slide.title, 3.2, 3.6, 27.4, 5.2, { size: d.type.hero, align: 'center', heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 5, 9.1, 23.8, 2.2, { size: d.type.body, color: d.p.muted, align: 'center' });
  d.shape('author-rule', 13.4, 11.7, 7, 0.06, { fill: d.p.rule });
  d.text('presenter', s.presenter as string, 4, 12.1, 25.8, 1.5, { size: d.type.heading, align: 'center', heading: true });
  d.text('date', s.date as string, 4, 13.7, 25.8, 1.2, { size: d.type.body, color: d.p.muted, align: 'center' });
  d.shape('foot-band', 0, 16.4, W, 2.65, { fill: d.p.accent });
  d.text('source', d.slide.source ?? '演示材料，供方法讨论', 1.6, 17.1, 30.6, 1.3, { size: d.type.footer, color: d.p.inverse, valign: 'middle' });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  chrome(d);
  d.text('section-number', s.number as string, 1.4, 2.0, 8, 2.4, { size: 40, color: d.p.accent, heading: true });
  d.text('title', d.slide.title, 1.4, 5.3, 30.8, 3.6, { size: d.type.hero, heading: true });
  d.shape('rule', 1.4, 9.1, 6.2, 0.08, { fill: d.p.secondary });
  d.text('body', s.body as string, 1.4, 9.5, 30.8, 6.6, { size: d.type.heading });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.4, 16.4, 24, 1.1, { size: d.type.body, color: d.p.muted });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  chrome(d);
  d.text('title', d.slide.title, 3.2, 3.2, 27.4, 3.8, { size: d.type.hero, align: 'center', heading: true });
  d.text('body', s.body as string, 4.4, 7.4, 25, 5.2, { size: d.type.heading, align: 'center' });
  d.shape('rule', 13.4, 13.0, 7, 0.06, { fill: d.p.accent });
  d.text('contact', s.contact as string, 3.2, 13.4, 27.4, 2.6, { size: d.type.heading, align: 'center', heading: true });
}

function comparison(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  const left = s.left as { heading: string; body: string };
  const right = s.right as { heading: string; body: string };
  const w = (box.w - 0.5) / 2;
  d.shape('head-l', box.x, box.y, w, 1.5, { fill: d.p.accent });
  d.shape('head-r', box.x + w + 0.5, box.y, w, 1.5, { fill: d.p.secondary });
  d.text('left-heading', left.heading, box.x + 0.4, box.y + 0.15, w - 0.8, 1.2, { size: d.type.heading, color: d.p.inverse, heading: true, valign: 'middle' });
  d.text('right-heading', right.heading, box.x + w + 0.9, box.y + 0.15, w - 0.8, 1.2, { size: d.type.heading, color: d.p.inverse, heading: true, valign: 'middle' });
  d.text('left-body', left.body, box.x + 0.35, box.y + 1.8, w - 0.7, box.h - 2.0, { size: d.type.body });
  d.text('right-body', right.body, box.x + w + 0.85, box.y + 1.8, w - 0.7, box.h - 2.0, { size: d.type.body });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  chrome(d);
  d.text('title', d.slide.title, 1.4, 1.6, 31, 2.4, { size: d.type.title, heading: true });
  d.shape('figure-well', 1.4, 4.3, 31.1, 8.4, { fill: d.p.surface });
  d.text('value', s.value as string, 1.8, 4.7, 30.2, 4.4, { size: d.type.number, color: d.p.accent, align: 'center', heading: true });
  d.text('label', s.label as string, 1.8, 9.3, 30.2, 2.6, { size: d.type.heading, align: 'center', heading: true });
  d.text('fig-k', '图 1', 1.4, 12.9, 4, 0.7, { size: d.type.label, color: d.p.secondary, heading: true });
  d.text('context', s.context as string, 1.4, 13.7, 31.1, 3.7, { size: d.type.body });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  chrome(d);
  d.text('title', d.slide.title, 3.4, 2.2, 27, 2.2, { size: d.type.title, align: 'center', heading: true });
  d.text('quote', s.quote as string, 4.2, 5.0, 25.4, 7.2, { size: d.type.quote, align: 'center', heading: true });
  d.text('attribution', `— ${s.attribution as string}`, 4.2, 12.6, 25.4, 1.8, { size: d.type.body, color: d.p.muted, align: 'center' });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 4.2, 14.8, 25.4, 1.4, { size: d.type.label, color: d.p.muted, align: 'center' });
}

function chart(d: Painter): void {
  const s = d.slide.slots;
  const box = frame(d);
  const caption = 3.2;
  d.shape('figure-well', box.x, box.y, box.w, box.h - caption, { fill: d.p.surface });
  d.chart({ x: box.x + 0.3, y: box.y + 0.25, w: box.w - 0.6, h: box.h - caption - 0.5 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.text}`);
  d.text('fig-k', '图注', box.x, box.y + box.h - caption + 0.15, 3.2, 0.7, { size: d.type.label, color: d.p.secondary, heading: true });
  d.text('insight', s.insight as string, box.x + 3.4, box.y + box.h - caption + 0.15, box.w - 3.4, caption - 0.3, { size: d.type.heading, valign: 'middle' });
}

function body(d: Painter, box: Frame): void {
  switch (d.slide.layout) {
    case 'agenda': return columns(d, box, d.slide.slots.items as string[], true);
    case 'bullets': return columns(d, box, d.slide.slots.items as string[], false);
    case 'process': return process(d, box);
    case 'cards': return cards(d, box);
    case 'timeline': return timeline(d, box);
    case 'matrix': return matrix(d, box);
    case 'image-text': return imageText(d, box);
    default: break;
  }
}

function columns(d: Painter, box: Frame, items: string[], numbered: boolean): void {
  const mid = Math.ceil(items.length / 2);
  const cols = [items.slice(0, mid), items.slice(mid)];
  cols.forEach((col, c) => {
    const x = box.x + c * (box.w / 2 + 0.25);
    const w = box.w / 2 - 0.35;
    const step = box.h / Math.max(col.length, 1);
    col.forEach((item, i) => {
      const y = box.y + i * step;
      const n = c === 0 ? i + 1 : mid + i + 1;
      if (numbered) d.text(`num-${n}`, `${n}.`, x, y, 1.4, step, { size: d.type.heading, color: d.p.accent, heading: true, valign: 'middle' });
      d.text(`item-${n}`, item, x + (numbered ? 1.6 : 0), y + 0.1, w - (numbered ? 1.7 : 0.1), step - 0.2, { size: d.type.body, valign: 'middle' });
    });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.text(`num-${i}`, `${i + 1}.`, box.x, y, 1.6, 1.3, { size: d.type.heading, color: d.p.accent, heading: true });
    d.text(`title-${i}`, item.title, box.x + 1.8, y, box.w - 2, 1.3, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 1.8, y + 1.4, box.w - 2, step - 1.6, { size: d.type.body });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const h = (box.h - 0.3 * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * (h + 0.3);
    d.shape(`rule-${i}`, box.x, y, 0.16, h, { fill: i === 0 ? d.p.accent : d.p.secondary });
    d.text(`title-${i}`, item.title, box.x + 0.55, y + 0.15, box.w - 0.7, 1.15, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, box.x + 0.55, y + 1.4, box.w - 0.7, h - 1.6, { size: d.type.body });
  });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const step = box.h / items.length;
  items.forEach((item, i) => {
    const y = box.y + i * step;
    if (i) d.shape(`row-${i}`, box.x, y, box.w, 0.03, { fill: d.p.rule });
    d.text(`label-${i}`, item.label, box.x, y + 0.15, 5.4, step - 0.3, { size: d.type.heading, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`title-${i}`, item.title, box.x + 5.7, y + 0.15, 8.4, step - 0.3, { size: d.type.heading, heading: true, valign: 'middle' });
    d.text(`body-${i}`, item.body, box.x + 14.4, y + 0.15, box.w - 14.6, step - 0.3, { size: d.type.body, valign: 'middle' });
  });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x + 3.6, box.y, box.w - 3.6, 0.75, { size: d.type.label, color: d.p.accent, align: 'center', heading: true });
  d.text('y-axis-label', s.yLabel as string, box.x, box.y + 0.9, 3.3, box.h - 1, { size: d.type.label, color: d.p.accent, heading: true });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.3;
  const w = (box.w - 3.6 - gap) / 2;
  const h = (box.h - 1.0 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + 3.6 + (i % 2) * (w + gap);
    const y = box.y + 0.95 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { fill: d.p.surface });
    d.text(`cell-title-${i}`, cell.title, x + 0.4, y + 0.25, w - 0.8, 1.3, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x + 0.4, y + 1.7, w - 0.8, h - 2.0, { size: d.type.body });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 14.6;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.5, y: box.y, w: box.w - textW - 0.5, h: box.h };
  d.shape('figure', media.x, media.y, media.w, media.h, { fill: d.p.surface });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.text('panel-headline', panel.headline, media.x + 0.45, media.y + 0.45, media.w - 0.9, 2.2, { size: d.type.heading, heading: true });
    d.text('panel-body', panel.body, media.x + 0.45, media.y + 2.9, media.w - 0.9, media.h - 3.5, { size: d.type.body });
  } else {
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.25, y: media.y + 0.25, w: media.w - 0.5, h: media.h - 0.5 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
