import type { Command, Slide } from './recipe';

export const W = 33.8667;
export const H = 19.05;

export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  rule: string;
  inverse: string;
  mist: string;
};

export type FontSet = {
  heading: string;
  body: string;
  cjkHeading: string;
  cjkBody: string;
};

export type TypeScale = {
  title: number;
  hero: number;
  body: number;
  heading: number;
  number: number;
  label: number;
  footer: number;
  quote: number;
};

export type Frame = { x: number; y: number; w: number; h: number };

export type TextOpts = {
  size?: number;
  color?: string;
  heading?: boolean;
  align?: string;
  valign?: string;
  bold?: boolean;
};

type AssertFits = (text: string, width: number, height: number, size: number, name: string) => void;

export class Painter {
  constructor(
    readonly commands: Command[],
    readonly parent: string,
    readonly slide: Slide,
    readonly index: number,
    readonly p: Palette,
    readonly f: FontSet,
    readonly type: TypeScale,
    readonly styleId: string,
    readonly images: Map<string, { width: number; height: number }>,
    private readonly assertFits: AssertFits,
  ) {}

  shape(name: string, x: number, y: number, w: number, h: number, props: Record<string, string> = {}): void {
    this.commands.push({
      command: 'add', parent: this.parent, type: 'shape', props: {
        name, x: cm(x), y: cm(y), width: cm(w), height: cm(h), geometry: 'rect', fill: this.p.surface, line: 'none', ...props,
      },
    });
  }

  text(name: string, value: string, x: number, y: number, w: number, h: number, opts: TextOpts = {}): void {
    const size = opts.size ?? this.type.body;
    this.assertFits(value, w, h, size, `slide ${this.index + 1} ${name}`);
    const heading = opts.heading ?? false;
    const bold = opts.bold ?? (heading && this.styleId !== 'fresh-editorial');
    this.commands.push({
      command: 'add', parent: this.parent, type: 'shape', props: {
        name, text: value, x: cm(x), y: cm(y), width: cm(w), height: cm(h),
        size: String(size), font: heading ? this.f.heading : this.f.body, 'font.ea': heading ? this.f.cjkHeading : this.f.cjkBody,
        bold: String(bold), color: opts.color ?? this.p.text, fill: 'none', line: 'none', margin: '0cm',
        autoFit: 'none', valign: opts.valign ?? 'top', align: opts.align ?? 'left',
        lineSpacing: '1.24x', spaceBefore: '0pt', spaceAfter: '0pt',
      },
    });
  }

  picture(name: string, src: string, alt: string, x: number, y: number, w: number, h: number): void {
    this.commands.push({
      command: 'add', parent: this.parent, type: 'picture', props: {
        name, src, alt, x: cm(x), y: cm(y), width: cm(w), height: cm(h),
      },
    });
  }

  chart(box: Frame, slots: ChartSlots, colors: string): void {
    const many = slots.series.length > 1;
    this.commands.push({
      command: 'add', parent: this.parent, type: 'chart', props: {
        name: 'native-data-chart', chartType: slots.type, x: cm(box.x), y: cm(box.y), width: cm(box.w), height: cm(box.h),
        categories: slots.categories.join(','),
        data: slots.series.map((series, i) => `Series ${i + 1}:${series.values.join(',')}`).join(';'),
        title: 'none', legend: many ? 'bottom' : 'none', colors,
        chartfill: this.p.background, plotFill: this.p.background, chartborder: 'none',
        gridlines: 'none', dataLabels: 'outsideEnd', gapwidth: '70', valaxisvisible: 'false',
        axisfont: `16:${this.p.text}:${this.f.cjkBody}`,
        legendFont: `16:${this.p.text}:${this.f.cjkBody}`,
        labelfont: `16:${this.p.text}:${this.f.cjkBody}`,
      },
    });
    slots.series.forEach((series, i) => this.commands.push({
      command: 'set', path: `${this.parent}/chart[1]/series[${i + 1}]`, props: { name: series.name },
    }));
  }
}

export type ChartSlots = { type: string; categories: string[]; series: { name: string; values: number[] }[] };

export function cm(n: number): string {
  return `${Number(n.toFixed(3))}cm`;
}

export function pageNo(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function contain(box: Frame, image: { width: number; height: number }): Frame {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
