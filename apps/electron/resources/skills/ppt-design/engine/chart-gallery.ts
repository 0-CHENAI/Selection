/** One themed page per native chart kind. Layout ids stay outside the argument library. */

import { defaultLeading } from './metrics.ts'
import { argumentTheme } from './argument-layouts.ts'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DECK_FORMAT,
  DECK_VERSION,
  type ChartKind,
  type ChartSpec,
  type Deck,
  type DeckElement,
  type DeckPage,
  type TextCapacity,
} from './types.ts'

export const CHART_GALLERY: Array<{ kind: ChartKind; title: string; chart: ChartSpec }> = [
  {
    kind: 'bar',
    title: '横向条形',
    chart: {
      kind: 'bar',
      categories: ['华东', '华南', '华北', '西南'],
      series: [{ name: '缺货仓', values: [4, 2, 3, 1] }],
      colors: ['$accent'],
    },
  },
  {
    kind: 'column',
    title: '簇状柱形',
    chart: {
      kind: 'column',
      categories: ['一月', '二月', '三月', '四月'],
      series: [{ name: '周转天数', values: [62, 54, 48, 45] }],
      colors: ['$accent'],
    },
  },
  {
    kind: 'line',
    title: '折线',
    chart: {
      kind: 'line',
      categories: ['一月', '二月', '三月', '四月', '五月', '六月'],
      series: [{ name: '周转天数', values: [42, 48, 45, 61, 58, 74] }],
      colors: ['$accent'],
      valMin: 0,
      valMax: 90,
    },
  },
  {
    kind: 'pie',
    title: '饼图',
    chart: {
      kind: 'pie',
      categories: ['华东', '华南', '其他'],
      series: [{ name: '库存', values: [42, 28, 30] }],
      colors: ['$accent', '$ink', '$muted'],
      showLegend: true,
    },
  },
  {
    kind: 'doughnut',
    title: '圆环',
    chart: {
      kind: 'doughnut',
      categories: ['安全', '在途', '呆滞'],
      series: [{ name: '库存结构', values: [58, 27, 15] }],
      colors: ['$accent', '$ink', '$muted'],
      holeSize: 62,
      showLegend: true,
    },
  },
  {
    kind: 'waterfall',
    title: '瀑布',
    chart: {
      kind: 'waterfall',
      categories: ['期初', '涨价', '流失', '新品', '期末'],
      series: [{ name: '库存', values: [120, 18, -30, 9, 117] }],
      colors: ['$paper', '$accent', '$ink'],
    },
  },
  {
    kind: 'area',
    title: '面积',
    chart: {
      kind: 'area',
      categories: ['一月', '二月', '三月', '四月', '五月', '六月'],
      series: [
        { name: '在库', values: [40, 46, 44, 52, 49, 58] },
        { name: '在途', values: [12, 14, 11, 16, 15, 18] },
      ],
      colors: ['$accent', '$ink'],
      showLegend: true,
    },
  },
  {
    kind: 'scatter',
    title: '散点',
    chart: {
      kind: 'scatter',
      categories: ['甲', '乙', '丙', '丁', '戊'],
      series: [{ name: '门店', values: [12, 18, 15, 22, 28], x: [8, 14, 18, 24, 30] }],
      colors: ['$accent', '$ink'],
    },
  },
  {
    kind: 'bubble',
    title: '气泡',
    chart: {
      kind: 'bubble',
      categories: ['甲', '乙', '丙', '丁'],
      series: [
        { name: '门店', values: [20, 28, 24, 32], x: [12, 18, 26, 32], sizes: [8, 12, 10, 14] },
        { name: '经销', values: [16, 18, 28, 22], x: [12, 18, 26, 32], sizes: [6, 9, 12, 8] },
      ],
      colors: ['$accent', '$ink'],
      showLegend: true,
    },
  },
  {
    kind: 'radar',
    title: '雷达',
    chart: {
      kind: 'radar',
      categories: ['价格', '品质', '交付', '服务', '品牌'],
      series: [
        { name: '现状', values: [3, 4, 2, 3, 4] },
        { name: '目标', values: [4, 4, 5, 4, 4] },
      ],
      colors: ['$accent', '$ink'],
      showLegend: true,
    },
  },
  {
    kind: 'combo',
    title: '柱线组合',
    chart: {
      kind: 'combo',
      categories: ['一季', '二季', '三季', '四季'],
      series: [
        { name: '收入', values: [40, 46, 51, 58], render: 'column' },
        { name: '增速', values: [8, 12, 6, 9], render: 'line' },
      ],
      colors: ['$accent', '$ink'],
      showLegend: true,
    },
  },
  {
    kind: 'stacked',
    title: '堆积柱形',
    chart: {
      kind: 'stacked',
      categories: ['一月', '二月', '三月', '四月'],
      series: [
        { name: '安全', values: [30, 32, 34, 36] },
        { name: '在途', values: [12, 10, 14, 11] },
        { name: '呆滞', values: [8, 7, 6, 5] },
      ],
      colors: ['$accent', '$ink', '$muted'],
      showLegend: true,
    },
  },
  {
    kind: 'stackedPercent',
    title: '百分比堆积',
    chart: {
      kind: 'stackedPercent',
      categories: ['一月', '二月', '三月', '四月'],
      series: [
        { name: '安全', values: [30, 32, 34, 36] },
        { name: '在途', values: [12, 10, 14, 11] },
        { name: '呆滞', values: [8, 7, 6, 5] },
      ],
      colors: ['$accent', '$ink', '$muted'],
      showLegend: true,
    },
  },
]

function capacity(value: string, width: number, height: number, size: number): TextCapacity {
  const leading = defaultLeading(size)
  const maxLines = Math.max(1, Math.floor((height + 0.5) / (size * leading)))
  const perLine = Math.max(1, Math.floor(width / size))
  return { maxChars: Math.max(Array.from(value).length, perLine * maxLines), maxLines }
}

function label(id: string, value: string, x: number, y: number, w: number, h: number, size: number, color = '$ink', bold = false): DeckElement {
  return {
    id,
    type: 'text',
    role: 'content',
    bounds: { x, y, w, h },
    text: value,
    textCapacity: capacity(value, w, h, size),
    font: { family: '$cjk', size, weight: bold ? 'bold' : 'regular', color, valign: 'top' },
  }
}

export function buildChartGalleryDeck(): Deck {
  const pages: DeckPage[] = CHART_GALLERY.map((item, index) => ({
    id: `chart-${item.kind}`,
    layout: `chart-${item.kind}`,
    name: item.title,
    background: '$paper',
    notes: `${item.title}沿用主题色，不使用 Office 默认蓝。`,
    elements: [
      { id: 'rail', type: 'shape', shape: 'rect', role: 'decoration', bounds: { x: 0, y: 0, w: 8, h: 540 }, fill: '$accent' },
      label('kicker', '原生图表', 40, 18, 360, 18, 12, '$accent', true),
      label('exhibit', String(index + 1).padStart(2, '0'), 760, 18, 160, 18, 12, '$muted'),
      label('title', item.title, 40, 42, 760, 36, 26, '$ink', true),
      { id: 'top-rule', type: 'shape', shape: 'line', role: 'rule', bounds: { x: 40, y: 86, w: 880, h: 1 }, line: { color: '$line', width: 1 } },
      { id: 'plot', type: 'chart', role: 'content', bounds: { x: 48, y: 108, w: 864, h: 360 }, chart: { catLabelSize: 12, valLabelSize: 12, ...item.chart } },
      { id: 'footer-rule', type: 'shape', shape: 'line', role: 'rule', bounds: { x: 40, y: 498, w: 880, h: 1 }, line: { color: '$line', width: 1 } },
      label('source', '示例数字，正式稿换成用户材料。', 40, 508, 700, 20, 11, '$muted'),
    ],
  }))
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: '原生图表',
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    theme: argumentTheme,
    pages,
  }
}
