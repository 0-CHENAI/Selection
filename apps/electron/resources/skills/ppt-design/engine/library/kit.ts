import { autoCapacity, capacityOverflow, orphanLine, wrapLines } from '../text';
import { resolveColor } from '../tokens';
import type { Bounds, ChartSpec, DeckElement, Page, TextStyle, Theme } from '../types';
import { CANVAS } from '../types';

export class Kit {
  elements: DeckElement[] = [];
  private serial = 0;

  constructor(
    readonly theme: Theme,
    readonly index: number,
    readonly count: number,
    readonly source: string,
  ) {}

  private id(prefix: string): string {
    this.serial += 1;
    return `${prefix}${this.serial}`;
  }

  rect(x: number, y: number, w: number, h: number, fill: string, extra: { id?: string; stroke?: string; strokeWidth?: number; z?: number; shape?: 'rect' | 'roundRect' | 'ellipse' } = {}): void {
    this.elements.push({
      id: extra.id ?? this.id('s'),
      type: 'shape',
      bounds: [x, y, w, h],
      shape: extra.shape ?? 'rect',
      fill,
      stroke: extra.stroke,
      strokeWidth: extra.strokeWidth,
      z: extra.z ?? 0,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width = 0.8): void {
    this.elements.push({
      id: this.id('l'),
      type: 'shape',
      bounds: [Math.min(x1, x2), Math.min(y1, y2), Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(y2 - y1))],
      shape: 'line',
      stroke,
      strokeWidth: width,
      z: 1,
    });
  }

  text(x: number, y: number, w: number, h: number, content: string, size: number, style: TextStyle = {}, id?: string): void {
    const lineHeight = style.lineHeight ?? 1.18;
    const bounds: Bounds = [x, y, w, h];
    if (h + 0.01 < size * lineHeight) {
      throw new Error(`builder box too short for ${size}pt (${h}pt): ${content.slice(0, 24)}`);
    }
    const overflow = capacityOverflow(content, bounds, size, {
      maxLines: 24,
      maxCharsPerLine: 80,
    }, lineHeight);
    if (overflow) throw new Error(`builder text overflow (${content.slice(0, 24)}…): ${overflow}`);
    const orphan = orphanLine(wrapLines(content, w, size));
    if (orphan) throw new Error(`builder orphan “${orphan}” in “${content}”`);
    this.elements.push({
      id: id ?? this.id('t'),
      type: 'text',
      bounds,
      text: content,
      textCapacity: autoCapacity(content, bounds, size, lineHeight),
      style: { ...style, size },
      z: 2,
    });
  }

  chart(x: number, y: number, w: number, h: number, spec: ChartSpec, id?: string): void {
    this.elements.push({ id: id ?? this.id('c'), type: 'chart', bounds: [x, y, w, h], chart: spec, z: 2 });
  }

  page(id: string, layout: Page['layout'], notes: string, background?: string): Page {
    return {
      id,
      layout,
      background,
      notes,
      source: this.source,
      elements: this.elements,
    };
  }

  color(token: string): string {
    return resolveColor(this.theme, token);
  }
}

export function deckShell(theme: Theme, pages: Page[], title: string): import('../types').Deck {
  return {
    version: 1,
    canvas: { ...CANVAS },
    theme,
    pages,
    meta: {
      title,
      language: 'zh',
      attribution: 'Illustrative Selection reference deck. Figures are fictional.',
    },
  };
}
