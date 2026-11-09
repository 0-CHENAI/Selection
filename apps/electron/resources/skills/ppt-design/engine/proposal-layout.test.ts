import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { resolveOfficecliBinary } from '../../../../../../packages/shared/src/utils/officecli.ts'
import { chart, fixtureTheme, makeDeck, makePage, text } from '../styles/kit.ts'
import { checkDeck } from './check.ts'
import { normalizeChartXml } from './chart-schema.ts'
import { exportDeck, singleParagraphProperties } from './export-pptx.ts'
import { joinsWithSpace, mergeInlineRuns } from './inline-runs.ts'
import { loadDeckFile, parseDeckDocument } from './schema.ts'
import type { Deck } from './types.ts'

const PROPOSAL = join(import.meta.dir, '../styles/examples/ppt169_every_day_counts_proposal/deck.json')

function files(out: string): Record<string, string> {
  const zip = unzipSync(readFileSync(out))
  return Object.fromEntries(Object.entries(zip).filter(([name]) => name.endsWith('.xml')).map(([name, bytes]) => [name, Buffer.from(bytes).toString('utf8')]))
}

async function validate(out: string): Promise<string | null> {
  const binary = resolveOfficecliBinary()
  if (!binary) return null
  const proc = Bun.spawn([binary, 'validate', out], { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return stdout
}

describe('inline emphasis runs', () => {
  it('joins word pieces with natural spacing', () => {
    expect(joinsWithSpace('baseline is', '31%')).toBe(true)
    expect(joinsWithSpace('31%', '—')).toBe(true)
    expect(joinsWithSpace('concentrates', ', so')).toBe(false)
    expect(joinsWithSpace('共', '七章')).toBe(false)
    expect(joinsWithSpace('七章', '28条')).toBe(false)
    expect(joinsWithSpace('(', 'see')).toBe(false)
  })

  it('merges side-by-side text boxes on one line into one paragraph', () => {
    const elements = [
      text('a', 'Chronic absenteeism', 40, 100, 160, 22, 18, { family: '$latin' }),
      text('b', 'concentrates', 201, 100, 100, 22, 18, { family: '$latin', bold: true }),
      text('c', ', so a district', 302, 100, 120, 22, 18, { family: '$latin' }),
      text('d', 'Next line', 40, 130, 120, 22, 18, { family: '$latin' }),
    ]
    const merged = mergeInlineRuns(elements)
    expect(merged.map(element => element.id)).toEqual(['a', 'd'])
    expect(merged[0]!.text).toBe('Chronic absenteeism concentrates, so a district')
    expect(merged[0]!.runs?.map(run => [run.text, run.bold ?? false])).toEqual([
      ['Chronic absenteeism', false],
      [' concentrates', true],
      [', so a district', false],
    ])
    expect(merged[0]!.bounds.w).toBe(382)
  })

  it('exports one schema-valid paragraph with one paragraph property block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-runs-'))
    try {
      const deck = makeDeck('runs', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [
        text('a', 'Baseline is', 40, 100, 100, 22, 18, { family: '$latin' }),
        text('b', '31%', 141, 100, 40, 22, 18, { family: '$latin', bold: true }),
        text('c', '— about 3,100 students', 182, 100, 200, 22, 18, { family: '$latin' }),
      ], '')])
      const out = join(dir, 'runs.pptx')
      await exportDeck(deck, out, { enforceCheck: false, platform: 'linux' })
      const slide = files(out)['ppt/slides/slide1.xml']!
      expect(slide).toContain('<a:t> 31%</a:t>')
      for (const paragraph of slide.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
        expect(paragraph.match(/<a:pPr\b/g)?.length ?? 0).toBeLessThanOrEqual(1)
        if (paragraph.includes('<a:pPr')) expect(paragraph.startsWith('<a:p><a:pPr')).toBe(true)
      }
      const report = await validate(out)
      if (report !== null) expect(report).toContain('no errors')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps only the leading paragraph properties', () => {
    const xml = '<a:p><a:pPr algn="l"/><a:r><a:t>a</a:t></a:r><a:pPr algn="l"/><a:r><a:t>b</a:t></a:r></a:p>'
    expect(singleParagraphProperties(xml)).toBe('<a:p><a:pPr algn="l"/><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p>')
  })

  it('accepts runs in v1 decks only when they spell the text', () => {
    const { deck } = loadDeckFile(PROPOSAL)
    const base = structuredClone(deck!) as Deck
    const target = base.pages[0]!.elements.find(element => element.type === 'text')!
    const ok = structuredClone(base)
    const okTarget = ok.pages[0]!.elements.find(element => element.id === target.id)!
    okTarget.runs = [{ text: target.text!.slice(0, 2) }, { text: target.text!.slice(2), bold: true }]
    expect(parseDeckDocument(ok).issues.filter(item => item.severity === 'error')).toEqual([])
    const bad = structuredClone(base)
    bad.pages[0]!.elements.find(element => element.id === target.id)!.runs = [{ text: 'other' }]
    expect(parseDeckDocument(bad).issues.some(item => item.message.includes('runs'))).toBe(true)
  })
})

describe('text collision preflight', () => {
  it('catches the proposal caption that sat under wrapped body text', () => {
    const { deck } = loadDeckFile(PROPOSAL)
    expect(checkDeck(deck!).filter(item => item.code === 'text_collision')).toEqual([])
    const old = structuredClone(deck!) as Deck
    const page = old.pages.find(item => item.elements.some(element => element.id === 'e44'))!
    page.elements.find(element => element.id === 'e44')!.bounds.y = 459.45
    const hits = checkDeck(old).filter(item => item.code === 'text_collision')
    expect(hits.length).toBe(1)
    expect(hits[0]!.severity).toBe('warning')
  })

  it('ignores text on the same line and stacked decoration', () => {
    const deck = makeDeck('ok', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [
      text('a', 'Left part of a line', 40, 100, 160, 22, 18),
      text('b', 'right part', 200, 100, 100, 22, 18),
      text('c', 'Below', 40, 140, 100, 22, 18),
    ], '')])
    expect(checkDeck(deck).filter(item => item.code === 'text_collision')).toEqual([])
  })
})

describe('chart XML schema order', () => {
  it('drops the third axis id, adds line grouping and orders series children', () => {
    const xml = '<c:chartSpace><c:chart><c:plotArea><c:lineChart><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:invertIfNegative val="0"/><c:dLbls><c:showVal val="0"/></c:dLbls><c:dPt><c:idx val="1"/></c:dPt><c:val/></c:ser><c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:lineChart></c:plotArea></c:chart></c:chartSpace>'
    const out = normalizeChartXml(xml)
    expect(out).toContain('<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>')
    expect(out.match(/<c:axId /g)?.length).toBe(2)
    expect(out).not.toContain('invertIfNegative')
    expect(out.indexOf('<c:dPt>')).toBeLessThan(out.indexOf('<c:dLbls>'))
  })

  it('keeps horizontal bar labels on one line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bar-labels-'))
    try {
      const deck = makeDeck('bars', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [
        chart('bars', 40, 40, 600, 240, { kind: 'bar', categories: ['South Cambridgeshire DC', 'UK 2022 pilot'], series: [{ name: 's', values: [37, 38] }] }),
      ], '')])
      const out = join(dir, 'bars.pptx')
      await exportDeck(deck, out, { enforceCheck: false, platform: 'linux' })
      const [, xml] = Object.entries(files(out)).find(([name]) => /charts\/chart\d+\.xml$/.test(name))!
      const labels = xml.match(/<c:dLbls>[\s\S]*?<\/c:dLbls>/g) ?? []
      expect(labels.length).toBeGreaterThan(0)
      for (const block of labels) {
        expect(block).toContain('<c:showCatName val="1"/>')
        expect(block).toContain('<a:bodyPr wrap="none"/>')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exports the proposal charts without schema errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chart-schema-'))
    try {
      const deck = makeDeck('charts', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [
        chart('bar', 40, 40, 400, 240, { kind: 'column', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }),
        chart('line', 460, 40, 400, 240, { kind: 'line', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }),
        chart('wf', 40, 300, 400, 200, { kind: 'waterfall', categories: ['a', 'b', 'c'], series: [{ name: 's', values: [5, -1, 4] }] }),
      ], '')])
      const out = join(dir, 'charts.pptx')
      await exportDeck(deck, out, { enforceCheck: false, platform: 'linux' })
      const charts = Object.entries(files(out)).filter(([name]) => /charts\/chart\d+\.xml$/.test(name))
      expect(charts.length).toBeGreaterThan(0)
      for (const [, xml] of charts) {
        for (const plot of xml.match(/<c:(?:bar|line)Chart>[\s\S]*?<\/c:(?:bar|line)Chart>/g) ?? []) expect(plot.match(/<c:axId /g)?.length ?? 0).toBeLessThanOrEqual(2)
      }
      const report = await validate(out)
      if (report !== null) expect(report).toContain('no errors')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
