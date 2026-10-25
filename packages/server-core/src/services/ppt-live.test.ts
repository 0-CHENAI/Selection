import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { buildPptRevisionPrompt, clearStalePptGenerating, exportIncrementalPptx, markPptGenerating, readChartFallbacks, readPptProgress, validatePptRevision } from './ppt-live'

function session(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'ppt-live-')))
}

function deck(root: string, pages: number) {
  mkdirSync(join(root, 'data', 'slides'), { recursive: true })
  writeFileSync(join(root, 'data', 'deck.json'), JSON.stringify({
    title: '2025宏观经济简报',
    canvas: { width: 960, height: 540 },
    pages: Array.from({ length: pages }, (_, index) => ({
      id: `p${index + 1}`,
      name: index === 8 ? '消费：社零总额与结构' : `第${index + 1}页`,
      elements: [
        { id: 'title', type: 'text', bounds: { x: 48, y: 40, w: 400, h: 48 }, text: '标题' },
        { id: 'wash', type: 'shape', role: 'decoration', bounds: { x: 0, y: 0, w: 960, h: 540 } },
        { id: 'chart', type: 'chart', bounds: { x: 80, y: 120, w: 400, h: 280 } },
      ],
    })),
  }))
  writeFileSync(join(root, 'data', '2025宏观经济简报.pptx'), 'pptx-bytes')
}

test('progress reads the session deck and check status without inventing a filename', () => {
  const root = session()
  try {
    deck(root, 3)
    writeFileSync(join(root, 'data', 'slides', 'slide-01.png'), Buffer.from('png-1'))
    writeFileSync(join(root, 'data', 'slides', 'slide-02.png'), Buffer.from('png-2'))
    const first = readPptProgress(root, false, { check: () => [{ pageId: 'p2' }, { pageId: 'p2' }] })
    expect(first?.fileName).toBe('2025宏观经济简报.pptx')
    expect(first?.pptxPath).toBe(join(root, 'data', '2025宏观经济简报.pptx'))
    expect(first?.pages?.map(page => page.status)).toEqual(['passed', 'needs_revision', 'passed'])
    expect(first?.pages?.[1]?.issueCount).toBe(2)
    expect(first?.generating).toBe(false)
    expect(readPptProgress(root, false)?.total).toBe(3)
    rmSync(join(root, 'data', '2025宏观经济简报.pptx'))
    const unnamed = readPptProgress(root, true, { check: () => [] })
    expect(unnamed?.fileName).toBeUndefined()
    expect(unnamed?.pptxPath).toBeUndefined()
    expect(unnamed?.total).toBe(3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generating progress follows the first missing slide and an explicit current page', async () => {
  const root = session()
  try {
    deck(root, 17)
    for (let page = 1; page <= 9; page++) writeFileSync(join(root, 'data', 'slides', `slide-${String(page).padStart(2, '0')}.png`), Buffer.from(`p${page}`))
    writeFileSync(join(root, 'data', 'ppt-progress.json'), JSON.stringify({ current: 9 }))
    markPptGenerating(root, true)
    const live = readPptProgress(root, true, { check: () => [] })
    expect(live?.generating).toBe(true)
    expect(live?.current).toBe(9)
    expect(live?.completed).toBe(8)
    expect(live?.currentTitle).toBe('消费：社零总额与结构')
    expect(live?.pages?.[8]?.status).toBe('fixing')
    expect(live?.pages?.[9]?.status).toBe('pending')
    expect(live?.pages?.[7]?.status).toBe('passed')
    const progress = readPptProgress(root, true)
    expect(progress).toMatchObject({ total: 17, completed: 8, current: 9, generating: true })
    const cleared = clearStalePptGenerating(root, progress!)
    expect(cleared?.generating).toBe(false)
    expect(cleared?.current).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a chart skill timeout is shown on the result progress and a bad file is ignored', () => {
  const root = session()
  try {
    deck(root, 1)
    writeFileSync(join(root, 'data', 'chart-fallback.json'), JSON.stringify({ fallbacks: [{ skill: 'sample-charts', reason: 'timeout', page: 1 }, { skill: '../other', reason: 'error' }] }))
    const live = readPptProgress(root, false, { check: () => [] })
    expect(live?.chartFallbacks).toEqual([{ skill: 'sample-charts', reason: 'timeout', page: 1 }])
    expect(readChartFallbacks(root)).toEqual(live?.chartFallbacks ?? [])
    writeFileSync(join(root, 'data', 'chart-fallback.json'), '{')
    expect(readChartFallbacks(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a partial deck write is ignored and revision prompts name only the selected pages', () => {
  const root = session()
  try {
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(join(root, 'data', 'deck.json'), '{"pages":')
    expect(readPptProgress(root, true)).toBeNull()
    const revision = validatePptRevision({ action: 'revise', targets: [{ page: 3 }, { page: 4, elementId: 'title' }], comment: '把标题改短' })
    expect(revision.targets).toEqual([{ page: 3 }, { page: 4, elementId: 'title' }])
    const prompt = buildPptRevisionPrompt(revision, root)
    expect(prompt).toContain('page 3')
    expect(prompt).toContain('page 4 element "title"')
    expect(prompt).toContain(join(root, 'data', 'deck.json'))
    expect(prompt).toContain('slide-01.png')
    expect(prompt).toContain('把标题改短')
    expect(prompt).toContain('Keep every other page identical')
    expect(prompt).toContain('/slide[n]/shape[@name=<element id>]')
    expect(() => validatePptRevision({ action: 'revise', targets: [] })).toThrow()
    expect(() => validatePptRevision({ targets: [{ page: 0 }] })).toThrow()
    expect(() => validatePptRevision({ targets: Array.from({ length: 257 }, (_, index) => ({ page: 1, elementId: `e${index}` })) })).toThrow()
    const theme = validatePptRevision({ action: 'recolor', targets: [], themeId: 'academic-ink' })
    expect(theme.themeId).toBe('academic-ink')
    expect(validatePptRevision({ action: 'restyle', targets: [], templateId: 'dsh-cartesian' }).templateId).toBe('dsh-cartesian')
    expect(() => validatePptRevision({ action: 'restyle', targets: [], templateId: '../escape' })).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('incremental export adds slides as pages are saved and does not rewrite an unchanged deck', async () => {
  const root = session()
  try {
    const { getPptSkillRoot } = await import('./ppt-catalog')
    const kit = await import(pathToFileURL(join(getPptSkillRoot(), 'styles/kit.ts')).href) as {
      fixtureTheme: unknown
      makeDeck: (title: string, theme: unknown, pages: unknown[]) => unknown
      makePage: (id: string, layout: string, name: string, background: string, elements: unknown[], notes: string) => unknown
      text: (id: string, value: string, x: number, y: number, w: number, h: number, size: number, opts?: { bold?: boolean }) => unknown
    }
    const page = (index: number) => kit.makePage(`p${index}`, 'free', `第${index}页`, '$paper', [
      kit.text('title-el', `第${index}页`, 48, 40, 400, 48, 24, { bold: true }),
    ], '')
    mkdirSync(join(root, 'data'), { recursive: true })
    const write = (count: number) => writeFileSync(join(root, 'data', 'deck.json'), JSON.stringify(kit.makeDeck('往返', kit.fixtureTheme, Array.from({ length: count }, (_, index) => page(index + 1)))))
    const slideNames = (file: string) => Object.keys(unzipSync(readFileSync(file))).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    write(1)
    const first = await exportIncrementalPptx(root)
    expect(first).toBe(join(root, 'data', 'deck.pptx'))
    expect(slideNames(first!)).toEqual(['ppt/slides/slide1.xml'])
    expect(Buffer.from(unzipSync(readFileSync(first!))['ppt/slides/slide1.xml']!).toString('utf8')).toContain('name="title-el"')
    write(3)
    const grown = await exportIncrementalPptx(root)
    expect(slideNames(grown!).sort()).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml'])
    writeFileSync(grown!, Buffer.from('KEEP'))
    expect(await exportIncrementalPptx(root)).toBe(grown)
    expect(readFileSync(grown!).toString()).toBe('KEEP')
    const direct = session()
    try {
      mkdirSync(join(direct, 'slides'), { recursive: true })
      writeFileSync(join(direct, '直接.pptx'), Buffer.from('pptx'))
      expect(readPptProgress(direct, true, { workingDirectory: direct })?.fileName).toBe('直接.pptx')
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
