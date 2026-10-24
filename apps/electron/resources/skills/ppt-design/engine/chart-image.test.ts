import { describe, expect, it } from 'bun:test'
import { argumentTheme, buildArgumentPage } from './argument-layouts.ts'
import { checkDeck } from './check.ts'
import { parseDeckDocument } from './schema.ts'
import { DECK_FORMAT, DECK_VERSION, type Deck, type DeckElement } from './types.ts'

const data = '月份\t周转天数\n一月\t42\n六月\t74'

function imageChart(bounds: DeckElement['bounds'], notes = data): Deck {
  const page = buildArgumentPage('trend-annotated')
  const chart = page.elements.find(element => element.type === 'chart')
  if (!chart) throw new Error('trend page has no chart')
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: '图片图表',
    canvas: { width: 960, height: 540 },
    theme: argumentTheme,
    pages: [{
      ...page,
      notes: notes ? `${page.notes ?? ''}\n${notes}` : page.notes,
      elements: page.elements.map(element => element.id === chart.id ? {
        id: chart.id,
        type: 'image' as const,
        role: 'content' as const,
        bounds,
        src: 'charts/trend.svg',
        alt: '周转天数',
        fit: 'fill' as const,
        chartImage: { skill: 'sample-charts', format: 'svg' as const, data },
      } : element),
    }],
  }
}

describe('image charts from an external skill', () => {
  it('accepts a picture on the chart slot when the notes carry the data table', () => {
    const page = buildArgumentPage('trend-annotated')
    const chart = page.elements.find(element => element.id === 'trend')!
    const issues = checkDeck(imageChart(chart.bounds))
    expect(issues.filter(issue => issue.elementId === 'trend')).toEqual([])
  })

  it('reports a missing data table, a tiny picture, and a picture past the canvas', () => {
    const page = buildArgumentPage('trend-annotated')
    const chart = page.elements.find(element => element.id === 'trend')!
    const missing = checkDeck(imageChart(chart.bounds, '')).map(issue => issue.message).join('\n')
    expect(missing).toContain('原始数据表')
    const tiny = checkDeck(imageChart({ ...chart.bounds, w: 20, h: 20 })).map(issue => issue.message).join('\n')
    expect(tiny).toContain('尺寸过小')
    const overflow = checkDeck(imageChart({ x: 900, y: 112, w: 200, h: 200 })).map(issue => issue.message).join('\n')
    expect(overflow).toContain('超出')
  })

  it('keeps chartImage on an image and rejects it on other elements', () => {
    const source = imageChart(buildArgumentPage('trend-annotated').elements.find(element => element.id === 'trend')!.bounds)
    const parsed = parseDeckDocument(JSON.parse(JSON.stringify(source)))
    expect(parsed.issues).toEqual([])
    expect(parsed.deck?.pages[0]?.elements.find(element => element.id === 'trend')?.chartImage?.format).toBe('svg')
    const broken = JSON.parse(JSON.stringify(source)) as Deck
    const text = broken.pages[0]!.elements.find(element => element.type === 'text') as DeckElement & { chartImage?: unknown }
    text.chartImage = { skill: 'sample-charts', format: 'svg', data }
    const rejected = parseDeckDocument(broken)
    expect(rejected.issues.some(issue => issue.message.includes('chartImage'))).toBe(true)
  })
})
