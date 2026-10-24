import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPptRevisionPrompt, clearStalePptGenerating, markPptGenerating, readChartFallbacks, readPptLive, readPptProgress, validatePptRevision } from './ppt-live'

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

test('live snapshot reads the session deck, check status, and omits known images', async () => {
  const root = session()
  try {
    deck(root, 3)
    writeFileSync(join(root, 'data', 'slides', 'slide-01.png'), Buffer.from('png-1'))
    writeFileSync(join(root, 'data', 'slides', 'slide-02.png'), Buffer.from('png-2'))
    const first = await readPptLive(root, {
      check: () => [{ pageId: 'p2' }, { pageId: 'p2' }],
    })
    expect(first?.canvas).toEqual({ width: 960, height: 540, label: '16:9' })
    expect(first?.fileName).toBe('2025宏观经济简报.pptx')
    expect(first?.pages.map(page => page.status)).toEqual(['passed', 'needs_revision', 'passed'])
    expect(first?.pages[1]?.issueCount).toBe(2)
    expect(first?.pages[0]?.elements.map(element => element.id)).toEqual(['title', 'chart'])
    expect(first?.pages[0]?.image).toContain('data:image/png;base64,')
    expect(first?.generating).toBe(false)
    const again = await readPptLive(root, {
      known: { '1': first!.pages[0]!.imageHash!, '2': '0'.repeat(40) },
      check: () => [{ pageId: 'p2' }],
    })
    expect(again?.pages[0]?.image).toBeUndefined()
    expect(again?.pages[0]?.imageHash).toBe(first!.pages[0]!.imageHash)
    expect(again?.pages[1]?.image).toContain('data:image/png')
    expect(readPptProgress(root, false)?.total).toBe(3)
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
    const live = await readPptLive(root, { generating: true, check: () => [] })
    expect(live?.generating).toBe(true)
    expect(live?.current).toBe(9)
    expect(live?.completed).toBe(8)
    expect(live?.currentTitle).toBe('消费：社零总额与结构')
    expect(live?.pages[8]?.status).toBe('fixing')
    expect(live?.pages[8]?.image).toBeTruthy()
    expect(live?.pages[9]?.status).toBe('pending')
    expect(live?.pages[9]?.image).toBeUndefined()
    expect(live?.pages[7]?.status).toBe('passed')
    const progress = readPptProgress(root, true)
    expect(progress).toMatchObject({ total: 17, completed: 8, current: 9, generating: true })
    const cleared = clearStalePptGenerating(root, progress!)
    expect(cleared?.generating).toBe(false)
    expect(cleared?.current).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a chart skill timeout is shown to the live panel and a bad file is ignored', async () => {
  const root = session()
  try {
    deck(root, 1)
    writeFileSync(join(root, 'data', 'chart-fallback.json'), JSON.stringify({ fallbacks: [{ skill: 'sample-charts', reason: 'timeout', page: 1 }, { skill: '../other', reason: 'error' }] }))
    const live = await readPptLive(root, { check: () => [] })
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
