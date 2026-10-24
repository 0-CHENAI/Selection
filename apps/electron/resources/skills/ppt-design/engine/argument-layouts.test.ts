import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argumentLayoutById, argumentLayouts, buildArgumentDeck, buildArgumentPage } from './argument-layouts.ts'
import { buildChartGalleryDeck, CHART_GALLERY } from './chart-gallery.ts'
import { checkDeck } from './check.ts'
import { exportDeck } from './export-pptx.ts'
import { parseDeckDocument } from './schema.ts'
import { fixtureTheme, makeDeck, makePage } from '../styles/kit.ts'

const EXPECTED = [
  'conclusion',
  'evidence-tree',
  'matrix-2x2',
  'waterfall',
  'trend-annotated',
  'scorecard',
  'gantt-roadmap',
  'architecture',
  'case-compare',
  'funnel',
  'process',
  'timeline',
  'closing',
  'decision',
]

async function unzipEntry(file: string, entry: string): Promise<string> {
  const proc = Bun.spawn(['unzip', '-p', file, entry], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  if (await proc.exited) throw new Error(await new Response(proc.stderr).text())
  return text
}

/** pptxgenjs numbers charts from a process-wide counter, so parallel exports do not start at chart1. */
async function chartXmlForSlide(file: string, slide: number): Promise<string> {
  const rels = await unzipEntry(file, `ppt/slides/_rels/slide${slide}.xml.rels`)
  const target = rels.match(/relationships\/chart" Target="([^"]+)"/)?.[1]
  if (!target) throw new Error(`slide ${slide} has no chart relationship`)
  return unzipEntry(file, target.replace(/^\//, ''))
}

describe('argument layouts', () => {
  it('publishes at least twelve layouts with bounds and text capacity', () => {
    expect(argumentLayouts.map(layout => layout.id)).toEqual(EXPECTED)
    for (const layout of argumentLayouts) {
      expect(layout.slots.length).toBeGreaterThan(3)
      const text = layout.slots.filter(slot => slot.kind === 'text')
      expect(text.length).toBeGreaterThan(0)
      for (const slot of text) {
        expect(slot.bounds.w).toBeGreaterThan(0)
        expect(slot.bounds.h).toBeGreaterThan(0)
        expect(slot.textCapacity?.maxChars).toBeGreaterThan(0)
        expect(slot.textCapacity?.maxLines).toBeGreaterThan(0)
      }
    }
  })

  it('passes deck_check and keeps the geometry after a JSON round trip', () => {
    const deck = buildArgumentDeck()
    expect(checkDeck(deck)).toEqual([])
    const parsed = parseDeckDocument(JSON.parse(JSON.stringify(deck)))
    expect(parsed.issues).toEqual([])
    expect(checkDeck(parsed.deck!)).toEqual([])
  })

  it('recognizes a moved, missing, or over-capacity slot and ignores other layout ids', () => {
    const page = buildArgumentPage('conclusion')
    const moved = structuredClone(page)
    const claim = moved.elements.find(element => element.id === 'claim')!
    claim.bounds = { ...claim.bounds, x: claim.bounds.x + 12 }
    expect(checkDeck(buildArgumentDeck()).length).toBe(0)
    const movedIssues = checkDeck({ ...buildArgumentDeck(), pages: [moved, buildArgumentPage('closing')] })
    expect(movedIssues.some(item => item.elementId === 'claim' && item.message.includes('目录几何'))).toBe(true)

    const missing = structuredClone(page)
    missing.elements = missing.elements.filter(element => element.id !== 'claim')
    const missingIssues = checkDeck({ ...buildArgumentDeck(), pages: [missing, buildArgumentPage('matrix-2x2')] })
    expect(missingIssues.some(item => item.elementId === 'claim' && item.message.includes('缺少元素'))).toBe(true)

    const roomy = structuredClone(page)
    const title = roomy.elements.find(element => element.id === 'claim')!
    title.textCapacity = { maxChars: (title.textCapacity?.maxChars ?? 0) + 40, maxLines: (title.textCapacity?.maxLines ?? 1) + 2 }
    const roomyIssues = checkDeck({ ...buildArgumentDeck(), pages: [roomy, buildArgumentPage('funnel')] })
    expect(roomyIssues.some(item => item.elementId === 'claim' && item.message.includes('textCapacity'))).toBe(true)

    const custom = makeDeck('其他', fixtureTheme, [makePage('p1', '01-cover', '封面', '$paper', [], '')])
    expect(checkDeck(custom).some(item => item.message.includes('版式'))).toBe(false)
    expect(argumentLayoutById('01-cover')).toBeUndefined()
  })

  it('keeps catalog capacity when the sample sentence is replaced', () => {
    const page = buildArgumentPage('closing', { 'now-title': '把这句话写得超过这一格能放下的宽度，于是预检应该报溢出' })
    const slot = argumentLayoutById('closing')?.slots.find(item => item.id === 'now-title')
    const element = page.elements.find(item => item.id === 'now-title')
    expect(element?.textCapacity).toEqual(slot?.textCapacity)
    expect(checkDeck({ ...buildArgumentDeck(), pages: [buildArgumentPage('conclusion'), page] }).some(item => item.code === 'over_capacity' && item.elementId === 'now-title')).toBe(true)
  })
})

describe('native charts', () => {
  it('rejects incomplete scatter, bubble, radar, stacked, and combo specs', () => {
    const base = {
      format: 'selection-deck',
      version: 1,
      title: '图表',
      canvas: { width: 960, height: 540 },
      theme: fixtureTheme,
      pages: [{
        id: 'p',
        layout: 'chart-page',
        background: '$paper',
        elements: [{
          id: 'plot',
          type: 'chart',
          bounds: { x: 40, y: 40, w: 400, h: 240 },
          chart: {
            kind: 'scatter',
            categories: ['甲', '乙'],
            series: [{ name: '点', values: [1, 2] }],
          },
        }],
      }],
    }
    expect(parseDeckDocument(base).issues.some(item => item.message.includes('.x'))).toBe(true)
    const bubble = structuredClone(base)
    const chart = bubble.pages[0]!.elements[0]!.chart as { kind: string; series: Array<Record<string, unknown>> }
    chart.kind = 'bubble'
    chart.series[0] = { name: '点', values: [1, 2], x: [1, 2], sizes: [0, 4] }
    expect(parseDeckDocument(bubble).issues.some(item => item.message.includes('sizes'))).toBe(true)
    const radar = structuredClone(base)
    ;(radar.pages[0]!.elements[0]!.chart as { kind: string }).kind = 'radar'
    expect(parseDeckDocument(radar).issues.some(item => item.message.includes('雷达'))).toBe(true)
    const combo = structuredClone(base)
    const comboChart = combo.pages[0]!.elements[0]!.chart as { kind: string; series: Array<Record<string, unknown>> }
    comboChart.kind = 'combo'
    comboChart.series = [{ name: '柱', values: [1, 2], render: 'column' }]
    expect(parseDeckDocument(combo).issues.some(item => item.message.includes('柱线'))).toBe(true)
  })

  it('writes themed native charts instead of the Office default palette', async () => {
    const deck = buildChartGalleryDeck()
    expect(checkDeck(deck)).toEqual([])
    const parsed = parseDeckDocument(JSON.parse(JSON.stringify(deck)))
    expect(parsed.issues).toEqual([])
    expect(CHART_GALLERY.map(item => item.kind)).toEqual(['bar', 'column', 'line', 'pie', 'doughnut', 'waterfall', 'area', 'scatter', 'bubble', 'radar', 'combo', 'stacked', 'stackedPercent'])
    const out = join(mkdtempSync(join(tmpdir(), 'chart-kinds-')), 'charts.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    const expectXml: Record<number, string[]> = {
      1: ['barChart', 'maxMin', 'C8102E', 'sz="1300"', 'sz="1100"', 'sz="1200"', 'outEnd', 'B7B7B6', 'tickLblPos val="none"', 'showCatName val="1"', 'a:ea typeface="Noto Sans CJK SC"'],
      3: ['lineChart', 'dLblPos val="t"', 'sz="1300"', 'showVal val="1"', '<c:delete val="1"/>'],
      4: ['pieChart', 'outEnd', 'showLeaderLines val="1"', 'C8102E', 'separator', 'showPercent val="0"', 'showVal val="1"', 'sz="1200"'],
      5: ['doughnutChart', 'outEnd', 'showLeaderLines val="1"', 'showPercent val="0"', 'showVal val="1"', 'sz="1200"'],
      6: ['barChart', '合计', '增加', '减少', 'C8102E', '5A5A5A', '141414'],
      7: ['areaChart', 'C8102E', 'alpha', 'showVal val="1"', '<c:delete val="1"/>'],
      8: ['scatterChart', 'C8102E', 'D7D7D6', '<a:t>甲</a:t>'],
      9: ['bubbleChart', 'bubbleSize', 'bubbleScale'],
      10: ['radarChart', 'filled', 'sz="1300"'],
      11: ['barChart', 'lineChart', 'C8102E', 'outEnd'],
      12: ['grouping val="stacked"', 'dLblPos val="ctr"', 'FFFFFF'],
      13: ['grouping val="percentStacked"', '0%'],
    }
    for (const [index, needles] of Object.entries(expectXml)) {
      const xml = await chartXmlForSlide(out, Number(index))
      for (const needle of needles) expect(xml, `slide ${index} missing ${needle}`).toContain(needle)
      expect(xml).not.toContain('C0504D')
      expect(xml).not.toContain('4F81BD')
      expect(xml).not.toContain('accent1')
      expect(xml).toContain('Noto Sans CJK SC')
      expect(xml).toContain('a:ea typeface="Noto Sans CJK SC"')
    }
    const bar = await chartXmlForSlide(out, 1)
    expect(bar).not.toContain('majorGridlines')
    const line = await chartXmlForSlide(out, 3)
    expect(line.match(/<c:dLbl>/g)?.length).toBe(5)
    const area = await chartXmlForSlide(out, 7)
    expect(area.match(/<c:dLbl>/g)?.length).toBe(9)
    const doughnut = await chartXmlForSlide(out, 5)
    expect(doughnut).toContain('<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/>')
    const pieSlide = await unzipEntry(out, 'ppt/slides/slide4.xml')
    expect(pieSlide).toContain('name="plot-leader-0"')
    expect(pieSlide).toContain('name="plot-leader-2"')
    const lineSlide = await unzipEntry(out, 'ppt/slides/slide3.xml')
    expect(lineSlide).toContain('name="plot-edge-0"')
    const waterfallSlide = await unzipEntry(out, 'ppt/slides/slide6.xml')
    expect(waterfallSlide).toContain('+18')
    expect(waterfallSlide).toContain('\u221230')
    expect(waterfallSlide.match(/name="plot-wf-/g)?.length).toBe(5)
    const radar = await chartXmlForSlide(out, 10)
    expect(radar).not.toContain('<c:dLbl>')
    const bubble = await chartXmlForSlide(out, 9)
    expect(bubble).not.toContain('<c:dLbl>')
    expect(bubble).toContain('majorGridlines')
  })

  it('omits value labels when showValues is false', async () => {
    const deck = buildChartGalleryDeck()
    const page = deck.pages.find(item => item.id === 'chart-column')!
    page.elements.find(item => item.id === 'plot')!.chart!.showValues = false
    const out = join(mkdtempSync(join(tmpdir(), 'chart-quiet-')), 'quiet.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    const xml = await chartXmlForSlide(out, 2)
    expect(xml).not.toContain('<c:dLblPos val="outEnd"/>')
    expect(xml).not.toContain('<c:showVal val="1"/>')
    expect(xml).toContain('sz="1300"')
  })
})
