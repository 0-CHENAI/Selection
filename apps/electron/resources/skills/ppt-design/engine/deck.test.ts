import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDeck } from './check.ts'
import { exportDeck } from './export-pptx.ts'
import { parseDeckDocument, parseDeckSource } from './schema.ts'
import { captureSlides } from './screenshot.ts'
import { chart, fixtureTheme, makeDeck, makePage, panel, text } from '../styles/kit.ts'
import type { Deck, DeckElement } from './types.ts'

const root = new URL('..', import.meta.url)

function read(relative: string): string {
  return readFileSync(new URL(relative, root), 'utf8')
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function unzipList(file: string): Promise<string> {
  const proc = Bun.spawn(['unzip', '-l', file], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(await new Response(proc.stderr).text())
  return text
}

async function unzipEntry(file: string, entry: string): Promise<string> {
  const proc = Bun.spawn(['unzip', '-p', file, entry], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(await new Response(proc.stderr).text())
  return text
}

function problemDeck(): Deck {
  const crowded: DeckElement[] = [
    panel('off', -20, 0, 10, 10, '$ink'),
    text('cap', '，，，，', 48, 40, 32, 24, 16),
    text('orphan', '甲乙丙丁戊', 200, 40, 64, 48, 16),
    text('lit', '说明\\n没有换行', 400, 40, 420, 40, 16),
    text('wash', '看不清', 48, 140, 200, 40, 16, { color: '#FFFFFF' }),
    text('over-a', '甲乙丙', 48, 220, 180, 40, 16),
    text('over-b', '重叠内容', 80, 230, 180, 40, 16),
  ]
  return makeDeck('问题一次报完', fixtureTheme, [
    makePage('p1', 'scorecard', '问题', '$paper', crowded, ''),
    makePage('p2', 'waterfall', '桥', '$paper', [
      chart('bridge', 48, 120, 500, 280, {
        kind: 'waterfall',
        categories: ['起点', '变化', '终点'],
        series: [{ name: '桥', values: [22, -3, 10] }],
      }),
    ], ''),
    makePage('p3', 'waterfall', '重复', '$paper', [
      text('cn', '中文', 48, 48, 200, 40, 18, { family: '$latin' }),
    ], ''),
  ])
}

describe('selection-deck schema', () => {
  it('rejects unknown fields, a wrong canvas, and a missing textCapacity in one pass', () => {
    const source = JSON.parse(JSON.stringify(makeDeck('schema', fixtureTheme, [
      makePage('p1', 'cover', '封面', '$paper', [
        text('hello', '你好', 48, 48, 200, 40, 18),
      ], ''),
    ]))) as Record<string, unknown>
    source.canvas = { width: 100, height: 100 }
    source.extra = true
    const page = (source.pages as Array<Record<string, unknown>>)[0]!
    const elements = page.elements as Array<Record<string, unknown>>
    const textElement = elements.find(item => item.type === 'text')
    delete textElement!.textCapacity
    const parsed = parseDeckDocument(source)
    expect(parsed.deck).toBeNull()
    expect(parsed.issues.length).toBeGreaterThanOrEqual(3)
    expect(parsed.issues.map(item => item.message).join('\n')).toContain('960×540')
    expect(parsed.issues.map(item => item.message).join('\n')).toContain('extra')
    expect(parsed.issues.map(item => item.message).join('\n')).toContain('textCapacity')
  })

  it('reads a YAML deck', () => {
    const parsed = parseDeckSource(`
format: selection-deck
version: 1
title: YAML 往返
canvas:
  width: 960
  height: 540
theme:
  id: yaml
  name: YAML
  margin: 48
  source: test
  colors:
    ink: "#111111"
    paper: "#FFFFFF"
    muted: "#555555"
    accent: "#C41628"
    line: "#CCCCCC"
    surface: "#EEEEEE"
    inverse: "#FFFFFF"
  fonts:
    cjk: {mac: PingFang SC, win: Microsoft YaHei, linux: Noto Sans CJK SC}
    latin: {mac: Arial, win: Arial, linux: Noto Sans}
  type:
    display: {min: 44, max: 80}
    title: {min: 28, max: 36}
    body: {min: 16, max: 22}
    caption: {min: 11, max: 14}
pages:
  - id: p1
    layout: cover
    background: $paper
    elements:
      - id: hello
        type: text
        bounds: {x: 48, y: 48, w: 400, h: 40}
        text: 你好
        textCapacity: {maxChars: 8, maxLines: 1}
        font: {family: $cjk, size: 18}
`)
    expect(parsed.issues).toEqual([])
    expect(parsed.deck?.title).toBe('YAML 往返')
    expect(parsed.deck?.pages[0]?.elements[0]?.text).toBe('你好')
  })
})

describe('deck_check', () => {
  it('reports every problem in one pass, located to a page and element', () => {
    const issues = checkDeck(problemDeck())
    const codes = new Set(issues.map(item => item.code))
    for (const code of ['out_of_bounds', 'over_capacity', 'contrast', 'orphan', 'literal_newline', 'overlap', 'unreconciled', 'adjacent_layout', 'font']) {
      expect(codes.has(code as never)).toBe(true)
    }
    expect(issues.find(item => item.code === 'out_of_bounds')?.elementId).toBe('off')
    expect(issues.find(item => item.code === 'literal_newline')?.elementId).toBe('lit')
    expect(issues.find(item => item.code === 'contrast')?.pageId).toBe('p1')
    expect(issues.find(item => item.code === 'unreconciled')?.elementId).toBe('bridge')
    expect(issues.find(item => item.code === 'font')?.pageId).toBe('p3')
    expect(issues.find(item => item.code === 'adjacent_layout')?.pageId).toBe('p3')
  })
})

describe('pptx export', () => {
  it('writes editable text, a native chart, and an image', async () => {
    const dir = tempDir('sel-deck-export-')
    const png = join(dir, 'pixel.png')
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    const deck = makeDeck('导出', fixtureTheme, [
      makePage('only', 'trend', '导出', '$paper', [
        text('title', '可编辑标题', 48, 40, 400, 40, 24, { bold: true }),
        chart('bars', 48, 120, 480, 280, {
          kind: 'column',
          categories: ['甲', '乙'],
          series: [{ name: '数量', values: [2, 5] }],
          colors: ['$accent'],
        }),
        { id: 'pic', type: 'image', role: 'content', bounds: { x: 620, y: 120, w: 80, h: 80 }, src: png, alt: '一个像素' },
      ], '备注'),
    ])
    const out = join(dir, 'out.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    expect(result.pptx).toBe(realpathSync(out))
    const listing = await unzipList(out)
    expect(listing).toContain('ppt/charts/chart1.xml')
    expect(listing).toMatch(/ppt\/media\//)
    const slide = await unzipEntry(out, 'ppt/slides/slide1.xml')
    expect(slide).toContain('可编辑标题')
    expect(slide).toContain('typeface="Noto Sans CJK SC"')
    const chartXml = await unzipEntry(out, 'ppt/charts/chart1.xml')
    expect(chartXml).toContain('barChart')
    const presentation = await unzipEntry(out, 'ppt/presentation.xml')
    expect(presentation).toContain('cx="12192000" cy="6858000"')
  })

  it('refuses a failing deck without replacing the output file', async () => {
    const dir = tempDir('sel-deck-refuse-')
    const out = join(dir, 'out.pptx')
    writeFileSync(out, 'sentinel')
    const result = await exportDeck(problemDeck(), out)
    expect(result.status).toBe('needs_revision')
    expect(result.pptx).toBeUndefined()
    expect(result.issues.length).toBeGreaterThan(0)
    expect(readFileSync(out, 'utf8')).toBe('sentinel')
  })

  it('returns the real path when the output directory is a symlink', async () => {
    const real = tempDir('sel-deck-real-')
    const linkParent = tempDir('sel-deck-link-')
    const link = join(linkParent, 'via')
    symlinkSync(real, link)
    const raw = mkdtempSync(join(tmpdir(), 'sel-deck-raw-'))
    const throughLink = join(link, 'out.pptx')
    const throughRaw = join(raw, 'out.pptx')
    const deck = makeDeck('路径', fixtureTheme, [
      makePage('only', 'closing', '路径', '$paper', [
        text('title', '路径', 48, 48, 200, 40, 24, { bold: true }),
      ], ''),
    ])
    const linked = await exportDeck(deck, throughLink, { platform: 'linux' })
    const direct = await exportDeck(deck, throughRaw, { platform: 'linux' })
    expect(linked.pptx).toBe(realpathSync(throughLink))
    expect(linked.pptx?.startsWith(realpathSync(real))).toBe(true)
    expect(direct.pptx).toBe(realpathSync(throughRaw))
  })

  it('does not throw when no screenshot renderer is installed', async () => {
    const dir = tempDir('sel-deck-shot-')
    const result = await captureSlides(join(dir, 'missing.pptx'), join(dir, 'png'), 1, {
      officecli: '',
      libreoffice: '/nonexistent/soffice',
      pdftoppm: '/nonexistent/pdftoppm',
    })
    expect(result.available).toBe(false)
    expect(result.files).toEqual([])
  })

  it('writes a diagonal leader and separate Latin and CJK faces', async () => {
    const dir = tempDir('sel-deck-line-')
    const deck = makeDeck('斜线', fixtureTheme, [
      makePage('only', 'leader', '斜线', '$paper', [
        {
          id: 'title',
          type: 'text',
          role: 'content',
          bounds: { x: 48, y: 40, w: 320, h: 48 },
          text: '标题',
          textCapacity: { maxChars: 2, maxLines: 1 },
          font: {
            family: '$cjk',
            size: 28,
            weight: 'bold',
            color: '$ink',
            face: {
              latin: 'Georgia',
              cjk: { mac: 'Songti SC', win: 'SimSun', linux: 'Noto Serif CJK SC' },
            },
          },
        },
        {
          id: 'diag',
          type: 'shape',
          shape: 'line',
          role: 'rule',
          bounds: { x: 120, y: 180, w: 90, h: 36 },
          line: { color: '$ink', width: 1.5, points: { x1: 0, y1: 36, x2: 90, y2: 0 } },
          arrow: 'end',
        },
      ], ''),
    ])
    const out = join(dir, 'line.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    const slide = await unzipEntry(out, 'ppt/slides/slide1.xml')
    expect(slide).toContain('typeface="Georgia"')
    expect(slide).toContain('typeface="Noto Serif CJK SC"')
    expect(slide).toMatch(/rot="-?\d+"/)
  })

  it('writes a round-rect radius as an absolute length', async () => {
    const dir = tempDir('sel-deck-radius-')
    const deck = makeDeck('圆角', fixtureTheme, [
      makePage('only', 'card', '圆角', '$paper', [
        {
          id: 'card',
          type: 'shape',
          shape: 'roundRect',
          role: 'panel',
          bounds: { x: 48, y: 48, w: 200, h: 100 },
          fill: '$accent',
          radius: 28,
        },
      ], ''),
    ])
    const out = join(dir, 'radius.pptx')
    const result = await exportDeck(deck, out, { platform: 'linux' })
    expect(result.status).toBe('ok')
    const slide = await unzipEntry(out, 'ppt/slides/slide1.xml')
    const adj = slide.match(/name="adj" fmla="val (\d+)"/)
    expect(adj).not.toBeNull()
    expect(Math.abs(Number(adj?.[1]) - Math.round(28 / 100 * 100000))).toBeLessThan(2)
  })
})

describe('reference styles', () => {
  const ids = ['dsh-cartesian', 'dsh-course-workshop', 'dsh-editorial-notebook', 'dsh-engineering-blueprint', 'dsh-soft-editorial']
  const sourceOrphans: Record<string, string[]> = {
    'dsh-course-workshop/deck.json': ['03:t7'],
    'dsh-engineering-blueprint/deck.json': ['03:t101'],
  }

  it('ships five bilingual 12-page DSH decks', async () => {
    const catalog = JSON.parse(read('styles/catalog.json')) as Record<string, { deck: string; deckEn: string; license: string }>
    expect(Object.keys(catalog)).toEqual(ids)
    const accents = new Set<string>()
    for (const id of ids) {
      for (const file of [`styles/${id}/deck.json`, `styles/${id}/deck.en.json`]) {
        const parsed = parseDeckSource(read(file))
        expect(parsed.issues).toEqual([])
        const deck = parsed.deck!
        expect(deck.pages).toHaveLength(12)
        expect(deck.canvas).toEqual({ width: 960, height: 540 })
        expect(deck.theme.id).toBe(id)
        accents.add(deck.theme.colors.accent)
        const issues = checkDeck(deck)
        const expected = sourceOrphans[file.replace('styles/', '')] ?? []
        expect(issues.map(item => `${item.pageId}:${item.elementId}`)).toEqual(expected)
        expect(issues.every(item => item.code === 'orphan')).toBe(true)
      }
      const design = read(`styles/${id}/design.md`)
      expect(design).toContain('960')
      expect(design).toContain('DSH Desktop')
    }
    expect(accents.size).toBeGreaterThan(1)
    const dir = tempDir('sel-deck-ref-')
    const blueprint = parseDeckSource(read('styles/dsh-engineering-blueprint/deck.json')).deck!
    const exported = await exportDeck(blueprint, join(dir, 'blueprint.pptx'), { platform: 'linux', enforceCheck: false })
    expect(exported.status).toBe('ok')
    const listing = await unzipList(exported.pptx!)
    const slides = listing.match(/ppt\/slides\/slide\d+\.xml/g) ?? []
    expect(new Set(slides).size).toBe(12)
    const cover = await unzipEntry(exported.pptx!, 'ppt/slides/slide1.xml')
    expect(cover).toContain('工程蓝图')
    expect(cover).toContain('typeface="Noto Sans CJK SC"')
    const editorial = parseDeckSource(read('styles/dsh-soft-editorial/deck.json')).deck!
    const serif = await exportDeck(editorial, join(dir, 'editorial.pptx'), { platform: 'linux' })
    expect(serif.status).toBe('ok')
    const editorialCover = await unzipEntry(serif.pptx!, 'ppt/slides/slide1.xml')
    expect(editorialCover).toContain('typeface="Georgia"')
    expect(editorialCover).toContain('typeface="Noto Serif CJK SC"')
  })
})

describe('skill instructions', () => {
  it('points at the deck engine and keeps the OfficeCLI morph override', () => {
    const skill = read('SKILL.md')
    expect(skill).toContain('deck-cli.mjs')
    expect(skill).toContain('dsh-cartesian')
    expect(skill).toContain('dsh-engineering-blueprint')
    expect(skill).not.toContain('compose.ts')
    expect(skill).not.toContain('dark-tech')
    expect(skill).not.toContain('swiss-signal')
    const office = readFileSync(new URL('../../officecli/SKILL.md', import.meta.url), 'utf8')
    expect(office).toContain('officecli-morph-helper')
    expect(office).toContain('morph-helpers.py')
    expect(office).toContain('morph-helpers.sh')
    expect(office).toContain('deck-cli.mjs')
    expect(office).toContain('python-pptx')
    const override = readFileSync(new URL('../../officecli/ppt-selection-override.md', import.meta.url), 'utf8')
    expect(override).toContain('dsh-cartesian')
    expect(override).toContain('960×540')
    expect(override).not.toContain('fresh-editorial')
    expect(override).not.toContain('swiss-signal')
  })

  it('checks a reference deck through the bundled cli', async () => {
    const cli = fileURLToPath(new URL('./deck-cli.mjs', import.meta.url))
    const deck = fileURLToPath(new URL('../styles/dsh-cartesian/deck.json', import.meta.url))
    const proc = Bun.spawn([process.execPath, cli, 'check', deck], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) throw new Error(await new Response(proc.stderr).text() || stdout)
    expect(JSON.parse(stdout).status).toBe('ok')
  })
})
