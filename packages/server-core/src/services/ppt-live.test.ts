import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { isArtifactCardPath, isSessionScratchPath } from '@craft-agent/shared/utils/artifact-links'
import { buildPptRevisionPrompt, clearStalePptGenerating, exportIncrementalPptx, markPptGenerating, pptDeckStamp, readChartFallbacks, readPptProgress, readPptRun, validatePptRevision, watchPptDeck, writePptRun } from './ppt-live'

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
  writeFileSync(join(root, '2025宏观经济简报.pptx'), 'pptx-bytes')
}

test('progress reads the session deck and check status without inventing a filename', () => {
  const root = session()
  try {
    deck(root, 3)
    writeFileSync(join(root, 'data', 'slides', 'slide-01.png'), Buffer.from('png-1'))
    writeFileSync(join(root, 'data', 'slides', 'slide-02.png'), Buffer.from('png-2'))
    const first = readPptProgress(root, false, { check: () => [{ pageId: 'p2' }, { pageId: 'p2' }] })
    expect(first?.fileName).toBe('2025宏观经济简报.pptx')
    expect(first?.pptxPath).toBe(join(root, '2025宏观经济简报.pptx'))
    writeFileSync(join(root, 'data', 'deck.pptx'), 'scratch')
    expect(readPptProgress(root, false)?.pptxPath).toBe(join(root, '2025宏观经济简报.pptx'))
    expect(first?.pages?.map(page => page.status)).toEqual(['passed', 'needs_revision', 'passed'])
    expect(first?.pages?.[1]?.issueCount).toBe(2)
    expect(first?.generating).toBe(false)
    expect(readPptProgress(root, false)?.total).toBe(3)
    rmSync(join(root, '2025宏观经济简报.pptx'))
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

test('a recolor or restyle starts at 0 and the cover follows only a redrawn page', () => {
  const root = session()
  try {
    deck(root, 11)
    for (let page = 1; page <= 11; page++) writeFileSync(join(root, 'data', 'slides', `slide-${String(page).padStart(2, '0')}.png`), Buffer.from(`p${page}`))
    writeFileSync(join(root, 'data', 'ppt-progress.json'), JSON.stringify({ current: 1 }))
    writePptRun(root, { action: 'recolor', themeId: 'keynote-stage' })
    markPptGenerating(root, true)
    const started = readPptProgress(root, true, { check: () => [] })
    expect(started?.completed).toBe(0)
    expect(started?.current).toBeUndefined()
    expect(started?.pages?.every(page => page.status === 'pending')).toBe(true)
    const redraw = (page: number, at: number) => {
      const file = join(root, 'data', 'slides', `slide-${String(page).padStart(2, '0')}.png`)
      writeFileSync(file, Buffer.from(`redraw-${page}-${'x'.repeat(page)}`))
      const when = new Date(Date.now() + at)
      utimesSync(file, when, when)
    }
    redraw(1, 1000)
    const first = readPptProgress(root, true, { check: () => [] })
    expect(first).toMatchObject({ current: 1, completed: 0, generating: true })
    redraw(4, 2000)
    const fourth = readPptProgress(root, true, { check: () => [] })
    expect(fourth).toMatchObject({ current: 4, completed: 3 })
    expect(fourth?.pages?.[3]?.status).toBe('fixing')
    expect(fourth?.pages?.[4]?.status).toBe('pending')
    writeFileSync(join(root, 'data', 'ppt-progress.json'), JSON.stringify({ current: 6 }))
    expect(readPptProgress(root, true)?.current).toBe(6)
    expect(readPptProgress(root, true)?.completed).toBe(5)
    markPptGenerating(root, false)
    const done = readPptProgress(root, false, { check: () => [] })
    expect(done?.current).toBeUndefined()
    expect(done?.completed).toBe(11)
    writePptRun(root, { action: 'restyle', templateId: 'paper' })
    markPptGenerating(root, true)
    const restyle = readPptProgress(root, true, { check: () => [] })
    expect(restyle?.completed).toBe(0)
    expect(restyle?.current).toBeUndefined()
    expect(restyle?.run?.action).toBe('restyle')
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
    expect(prompt).toContain('ppt-output.json')
    expect(prompt).not.toContain('data/deck.pptx')
    expect(prompt).not.toContain('live panel')
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
    writeFileSync(join(root, 'data', 'deck.pptx'), Buffer.from('SCRATCH'))
    expect(readPptProgress(root, true)?.fileName).toBeUndefined()
    const first = await exportIncrementalPptx(root)
    expect(first).toBe(join(root, '往返.pptx'))
    expect(existsSync(join(root, 'data', 'deck.pptx'))).toBe(false)
    expect(slideNames(first!)).toEqual(['ppt/slides/slide1.xml'])
    expect(Buffer.from(unzipSync(readFileSync(first!))['ppt/slides/slide1.xml']!).toString('utf8')).toContain('name="title-el"')
    expect(readPptProgress(root, true)?.pptxPath).toBe(first)
    write(3)
    const grown = await exportIncrementalPptx(root)
    expect(grown).toBe(first)
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

test('a titled pptx is the only visible file, in the session folder or the working directory', async () => {
  const workspace = session()
  const root = join(workspace, 'sessions', 'demo')
  const wd = session()
  try {
    const { getPptSkillRoot } = await import('./ppt-catalog')
    const kit = await import(pathToFileURL(join(getPptSkillRoot(), 'styles/kit.ts')).href) as {
      fixtureTheme: unknown
      makeDeck: (title: string, theme: unknown, pages: unknown[]) => unknown
      makePage: (id: string, layout: string, name: string, background: string, elements: unknown[], notes: string) => unknown
      text: (id: string, value: string, x: number, y: number, w: number, h: number, size: number, opts?: { bold?: boolean }) => unknown
    }
    const page = kit.makePage('p1', 'free', '封面', '$paper', [kit.text('title-el', '封面', 48, 40, 400, 48, 24, { bold: true })], '')
    const write = (dir: string, title: string) => {
      mkdirSync(join(dir, 'data'), { recursive: true })
      writeFileSync(join(dir, 'data', 'deck.json'), JSON.stringify(kit.makeDeck(title, kit.fixtureTheme, [page])))
    }
    write(root, '报告: 2025/Q1?')
    writeFileSync(join(root, '报告 2025 Q1.pptx'), Buffer.from('OTHER'))
    const named = await exportIncrementalPptx(root)
    expect(named).toBe(join(root, '报告 2025 Q1-2.pptx'))
    expect(readFileSync(join(root, '报告 2025 Q1.pptx')).toString()).toBe('OTHER')
    expect(isArtifactCardPath(named!)).toBe(true)
    expect(isSessionScratchPath(join(root, 'data', 'deck.pptx'))).toBe(true)
    expect(existsSync(join(root, 'data', 'deck.pptx'))).toBe(false)
    writeFileSync(named!, Buffer.from('KEEP'))
    const moved = await exportIncrementalPptx(root, { workingDirectory: wd })
    expect(moved).toBe(join(wd, '报告 2025 Q1.pptx'))
    expect(readFileSync(moved!).toString()).toBe('KEEP')
    expect(existsSync(named!)).toBe(false)
    expect(isArtifactCardPath(moved!)).toBe(true)
    const boxed = join(workspace, 'sessions', 'boxed')
    write(boxed, '往返')
    expect(await exportIncrementalPptx(boxed, { workingDirectory: join(boxed, 'data') })).toBe(join(boxed, '往返.pptx'))
    const outside = session()
    const victim = join(outside, '重要.pptx')
    writeFileSync(victim, 'KEEP')
    write(root, '报告: 2025/Q1?')
    writeFileSync(join(root, 'data', 'ppt-output.json'), JSON.stringify({ path: victim, stamp: 'nope' }))
    const safe = await exportIncrementalPptx(root)
    expect(safe?.startsWith(root)).toBe(true)
    expect(readFileSync(victim).toString()).toBe('KEEP')
    rmSync(outside, { recursive: true, force: true })
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(wd, { recursive: true, force: true })
  }
})

test('slide images advance the watcher stamp and publish check text', async () => {
  const root = session()
  try {
    deck(root, 2)
    writeFileSync(join(root, 'data', 'deck.json'), JSON.stringify({
      title: '简报',
      canvas: { width: 960, height: 540 },
      theme: { colors: { paper: '#F4F1EA', ink: '#1A1A1A', accent: '#1D4ED8', signal: '#B45309' } },
      pages: [
        { id: 'p1', name: '封面' },
        { id: 'p2', name: '图例离页边仅 6px' },
      ],
    }))
    const deckStat = statSync(join(root, 'data', 'deck.json'))
    const deckOnly = `${deckStat.mtimeMs}:${deckStat.size}`
    const before = pptDeckStamp(root)
    writeFileSync(join(root, 'data', 'slides', 'slide-01.png'), Buffer.from('png-a'))
    const withImage = pptDeckStamp(root)
    expect(withImage).not.toBe(before)
    expect(withImage.startsWith(`${deckOnly}#`)).toBe(true)
    const first = readPptProgress(root, true, {
      check: () => [{ pageId: 'p2', code: 'out_of_bounds', message: `图例离页边仅 6px\n请留白\u0000，${'原因'.repeat(40)}` }],
    })
    expect(first?.aspect).toBe('16:9')
    expect(first?.palette).toEqual({ paper: '#F4F1EA', ink: '#1A1A1A', accent: '#1D4ED8', signal: '#B45309' })
    expect(first?.pages?.[0]?.imageName).toBe('data/slides/slide-01.png')
    expect(first?.pages?.[0]?.imageStamp).toContain(':')
    expect(first?.pages?.[1]?.imageName).toBeUndefined()
    expect(first?.pages?.[1]?.status).toBe('fixing')
    expect(first?.pages?.[1]?.failed).toBe(true)
    expect(first?.pages?.[1]?.issue?.includes('\n')).toBe(false)
    expect(first?.pages?.[1]?.issue?.includes('\u0000')).toBe(false)
    expect(first?.pages?.[1]?.issue?.startsWith('图例离页边仅 6px 请留白')).toBe(true)
    expect(first?.pages?.[1]?.issue?.endsWith('…')).toBe(true)
    expect(first?.pages?.[1]?.issue?.length).toBe(80)
    await new Promise(resolve => setTimeout(resolve, 30))
    writeFileSync(join(root, 'data', 'slides', 'slide-01.png'), Buffer.from('png-ab'))
    const rewritten = readPptProgress(root, true, { check: () => [] })
    expect(rewritten?.pages?.[0]?.imageStamp).not.toBe(first?.pages?.[0]?.imageStamp)
    expect(pptDeckStamp(root)).not.toBe(withImage)
    let runs = 0
    const watch = watchPptDeck(root, () => { runs += 1 }, 30)
    try {
      await new Promise(resolve => setTimeout(resolve, 70))
      expect(runs).toBe(0)
      writeFileSync(join(root, 'data', 'slides', 'slide-02.png'), Buffer.from('png-b'))
      const started = Date.now()
      while (runs < 1 && Date.now() - started < 1000) await new Promise(resolve => setTimeout(resolve, 20))
      expect(runs).toBeGreaterThanOrEqual(1)
    } finally { watch.stop() }
    writePptRun(root, { action: 'recolor', themeId: 'ink' })
    markPptGenerating(root, true)
    expect(readPptRun(root)?.action).toBe('recolor')
    expect(readPptProgress(root, true, { check: () => [] })?.run).toEqual({ action: 'recolor', themeId: 'ink' })
    expect(readPptProgress(root, true)?.themeId).toBe('ink')
    writePptRun(root, { action: 'generate', templateId: 'paper' })
    expect(readPptProgress(root, true)?.templateId).toBe('paper')
    expect(readPptProgress(root, true)?.themeId).toBe('ink')
    markPptGenerating(root, false)
    expect(readPptRun(root)).toBeUndefined()
    const finished = readPptProgress(root, false, {
      check: () => [{ pageId: 'p2', code: 'contrast', message: '图例离页边仅 6px' }],
    })
    expect(finished?.run).toBeUndefined()
    expect(finished?.generating).toBe(false)
    expect(finished?.templateId).toBe('paper')
    expect(finished?.themeId).toBe('ink')
    expect(finished?.pages?.[1]?.status).toBe('needs_revision')
    expect(finished?.pages?.[1]?.failed).toBeUndefined()
    expect(finished?.pages?.[1]?.issue).toBe('图例离页边仅 6px')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('watchPptDeck notices a page write and exports it without a tool event', async () => {
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
    const slides = (file: string) => Object.keys(unzipSync(readFileSync(file))).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    let chain = Promise.resolve()
    let runs = 0
    const watch = watchPptDeck(root, () => {
      runs++
      chain = chain.catch(() => {}).then(() => exportIncrementalPptx(root)).then(() => undefined)
    }, 50)
    try {
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(runs).toBe(0)
      write(1)
      const started = Date.now()
      let file = ''
      while (Date.now() - started < 4000) {
        await chain
        const found = readPptProgress(root, true)?.pptxPath
        if (found && existsSync(found) && slides(found).length === 1) { file = found; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(file).not.toBe('')
      const firstLatency = Date.now() - started
      const again = Date.now()
      write(2)
      let grew = false
      while (Date.now() - again < 4000) {
        await chain
        if (slides(file).length === 2) { grew = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const nextLatency = Date.now() - again
      console.log(`PPT_DECK_EXPORT_MS first=${firstLatency} next=${nextLatency}`)
      expect(grew).toBe(true)
      expect(nextLatency).toBeLessThan(2000)
      expect(runs).toBeGreaterThanOrEqual(2)
      watch.stop()
      const stopped = runs
      write(3)
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(runs).toBe(stopped)
      expect(slides(file).length).toBe(2)
    } finally { watch.stop() }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed revision preserves the last checked PPTX and overrides stale passing diagnostics', async () => {
  const root = session()
  try {
    const { fixtureTheme, makeDeck, makePage, text } = await import('../../../../apps/electron/resources/skills/ppt-design/styles/kit.ts')
    const { ensurePptChecks } = await import('./ppt-live')
    mkdirSync(join(root, 'data'), { recursive: true })
    const deck = makeDeck('检查门', fixtureTheme, [makePage('p1', 'free', '标题', '$paper', [text('title', '有效标题', 48, 40, 400, 48, 24)], '')])
    const path = join(root, 'data/deck.json')
    deck.pages[0]!.elements[0]!.bounds.x = -100
    writeFileSync(path, JSON.stringify(deck))
    expect(await exportIncrementalPptx(root)).toBeUndefined()
    expect(existsSync(join(root, '检查门.pptx'))).toBe(false)
    deck.pages[0]!.elements[0]!.bounds.x = 48
    writeFileSync(path, JSON.stringify(deck))
    const output = await exportIncrementalPptx(root)
    expect(output).toBeTruthy()
    const bytes = readFileSync(output!)
    deck.pages[0]!.elements[0]!.bounds.x = -100
    writeFileSync(path, JSON.stringify(deck))
    writeFileSync(join(root, 'data/deck-check.json'), JSON.stringify({ issues: [] }))
    expect(await exportIncrementalPptx(root)).toBe(output)
    expect(readFileSync(output!)).toEqual(bytes)
    await ensurePptChecks(root)
    const progress = readPptProgress(root, false)
    expect(progress?.pages?.[0]?.status).toBe('needs_revision')
    expect(progress?.pages?.[0]?.failed).toBe(true)
    deck.pages[0]!.elements[0]!.bounds.x = 48
    deck.pages[0]!.elements[0]!.text = '修订后标题'
    writeFileSync(path, JSON.stringify(deck))
    expect(await exportIncrementalPptx(root)).toBe(output)
    expect(readFileSync(output!)).not.toEqual(bytes)
    expect(readPptProgress(root, false)?.pages?.[0]?.status).toBe('passed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('page diagnostics preserve actionable element targets and bound the UI payload', () => {
  const root = session()
  try {
    deck(root, 3)
    const progress = readPptProgress(root, false, { check: () => Array.from({ length: 55 }, (_, i) => ({ pageId: 'p2', elementId: `text-${i}`, code: 'overflow', message: 'Text outside canvas' })) })
    const page = progress!.pages![1]!
    expect(page.issueCount).toBe(55)
    expect(page.issues).toHaveLength(50)
    expect(page.issues![0]).toEqual({ code: 'overflow', elementId: 'text-0', message: 'Text outside canvas' })
    expect(progress!.pages![0]!.issues ?? []).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
