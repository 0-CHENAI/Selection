import { isAbsolute } from 'node:path';
import { CANVAS, DECK_VERSION, LAYOUT_IDS, type Bounds, type ChartKind, type Deck, type DeckElement, type LayoutId, type Page, type Palette, type Theme } from './types';

type Issue = { path: string; message: string };

const HEX = /^#?[0-9a-fA-F]{6}$/;
const CHART_KINDS: ChartKind[] = ['bar', 'column', 'line', 'pie', 'doughnut', 'waterfall'];

function fail(issues: Issue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectString(issues: Issue[], path: string, value: unknown, min = 1, max = 8000): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(issues, path, 'expected non-empty string');
    return false;
  }
  if (value.length < min || value.length > max) {
    fail(issues, path, `length ${value.length} outside ${min}..${max}`);
    return false;
  }
  return true;
}

function expectNumber(issues: Issue[], path: string, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(issues, path, 'expected finite number');
    return false;
  }
  return true;
}

function expectBounds(issues: Issue[], path: string, value: unknown): value is Bounds {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    fail(issues, path, 'expected [x,y,w,h] numbers');
    return false;
  }
  return true;
}

function expectHex(issues: Issue[], path: string, value: unknown): boolean {
  if (typeof value !== 'string' || !HEX.test(value.replace('#', '').length === 6 ? value : `#${value}`)) {
    if (typeof value !== 'string' || !HEX.test(value.startsWith('#') ? value : `#${value}`)) {
      fail(issues, path, 'expected #RRGGBB color');
      return false;
    }
  }
  return true;
}

function readPalette(issues: Issue[], path: string, value: unknown): Palette | undefined {
  if (!isRecord(value)) {
    fail(issues, path, 'expected palette object');
    return undefined;
  }
  const keys: (keyof Palette)[] = ['background', 'surface', 'text', 'muted', 'accent', 'secondary', 'rule', 'inverse', 'wash'];
  const palette = {} as Palette;
  for (const key of keys) {
    if (!expectHex(issues, `${path}.${key}`, value[key])) return undefined;
    const hex = String(value[key]);
    palette[key] = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  }
  return palette;
}

function readPair(issues: Issue[], path: string, value: unknown): { latin: string; cjk: string } | undefined {
  if (!isRecord(value) || !expectString(issues, `${path}.latin`, value.latin, 1, 80) || !expectString(issues, `${path}.cjk`, value.cjk, 1, 80)) {
    fail(issues, path, 'expected {latin,cjk}');
    return undefined;
  }
  return { latin: String(value.latin), cjk: String(value.cjk) };
}

function readTheme(issues: Issue[], path: string, value: unknown): Theme | undefined {
  if (!isRecord(value)) {
    fail(issues, path, 'expected theme object');
    return undefined;
  }
  if (!expectString(issues, `${path}.id`, value.id, 1, 64) || !expectString(issues, `${path}.name`, value.name, 1, 120)) return undefined;
  const palette = readPalette(issues, `${path}.palette`, value.palette);
  if (!palette || !isRecord(value.fonts) || !isRecord(value.fonts.heading) || !isRecord(value.fonts.body) || !isRecord(value.type)) {
    fail(issues, `${path}.fonts`, 'expected heading/body platform fonts');
    return undefined;
  }
  const heading = {
    darwin: readPair(issues, `${path}.fonts.heading.darwin`, value.fonts.heading.darwin),
    win32: readPair(issues, `${path}.fonts.heading.win32`, value.fonts.heading.win32),
    linux: readPair(issues, `${path}.fonts.heading.linux`, value.fonts.heading.linux),
  };
  const body = {
    darwin: readPair(issues, `${path}.fonts.body.darwin`, value.fonts.body.darwin),
    win32: readPair(issues, `${path}.fonts.body.win32`, value.fonts.body.win32),
    linux: readPair(issues, `${path}.fonts.body.linux`, value.fonts.body.linux),
  };
  if (!heading.darwin || !heading.win32 || !heading.linux || !body.darwin || !body.win32 || !body.linux) return undefined;
  const type = value.type as Record<string, unknown>;
  const roles = ['hero', 'title', 'heading', 'body', 'label', 'number', 'footer', 'caption'] as const;
  const scale = {} as Theme['type'];
  for (const role of roles) {
    if (!expectNumber(issues, `${path}.type.${role}`, type[role])) return undefined;
    scale[role] = Number(type[role]);
  }
  if (!expectNumber(issues, `${path}.margin`, value.margin)) return undefined;
  return {
    id: String(value.id),
    name: String(value.name),
    palette,
    fonts: { heading, body },
    type: scale,
    margin: Number(value.margin),
  };
}

function readElement(issues: Issue[], path: string, value: unknown): DeckElement | undefined {
  if (!isRecord(value) || !expectString(issues, `${path}.id`, value.id, 1, 80) || !expectBounds(issues, `${path}.bounds`, value.bounds)) {
    return undefined;
  }
  const id = String(value.id);
  const bounds = value.bounds as Bounds;
  if (value.type === 'text') {
    if (!expectString(issues, `${path}.text`, value.text, 1, 4000)) return undefined;
    if (!isRecord(value.textCapacity) || !expectNumber(issues, `${path}.textCapacity.maxLines`, value.textCapacity.maxLines)
      || !expectNumber(issues, `${path}.textCapacity.maxCharsPerLine`, value.textCapacity.maxCharsPerLine)) {
      return undefined;
    }
    return {
      id,
      type: 'text',
      bounds,
      text: String(value.text),
      textCapacity: {
        maxLines: Number(value.textCapacity.maxLines),
        maxCharsPerLine: Number(value.textCapacity.maxCharsPerLine),
      },
      style: isRecord(value.style) ? value.style as DeckElement extends { style?: infer S } ? S : never : undefined,
      z: typeof value.z === 'number' ? value.z : undefined,
    };
  }
  if (value.type === 'shape') {
    if (!['rect', 'roundRect', 'ellipse', 'line'].includes(String(value.shape))) {
      fail(issues, `${path}.shape`, 'unknown shape');
      return undefined;
    }
    return {
      id,
      type: 'shape',
      bounds,
      shape: value.shape as 'rect' | 'roundRect' | 'ellipse' | 'line',
      fill: typeof value.fill === 'string' ? value.fill : undefined,
      stroke: typeof value.stroke === 'string' ? value.stroke : undefined,
      strokeWidth: typeof value.strokeWidth === 'number' ? value.strokeWidth : undefined,
      z: typeof value.z === 'number' ? value.z : undefined,
    };
  }
  if (value.type === 'image') {
    if (!expectString(issues, `${path}.path`, value.path, 1, 4096) || !expectString(issues, `${path}.alt`, value.alt, 1, 400)) return undefined;
    if (!isAbsolute(String(value.path))) fail(issues, `${path}.path`, 'image.path must be absolute');
    return { id, type: 'image', bounds, path: String(value.path), alt: String(value.alt), z: typeof value.z === 'number' ? value.z : undefined };
  }
  if (value.type === 'chart') {
    if (!isRecord(value.chart) || !CHART_KINDS.includes(value.chart.kind as ChartKind)) {
      fail(issues, `${path}.chart.kind`, `expected ${CHART_KINDS.join('|')}`);
      return undefined;
    }
    if (!Array.isArray(value.chart.categories) || !Array.isArray(value.chart.series)) {
      fail(issues, `${path}.chart`, 'categories and series required');
      return undefined;
    }
    const categories = value.chart.categories.map((item, index) => {
      expectString(issues, `${path}.chart.categories[${index}]`, item, 1, 80);
      return String(item);
    });
    const series = value.chart.series.map((item, index) => {
      if (!isRecord(item) || !expectString(issues, `${path}.chart.series[${index}].name`, item.name, 1, 80) || !Array.isArray(item.values)) {
        fail(issues, `${path}.chart.series[${index}]`, 'expected name and values');
        return { name: 'invalid', values: [] as number[] };
      }
      const values = item.values.map((entry, valueIndex) => {
        expectNumber(issues, `${path}.chart.series[${index}].values[${valueIndex}]`, entry);
        return Number(entry);
      });
      if (values.length !== categories.length) {
        fail(issues, `${path}.chart.series[${index}]`, 'series length must match categories');
      }
      return { name: String(item.name), values, color: typeof item.color === 'string' ? item.color : undefined };
    });
    return {
      id,
      type: 'chart',
      bounds,
      chart: {
        kind: value.chart.kind as ChartKind,
        categories,
        series,
        showValues: value.chart.showValues !== false,
        hideBase: Boolean(value.chart.hideBase),
      },
      z: typeof value.z === 'number' ? value.z : undefined,
    };
  }
  fail(issues, `${path}.type`, 'expected text|shape|image|chart');
  return undefined;
}

function readPage(issues: Issue[], path: string, value: unknown): Page | undefined {
  if (!isRecord(value) || !expectString(issues, `${path}.id`, value.id, 1, 80)) return undefined;
  if (!LAYOUT_IDS.includes(value.layout as LayoutId)) {
    fail(issues, `${path}.layout`, `expected ${LAYOUT_IDS.join('|')}`);
    return undefined;
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    fail(issues, `${path}.elements`, 'expected non-empty elements');
    return undefined;
  }
  const ids = new Set<string>();
  const elements: DeckElement[] = [];
  value.elements.forEach((item, index) => {
    const element = readElement(issues, `${path}.elements[${index}]`, item);
    if (!element) return;
    if (ids.has(element.id)) fail(issues, `${path}.elements[${index}].id`, `duplicate id ${element.id}`);
    ids.add(element.id);
    elements.push(element);
  });
  return {
    id: String(value.id),
    layout: value.layout as LayoutId,
    background: typeof value.background === 'string' ? value.background : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    elements,
  };
}

export function parseDeck(value: unknown): { deck?: Deck; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isRecord(value)) {
    fail(issues, '$', 'expected object');
    return { issues };
  }
  if (value.version !== DECK_VERSION) fail(issues, 'version', `expected ${DECK_VERSION}`);
  if (!isRecord(value.canvas) || value.canvas.width !== CANVAS.width || value.canvas.height !== CANVAS.height || value.canvas.unit !== 'pt') {
    fail(issues, 'canvas', 'expected {width:960,height:540,unit:"pt"}');
  }
  const theme = readTheme(issues, 'theme', value.theme);
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 200) {
    fail(issues, 'pages', 'expected 1..200 pages');
    return { issues };
  }
  const pages: Page[] = [];
  const ids = new Set<string>();
  value.pages.forEach((item, index) => {
    const page = readPage(issues, `pages[${index}]`, item);
    if (!page) return;
    if (ids.has(page.id)) fail(issues, `pages[${index}].id`, `duplicate page id ${page.id}`);
    ids.add(page.id);
    pages.push(page);
  });
  if (issues.length || !theme) return { issues };
  return {
    deck: {
      version: DECK_VERSION,
      canvas: { ...CANVAS },
      theme,
      pages,
      meta: isRecord(value.meta) ? {
        title: typeof value.meta.title === 'string' ? value.meta.title : undefined,
        language: value.meta.language === 'en' ? 'en' : 'zh',
        attribution: typeof value.meta.attribution === 'string' ? value.meta.attribution : undefined,
      } : undefined,
    },
    issues,
  };
}

export function assertDeck(value: unknown): Deck {
  const { deck, issues } = parseDeck(value);
  if (!deck) {
    throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') || 'invalid deck');
  }
  return deck;
}
