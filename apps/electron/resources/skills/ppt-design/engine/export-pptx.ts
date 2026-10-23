import { isAbsolute } from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { waterfallSeries } from './chart-model';
import { checkDeck } from './check';
import { inches } from './geometry';
import { validateOutputPath } from './paths';
import { resolveColor, resolveFont, resolveSize } from './tokens';
import type { ChartElement, Deck, DeckElement, RenderResult, ShapeElement, TextElement } from './types';

type PptxCtor = new () => {
  defineLayout: (layout: { name: string; width: number; height: number }) => void;
  layout: string;
  author: string;
  title: string;
  subject: string;
  addSlide: () => PptxSlide;
  writeFile: (options: { fileName: string }) => Promise<string>;
  ChartType: Record<string, string>;
  ShapeType: Record<string, string>;
};

type PptxSlide = {
  background: { color: string };
  addNotes: (notes: string) => void;
  addText: (text: string, options: Record<string, unknown>) => void;
  addShape: (kind: string, options: Record<string, unknown>) => void;
  addImage: (options: Record<string, unknown>) => void;
  addChart: (kind: string, data: unknown[], options: Record<string, unknown>) => void;
};

function loadPptxGen(): PptxCtor {
  const loaded = PptxGenJS as unknown as PptxCtor | { default: PptxCtor };
  return (loaded as { default?: PptxCtor }).default ?? (loaded as PptxCtor);
}

function box(bounds: readonly [number, number, number, number]): { x: number; y: number; w: number; h: number } {
  return { x: inches(bounds[0]), y: inches(bounds[1]), w: inches(bounds[2]), h: inches(bounds[3]) };
}

function hex(color: string): string {
  return color.replace('#', '').toUpperCase();
}

function addText(slide: PptxSlide, deck: Deck, element: TextElement): void {
  const size = resolveSize(deck.theme, element.style);
  slide.addText(element.text.replace(/\r\n|\r/g, '\n'), {
    ...box(element.bounds),
    fontSize: size,
    fontFace: resolveFont(deck.theme, element.style?.font ?? (element.style?.role === 'body' || element.style?.role === 'footer' || element.style?.role === 'caption' || element.style?.role === 'label' ? 'body' : 'heading'), element.text),
    color: hex(resolveColor(deck.theme, element.style?.color ?? 'text')),
    bold: (element.style?.weight ?? 400) >= 600,
    align: element.style?.align ?? 'left',
    valign: element.style?.valign ?? 'top',
    margin: 0,
    wrap: true,
    charSpacing: element.style?.tracking,
    paraSpaceAfter: 0,
  });
}

function addShape(slide: PptxSlide, deck: Deck, element: ShapeElement, pptx: InstanceType<PptxCtor>): void {
  const kind = element.shape === 'roundRect' ? pptx.ShapeType.roundRect
    : element.shape === 'ellipse' ? pptx.ShapeType.ellipse
      : element.shape === 'line' ? pptx.ShapeType.line
        : pptx.ShapeType.rect;
  slide.addShape(kind, {
    ...box(element.bounds),
    fill: element.fill ? { color: hex(resolveColor(deck.theme, element.fill)) } : { type: 'none' },
    line: element.stroke
      ? { color: hex(resolveColor(deck.theme, element.stroke)), pt: element.strokeWidth ?? 0.75 }
      : { type: 'none' },
    rectRadius: element.shape === 'roundRect' ? 0.06 : undefined,
  });
}

function addChart(slide: PptxSlide, deck: Deck, element: ChartElement, pptx: InstanceType<PptxCtor>): void {
  const spec = element.chart;
  const kind = spec.kind === 'bar' ? pptx.ChartType.bar
    : spec.kind === 'line' ? pptx.ChartType.line
      : spec.kind === 'pie' ? pptx.ChartType.pie
        : spec.kind === 'doughnut' ? pptx.ChartType.doughnut
          : pptx.ChartType.bar;
  const series = spec.kind === 'waterfall'
    ? waterfallSeries(spec)
    : spec.series.map(item => ({
      name: item.name,
      labels: spec.categories,
      values: item.values,
    }));
  const colors = spec.kind === 'waterfall'
    ? waterfallColors(deck, spec)
    : spec.series.map(item => hex(resolveColor(deck.theme, item.color ?? 'accent')));
  slide.addChart(kind === pptx.ChartType.bar && spec.kind !== 'bar' ? pptx.ChartType.bar : kind, series, {
    ...box(element.bounds),
    barDir: spec.kind === 'bar' ? 'bar' : 'col',
    barGrouping: spec.kind === 'waterfall' || spec.series.length > 1 ? 'stacked' : 'clustered',
    showTitle: false,
    showLegend: spec.kind === 'pie' || spec.kind === 'doughnut',
    showValue: spec.showValues !== false,
    showCatAxisTitle: false,
    showValAxisTitle: false,
    valAxisHidden: spec.kind === 'waterfall' || spec.kind === 'pie' || spec.kind === 'doughnut',
    valAxisMin: spec.kind === 'line'
      ? Math.max(0, Math.floor(Math.min(...(spec.series[0]?.values ?? [0])) * 0.85))
      : undefined,
    catAxisLabelColor: hex(resolveColor(deck.theme, 'muted')),
    valAxisLabelColor: hex(resolveColor(deck.theme, 'muted')),
    catAxisLineShow: false,
    valAxisLineShow: false,
    chartColors: colors,
    chartDataBorder: { pt: 0, color: hex(resolveColor(deck.theme, 'background')) },
    chartArea: { fill: { color: hex(resolveColor(deck.theme, pageFill(deck, element))) } },
  });
}

function pageFill(deck: Deck, element: DeckElement): string {
  return deck.pages.find(page => page.elements.includes(element))?.background
    ?? deck.theme.palette.background;
}

function waterfallColors(deck: Deck, spec: ChartElement['chart']): string[] {
  return [
    hex(resolveColor(deck.theme, spec.series[0]?.color ? 'background' : 'background')),
    hex(resolveColor(deck.theme, 'accent')),
    hex(resolveColor(deck.theme, 'muted')),
  ];
}

function paintElement(slide: PptxSlide, deck: Deck, element: DeckElement, pptx: InstanceType<PptxCtor>): void {
  if (element.type === 'shape') addShape(slide, deck, element, pptx);
  else if (element.type === 'text') addText(slide, deck, element);
  else if (element.type === 'image') {
    if (!isAbsolute(element.path)) throw new Error(`image path must be absolute: ${element.path}`);
    slide.addImage({ ...box(element.bounds), path: element.path, altText: element.alt });
  } else addChart(slide, deck, element, pptx);
}

export async function writePptx(deck: Deck, out: string, folder: string): Promise<string> {
  const target = validateOutputPath(folder, out, '.pptx');
  const PptxGenJS = loadPptxGen();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'SDD_16x9', width: 13.333333, height: 7.5 });
  pptx.layout = 'SDD_16x9';
  pptx.author = 'Selection';
  pptx.title = deck.meta?.title ?? deck.theme.name;
  pptx.subject = deck.theme.id;
  for (const page of deck.pages) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(resolveColor(deck.theme, page.background ?? 'background')) };
    if (page.notes) slide.addNotes(page.notes);
    [...page.elements]
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
      .forEach(element => paintElement(slide, deck, element, pptx));
  }
  await pptx.writeFile({ fileName: target });
  return target;
}

export async function renderDeck(deck: Deck, out: string, folder: string): Promise<RenderResult> {
  const report = checkDeck(deck);
  if (!report.ok) return { outcome: 'needs_revision', issues: report.issues };
  const path = await writePptx(deck, out, folder);
  return {
    outcome: 'GENERATED_UNREVIEWED',
    path,
    pages: deck.pages.length,
    style: deck.theme.id,
    visualReviewRequired: true,
  };
}
