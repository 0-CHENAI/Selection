import { contain, H, pageNo, W, type ChartSlots, type Frame, type Painter } from './paint';

/** dark-tech + technical-deepdive: rings, brackets, node spines, asymmetric modules. */
export function paintDark(d: Painter): void {
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
  d.shape('top-line', 0, 0, W, 0.12, { fill: d.p.accent });
  bracket(d, 'tr', 30.3, 0.55, 2.7, 2.2);
  let y = 0.4;
  if (d.slide.eyebrow) {
    d.text('eyebrow', d.slide.eyebrow, 1.2, y, 26, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    y += 0.88;
  }
  d.text('title', d.slide.title, 1.2, y, 28.2, 2.15, { size: d.type.title, heading: true, valign: 'middle' });
  y += 2.25;
  if (d.slide.subtitle) {
    d.text('subtitle', d.slide.subtitle, 1.2, y, 28, 0.85, { size: d.type.body, color: d.p.muted, valign: 'middle' });
    y += 0.95;
  }
  d.shape('footer-rule', 1.2, 17.7, 31.4, 0.03, { fill: d.p.rule });
  if (d.slide.source) d.text('source', d.slide.source, 1.2, 17.85, 26, 0.9, { size: d.type.footer, color: d.p.muted, valign: 'middle' });
  d.text('page', pageNo(d.index), 29.2, 17.85, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', valign: 'middle', heading: true, bold: true });
  const top = y + 0.3;
  return { x: 1.15, y: top, w: 31.55, h: 17.5 - top };
}

function bracket(d: Painter, name: string, x: number, y: number, w: number, h: number): void {
  d.shape(`${name}-h`, x, y, w, 0.08, { fill: d.p.accent });
  d.shape(`${name}-v`, x + w - 0.08, y, 0.08, h, { fill: d.p.accent });
}

function cover(d: Painter): void {
  const s = d.slide.slots;
  d.shape('ring-a', 20.2, -3.2, 16.5, 16.5, { geometry: 'ellipse', fill: 'none', line: `${d.p.accent}:1.25` });
  d.shape('ring-b', 23.4, -0.2, 11.2, 11.2, { geometry: 'ellipse', fill: 'none', line: `${d.p.secondary}:1` });
  d.shape('ring-c', 26.2, 2.4, 5.6, 5.6, { geometry: 'ellipse', fill: d.p.accent, opacity: '0.22' });
  bracket(d, 'tl', 0.7, 0.7, 2.4, 2.0);
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.3, 6.3, 20, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.3, 7.15, 22, 3.4, { size: d.type.hero, heading: true });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.3, 10.7, 20, 1.8, { size: d.type.body, color: d.p.muted });
  const chips: [string, string][] = [['讲者', s.presenter as string], ['日期', s.date as string]];
  if (d.slide.source) chips.push(['来源', d.slide.source]);
  const gap = 0.4;
  const w = (31.4 - gap * (chips.length - 1)) / chips.length;
  chips.forEach((chip, i) => {
    const x = 1.2 + i * (w + gap);
    d.shape(`chip-${i}`, x, 14.55, w, 3.35, { geometry: 'roundRect', fill: d.p.surface, line: `${d.p.rule}:1` });
    d.text(`chip-k-${i}`, chip[0], x + 0.45, 14.75, w - 0.9, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
    d.text(`chip-v-${i}`, chip[1], x + 0.45, 15.55, w - 0.9, 2.0, { size: d.type.heading, valign: 'middle' });
  });
  d.text('page', pageNo(d.index), 29.4, 0.7, 3, 0.7, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true, bold: true });
}

function section(d: Painter): void {
  const s = d.slide.slots;
  d.shape('rail', 0, 0, 1.15, H, { fill: d.p.accent });
  d.shape('panel', 2.3, 2.4, 29.6, 14.2, { geometry: 'roundRect', fill: d.p.surface, line: `${d.p.rule}:1.25` });
  d.text('section-number', s.number as string, 3.0, 3.0, 10, 4.2, { size: d.type.number, color: d.p.accent, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 14, 3.3, 16.5, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 3.0, 7.6, 27, 3.6, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 3.0, 11.5, 27, 4.2, { size: d.type.body, color: d.p.muted });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 3.0, 16.9, 22, 1.2, { size: d.type.body, color: d.p.mist });
  if (d.slide.source) d.text('source', d.slide.source, 3.0, 17.7, 22, 0.85, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.85, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true, bold: true });
}

function closing(d: Painter): void {
  const s = d.slide.slots;
  bracket(d, 'tl', 0.8, 0.8, 2.6, 2.1);
  bracket(d, 'br', 30.4, 11.2, 2.6, 2.1);
  d.shape('bottom-band', 0, 14.85, W, 4.2, { fill: d.p.accent });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 1.5, 2.6, 28, 0.8, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 1.5, 3.6, 28, 3.6, { size: d.type.hero, heading: true });
  d.text('body', s.body as string, 1.5, 7.6, 26, 4.4, { size: d.type.heading, color: d.p.muted });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.5, 12.3, 26, 1.4, { size: d.type.body, color: d.p.mist });
  d.text('contact-k', '下一步', 1.5, 15.2, 10, 0.8, { size: d.type.label, color: d.p.inverse, heading: true, bold: true });
  d.text('contact', s.contact as string, 1.5, 16.15, 26, 1.8, { size: d.type.heading, color: d.p.inverse, heading: true });
  if (d.slide.source) d.text('source', d.slide.source, 1.5, 13.6, 20, 0.8, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 16.6, 3.3, 1.1, { size: d.type.footer, color: d.p.inverse, align: 'right', heading: true, bold: true });
}

function kpi(d: Painter): void {
  const s = d.slide.slots;
  d.shape('orbit-a', 8.4, 1.6, 17, 17, { geometry: 'ellipse', fill: 'none', line: `${d.p.rule}:1.25` });
  d.shape('orbit-b', 11.2, 4.2, 11.4, 11.4, { geometry: 'ellipse', fill: 'none', line: `${d.p.accent}:1.5` });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 2, 1.3, 29, 0.7, { size: d.type.label, color: d.p.accent, align: 'center', heading: true, bold: true });
  d.text('value', s.value as string, 4, 5.3, 25.8, 4.4, { size: d.type.number, color: d.p.accent, align: 'center', heading: true });
  d.text('label', s.label as string, 4, 9.8, 25.8, 1.6, { size: d.type.heading, align: 'center', heading: true });
  d.shape('context-band', 0, 13.15, W, 5.9, { fill: d.p.surface });
  d.text('title', d.slide.title, 1.4, 13.5, 30.8, 1.5, { size: d.type.title, heading: true, valign: 'middle' });
  d.text('context', s.context as string, 1.4, 15.15, 30.8, 2.2, { size: d.type.body, color: d.p.muted });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 1.4, 17.35, 22, 0.7, { size: d.type.label, color: d.p.mist });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.9, 24, 0.8, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.9, 3.3, 0.8, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true, bold: true });
}

function quote(d: Painter): void {
  const s = d.slide.slots;
  d.shape('frame', 1.3, 1.3, 31.2, 15.3, { geometry: 'roundRect', fill: 'none', line: `${d.p.accent}:1.5` });
  d.text('mark', '“', 2.0, 1.6, 6, 3.2, { size: 72, color: d.p.accent, heading: true });
  if (d.slide.eyebrow) d.text('eyebrow', d.slide.eyebrow, 8.5, 2.3, 20, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('title', d.slide.title, 2.3, 4.6, 28.8, 2.2, { size: d.type.title, heading: true });
  d.text('quote', s.quote as string, 2.3, 7.1, 28.8, 6.2, { size: d.type.quote, heading: true });
  d.text('attribution', s.attribution as string, 2.3, 13.5, 28.8, 1.5, { size: d.type.body, color: d.p.muted });
  if (d.slide.subtitle) d.text('subtitle', d.slide.subtitle, 2.3, 15.1, 20, 0.9, { size: d.type.label, color: d.p.mist });
  if (d.slide.source) d.text('source', d.slide.source, 1.4, 17.7, 24, 0.9, { size: d.type.footer, color: d.p.muted });
  d.text('page', pageNo(d.index), 29.2, 17.7, 3.3, 0.9, { size: d.type.footer, color: d.p.accent, align: 'right', heading: true, bold: true });
}

function body(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  switch (d.slide.layout) {
    case 'agenda': return agenda(d, box);
    case 'bullets': return bullets(d, box);
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

function agenda(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  const step = box.h / items.length;
  d.shape('spine', box.x + 0.55, box.y + 0.4, 0.08, box.h - 0.8, { fill: d.p.accent });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`node-${i}`, box.x + 0.22, y + step / 2 - 0.38, 0.76, 0.76, { geometry: 'ellipse', fill: d.p.accent });
    d.shape(`card-${i}`, box.x + 1.7, y + 0.12, box.w - 1.7, step - 0.24, { geometry: 'roundRect', fill: d.p.surface, line: `${d.p.rule}:1` });
    d.text(`num-${i}`, String(i + 1).padStart(2, '0'), box.x + 2.05, y + 0.2, 1.8, step - 0.4, { size: d.type.label, color: d.p.accent, heading: true, bold: true, valign: 'middle' });
    d.text(`item-${i}`, item, box.x + 4.0, y + 0.25, box.w - 4.5, step - 0.5, { size: d.type.heading, valign: 'middle' });
  });
}

function bullets(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as string[];
  if (items.length !== 4) {
    const step = box.h / items.length;
    items.forEach((item, i) => {
      const y = box.y + i * step;
      d.shape(`card-${i}`, box.x, y + 0.1, box.w, step - 0.2, { geometry: 'roundRect', fill: d.p.surface });
      d.shape(`tick-${i}`, box.x + 0.45, y + step / 2 - 0.38, 0.76, 0.76, { geometry: 'ellipse', fill: d.p.accent });
      d.text(`item-${i}`, item, box.x + 1.7, y + 0.2, box.w - 2.2, step - 0.45, { size: d.type.body, valign: 'middle' });
    });
    return;
  }
  const gap = 0.4;
  const w = (box.w - gap) / 2;
  const h = (box.h - gap) / 2;
  items.forEach((item, i) => {
    const x = box.x + (i % 2) * (w + gap);
    const y = box.y + Math.floor(i / 2) * (h + gap);
    d.shape(`card-${i}`, x, y, w, h, { geometry: 'roundRect', fill: d.p.surface });
    d.shape(`tick-${i}`, x + 0.45, y + 0.4, 0.7, 0.7, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`item-${i}`, item, x + 0.5, y + 1.4, w - 1.0, h - 1.9, { size: d.type.body });
  });
}

function comparison(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const leftW = box.w * 0.58;
  const rightW = box.w - leftW - 0.4;
  (['left', 'right'] as const).forEach((key, i) => {
    const x = box.x + (i === 0 ? 0 : leftW + 0.4);
    const w = i === 0 ? leftW : rightW;
    const side = s[key] as { heading: string; body: string };
    d.shape(`card-${key}`, x, box.y, w, box.h, { geometry: 'roundRect', fill: d.p.surface, line: i === 1 ? `${d.p.accent}:2.25` : `${d.p.rule}:1` });
    d.text(`${key}-heading`, side.heading, x + 0.55, box.y + 0.5, w - 1.1, 2.2, { size: d.type.heading, color: i === 1 ? d.p.accent : d.p.text, heading: true });
    d.text(`${key}-body`, side.body, x + 0.55, box.y + 3.0, w - 1.1, box.h - 3.6, { size: d.type.body, color: d.p.muted });
  });
}

function process(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  const gap = 0.45;
  const w = (box.w - gap * (items.length - 1)) / items.length;
  d.shape('rail', box.x + w / 2, box.y + 0.85, box.w - w, 0.1, { fill: d.p.secondary });
  items.forEach((item, i) => {
    const x = box.x + i * (w + gap);
    d.shape(`node-${i}`, x + w / 2 - 0.7, box.y + 0.25, 1.4, 1.4, { geometry: 'ellipse', fill: d.p.background, line: `${d.p.accent}:2` });
    d.text(`num-${i}`, String(i + 1), x + w / 2 - 0.7, box.y + 0.25, 1.4, 1.4, { size: d.type.label, color: d.p.accent, align: 'center', valign: 'middle', heading: true, bold: true });
    d.shape(`card-${i}`, x, box.y + 2.2, w, box.h - 2.2, { geometry: 'roundRect', fill: d.p.surface });
    d.text(`title-${i}`, item.title, x + 0.35, box.y + 2.5, w - 0.7, 2.3, { size: d.type.heading, heading: true });
    d.text(`body-${i}`, item.body, x + 0.35, box.y + 5.0, w - 0.7, box.h - 5.4, { size: d.type.body, color: d.p.muted });
  });
}

function cards(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { title: string; body: string }[];
  if (items.length === 3) {
    const rightW = box.w * 0.42;
    const leftW = box.w - rightW - 0.4;
    const h = (box.h - 0.4) / 2;
    card(d, items[0], 0, box.x, box.y, leftW, box.h);
    card(d, items[1], 1, box.x + leftW + 0.4, box.y, rightW, h);
    card(d, items[2], 2, box.x + leftW + 0.4, box.y + h + 0.4, rightW, h);
    return;
  }
  const gap = 0.4;
  const w = (box.w - gap) / 2;
  const h = (box.h - gap) / 2;
  items.forEach((item, i) => card(d, item, i, box.x + (i % 2) * (w + gap), box.y + Math.floor(i / 2) * (h + gap), w, h));
}

function card(d: Painter, item: { title: string; body: string }, i: number, x: number, y: number, w: number, h: number): void {
  d.shape(`card-${i}`, x, y, w, h, { geometry: 'roundRect', fill: d.p.surface, line: `${d.p.rule}:1` });
  d.shape(`card-accent-${i}`, x, y, 0.22, h, { fill: d.p.accent });
  d.text(`title-${i}`, item.title, x + 0.6, y + 0.4, w - 1.1, Math.min(2.2, h * 0.4), { size: d.type.heading, heading: true });
  d.text(`body-${i}`, item.body, x + 0.6, y + 2.6, w - 1.1, h - 3.1, { size: d.type.body, color: d.p.muted });
}

function timeline(d: Painter, box: Frame): void {
  const items = d.slide.slots.items as { label: string; title: string; body: string }[];
  const step = box.h / items.length;
  d.shape('spine', box.x + box.w - 1.15, box.y + 0.3, 0.08, box.h - 0.6, { fill: d.p.accent });
  items.forEach((item, i) => {
    const y = box.y + i * step;
    d.shape(`node-${i}`, box.x + box.w - 1.5, y + 0.35, 0.8, 0.8, { geometry: 'ellipse', fill: d.p.accent });
    d.text(`label-${i}`, item.label, box.x, y + 0.15, 5.2, step - 0.4, { size: d.type.heading, color: d.p.accent, heading: true, valign: 'middle' });
    d.text(`title-${i}`, item.title, box.x + 5.6, y + 0.15, 10, step - 0.4, { size: d.type.heading, heading: true, valign: 'middle' });
    d.text(`body-${i}`, item.body, box.x + 16, y + 0.2, box.w - 18.2, step - 0.45, { size: d.type.body, color: d.p.muted, valign: 'middle' });
  });
}

function chart(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const band = 3.3;
  d.shape('plot', box.x, box.y, box.w, box.h - band - 0.35, { geometry: 'roundRect', fill: d.p.surface });
  d.chart({ x: box.x + 0.3, y: box.y + 0.25, w: box.w - 0.6, h: box.h - band - 0.9 }, s as ChartSlots, `${d.p.accent},${d.p.secondary},${d.p.mist}`);
  d.shape('insight-band', box.x, box.y + box.h - band, box.w, band, { fill: d.p.surface, line: `${d.p.accent}:1.5` });
  d.text('insight-k', '读数', box.x + 0.5, box.y + box.h - band + 0.25, 3.2, 0.7, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  d.text('insight', s.insight as string, box.x + 3.8, box.y + box.h - band + 0.3, box.w - 4.5, band - 0.6, { size: d.type.heading, valign: 'middle' });
}

function matrix(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  d.text('x-axis-label', s.xLabel as string, box.x + 3.4, box.y, box.w - 3.4, 0.8, { size: d.type.label, color: d.p.accent, align: 'center', heading: true, bold: true });
  d.text('y-axis-label', s.yLabel as string, box.x, box.y + 1, 3.2, box.h - 1, { size: d.type.label, color: d.p.accent, heading: true, bold: true });
  const cells = s.cells as { title: string; body: string }[];
  const gap = 0.35;
  const w = (box.w - 3.5 - gap) / 2;
  const h = (box.h - 1.05 - gap) / 2;
  cells.forEach((cell, i) => {
    const x = box.x + 3.5 + (i % 2) * (w + gap);
    const y = box.y + 1.0 + Math.floor(i / 2) * (h + gap);
    d.shape(`cell-${i}`, x, y, w, h, { geometry: 'roundRect', fill: d.p.surface, line: `${d.p.rule}:1` });
    d.shape(`corner-h-${i}`, x + 0.3, y + 0.3, 1.1, 0.08, { fill: d.p.accent });
    d.shape(`corner-v-${i}`, x + 0.3, y + 0.3, 0.08, 1.1, { fill: d.p.accent });
    d.text(`cell-title-${i}`, cell.title, x + 0.55, y + 0.55, w - 1.1, 1.5, { size: d.type.heading, heading: true });
    d.text(`cell-body-${i}`, cell.body, x + 0.55, y + 2.2, w - 1.1, h - 2.6, { size: d.type.body, color: d.p.muted });
  });
}

function imageText(d: Painter, box: Frame): void {
  const s = d.slide.slots;
  const textW = 12.6;
  d.text('body', s.body as string, box.x, box.y, textW, box.h, { size: d.type.body });
  const media: Frame = { x: box.x + textW + 0.55, y: box.y, w: box.w - textW - 0.55, h: box.h };
  d.shape('offset', media.x + 0.35, media.y + 0.35, media.w - 0.35, media.h - 0.35, { fill: d.p.accent });
  if (s.panel) {
    const panel = s.panel as { headline: string; body: string };
    d.shape('intentional-text-panel', media.x, media.y, media.w - 0.45, media.h - 0.45, { fill: d.p.surface });
    d.text('panel-headline', panel.headline, media.x + 0.5, media.y + 0.5, media.w - 1.4, 2.3, { size: d.type.heading, heading: true });
    d.text('panel-body', panel.body, media.x + 0.5, media.y + 3.1, media.w - 1.4, media.h - 4.2, { size: d.type.body, color: d.p.muted });
  } else {
    d.shape('image-mat', media.x, media.y, media.w - 0.45, media.h - 0.45, { fill: d.p.background });
    const dimensions = d.images.get(s.image.path);
    if (!dimensions) throw new Error(`image dimensions missing: ${s.image.path}`);
    const fitted = contain({ x: media.x + 0.25, y: media.y + 0.25, w: media.w - 0.95, h: media.h - 0.95 }, dimensions);
    d.picture('supplied-image', s.image.path, s.image.alt, fitted.x, fitted.y, fitted.w, fitted.h);
  }
}
