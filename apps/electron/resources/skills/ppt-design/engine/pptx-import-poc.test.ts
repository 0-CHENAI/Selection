import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { resolveOfficecliBinary } from '../../../../../../packages/shared/src/utils/officecli.ts'
import { fixtureTheme, makeDeck, makePage, text } from '../styles/kit.ts'
import { checkDeck } from './check.ts'
import { exportDeck } from './export-pptx.ts'
import { IMPORT_USER_MESSAGES, importSimplePptx } from './pptx-import-poc.ts'
import { colorRef, parseDeckDocument, parseDeckSource } from './schema.ts'
import { DECK_V2_DRAFT_FIELDS, DECK_VERSION_DRAFT, downgradeDraft, liftImageSlots, parseImageContract } from './schema-v2-draft.ts'
import { DECK_VERSION } from './types.ts'

const OFFICECLI_ENV = { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const IMAGE_CONTRACT = {
  schema: 'dsh.template-images/v1',
  layoutId: 'cover',
  pageRole: '封面',
  style: {
    medium: '摄影',
    palette: '纸色与暗红',
    lighting: '均匀',
    tone: '克制',
    textTreatment: '无文字',
    continuity: '同一场景',
  },
  slots: [{
    elementId: 'hero',
    role: '主图',
    contentSources: ['title-el'],
    sourcePolicy: 'contextual-scene',
    subject: '厂房外景',
    composition: '留白居中',
    aspectRatio: '16:9',
    reuseGroup: 'site',
    maskElementIds: [] as string[],
  }],
}

function emu(points: number): number {
  return Math.round(points * 12700)
}

function pack(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, value] of Object.entries(files)) entries[name] = typeof value === 'string' ? strToU8(value) : value
  return zipSync(entries)
}

function presentation(slideRels: string[]): string {
  const ids = slideRels.map((id, index) => `<p:sldId id="${256 + index}" r:id="${id}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${emu(960)}" cy="${emu(540)}"/>
</p:presentation>`
}

function rels(items: Array<{ id: string; type: string; target: string }>): string {
  const body = items.map(item => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="导入证明">
  <a:themeElements>
    <a:clrScheme name="导入证明">
      <a:dk1><a:srgbClr val="111111"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="5C5A55"/></a:dk2>
      <a:lt2><a:srgbClr val="F5F3EE"/></a:lt2>
      <a:accent1><a:srgbClr val="C41628"/></a:accent1>
    </a:clrScheme>
    <a:fontScheme name="导入证明">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:font script="Hans" typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`
}

function slide(body: string, background = 'FFFFFF'): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="封面">
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${body}
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function textBox(name: string, value: string, x: number, y: number, w: number, h: number, placeholder = false): string {
  const ph = placeholder ? '<p:nvPr><p:ph type="title"/></p:nvPr>' : '<p:nvPr/>'
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/>${ph}</p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${placeholder ? '<a:effectLst/>' : ''}</p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2400" b="1"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${value}</a:t></a:r></a:p></p:txBody>
  </p:sp>`
}

function rect(name: string, x: number, y: number, w: number, h: number, fill: string): string {
  const color = /^[0-9A-Fa-f]{6}$/.test(fill) ? `<a:srgbClr val="${fill}"/>` : `<a:schemeClr val="${fill}"/>`
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="3" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${color}</a:solidFill></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>
  </p:sp>`
}

function picture(name: string, x: number, y: number, w: number, h: number, rel: string): string {
  return `<p:pic>
    <p:nvPicPr><p:cNvPr id="4" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${rel}"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
  </p:pic>`
}

function base(slideXml: string, extra: Record<string, string | Uint8Array> = {}, slideRels = ''): Uint8Array {
  return pack({
    'ppt/presentation.xml': presentation(['rId2']),
    'ppt/_rels/presentation.xml.rels': rels([{ id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', target: 'slides/slide1.xml' }]),
    'ppt/theme/theme1.xml': themeXml(),
    'ppt/slides/slide1.xml': slideXml,
    ...(slideRels ? { 'ppt/slides/_rels/slide1.xml.rels': slideRels } : {}),
    ...extra,
  })
}

function simplePptx(): Uint8Array {
  return base(slide(`${textBox('title-el', '经营回顾', 48, 36, 400, 54)}${rect('swatch', 48, 140, 180, 72, 'accent1')}`))
}

describe('pptx import proof', () => {
  it('imports a simple pptx into a version 1 deck and round-trips text, geometry, and theme tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppt-import-'))
    try {
      const imported = importSimplePptx(simplePptx(), { fileName: '经营回顾.pptx' })
      expect(imported.deck).not.toBeNull()
      const deck = imported.deck!
      expect(deck.version).toBe(1)
      expect(deck.format).toBe('selection-deck')
      expect(deck.title).toBe('经营回顾')
      expect(deck.canvas).toEqual({ width: 960, height: 540 })
      expect(deck.theme.colors.accent).toBe('#C41628')
      expect(checkDeck(deck)).toEqual([])
      const title = deck.pages[0]?.elements.find(item => item.id === 'title-el')
      const swatch = deck.pages[0]?.elements.find(item => item.id === 'swatch')
      expect(title?.text).toBe('经营回顾')
      expect(title?.font?.color).toBe('$ink')
      expect(title?.font?.weight).toBe('bold')
      expect(title?.bounds).toEqual({ x: 48, y: 36, w: 400, h: 54 })
      expect(swatch?.fill).toBe('$accent')
      expect(swatch?.bounds).toEqual({ x: 48, y: 140, w: 180, h: 72 })
      expect(imported.diagnostics.map(item => item.feature)).toContain('theme-font')
      expect(imported.diagnostics.map(item => item.feature)).not.toContain('direct-color')

      deck.theme.colors.ink = '#0033AA'
      deck.theme.colors.accent = '#00AA88'
      const out = join(dir, 'round.pptx')
      const exported = await exportDeck(deck, out, { enforceCheck: true, platform: 'linux' })
      expect(exported.status).toBe('ok')
      const xml = new TextDecoder().decode(unzipSync(readFileSync(out))['ppt/slides/slide1.xml']!)
      expect(xml).toContain('name="title-el"')
      expect(xml).toContain('经营回顾')
      expect(xml).toContain('0033AA')
      expect(xml).toContain('00AA88')

      const again = importSimplePptx(readFileSync(out), { fileName: '经营回顾.pptx' })
      const againTitle = again.deck?.pages[0]?.elements.find(item => item.id === 'title-el')
      const againSwatch = again.deck?.pages[0]?.elements.find(item => item.id === 'swatch')
      expect(againTitle?.text).toBe('经营回顾')
      expect(againTitle?.font?.size).toBe(24)
      expect(againTitle?.bounds.x).toBeCloseTo(48, 0)
      expect(againTitle?.bounds.y).toBeCloseTo(36, 0)
      expect(colorRef(againTitle?.font?.color, again.deck!.theme, '$ink')).toBe('#0033AA')
      expect(colorRef(againSwatch?.fill, again.deck!.theme, '$accent')).toBe('#00AA88')

      const binary = resolveOfficecliBinary()
      if (!binary) {
        if (process.env.OFFICECLI_INTEGRATION === '1') throw new Error('officecli binary missing')
        return
      }
      const proc = Bun.spawn([binary, 'get', out, '/slide[1]/shape[@name=title-el]', '--json'], { env: OFFICECLI_ENV, stdout: 'pipe', stderr: 'pipe' })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const code = await proc.exited
      if (code !== 0) throw new Error(stderr || stdout)
      const named = JSON.parse(stdout) as { data: { results: Array<{ text?: string; format?: { name?: string } }> } }
      expect(named.data.results[0]?.format?.name).toBe('title-el')
      expect(named.data.results[0]?.text).toBe('经营回顾')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('classifies master text, grouped tables, and chart or emf pictures without writing them into the deck', () => {
    const master = importSimplePptx(base(
      slide(textBox('title-el', '经营回顾', 48, 36, 400, 54, true)),
      {},
      rels([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }]),
    ), { fileName: 'master.pptx' })
    expect(master.deck?.pages[0]?.elements.some(item => item.text === '经营回顾')).toBe(true)
    expect(master.deck?.pages[0]?.layout).toBe('free')
    expect(master.diagnostics.map(item => item.feature)).toEqual(expect.arrayContaining(['placeholder', 'layout-inheritance', 'theme-font', 'effects']))
    expect(JSON.stringify(master.deck)).not.toContain('layoutRef')

    const grouped = importSimplePptx(base(slide(`
      <p:grpSp>
        <p:nvGrpSpPr><p:cNvPr id="5" name="组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="${emu(48)}" y="${emu(48)}"/><a:ext cx="${emu(200)}" cy="${emu(80)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(200)}" cy="${emu(80)}"/></a:xfrm></p:grpSpPr>
        ${textBox('inner', '组内标题', 48, 48, 180, 40)}
      </p:grpSp>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="6" name="表格"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="${emu(48)}" y="${emu(160)}"/><a:ext cx="${emu(400)}" cy="${emu(120)}"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl/></a:graphicData></a:graphic>
      </p:graphicFrame>
    `)), { fileName: 'group.pptx' })
    expect(grouped.deck?.pages[0]?.elements ?? []).toEqual([])
    expect(grouped.diagnostics.find(item => item.feature === 'group')?.message).toBe(IMPORT_USER_MESSAGES.group)
    expect(grouped.diagnostics.find(item => item.feature === 'table')?.message).toBe(IMPORT_USER_MESSAGES.table)
    expect(JSON.stringify(grouped.deck)).not.toContain('组内标题')

    const chart = importSimplePptx(base(slide(`
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="7" name="图表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="${emu(48)}" y="${emu(48)}"/><a:ext cx="${emu(400)}" cy="${emu(240)}"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphicData></a:graphic>
      </p:graphicFrame>
      ${picture('emf-pic', 500, 48, 120, 80, 'rId8')}
    `), {
      'ppt/media/image1.emf': strToU8('not-a-real-emf'),
    }, rels([{ id: 'rId8', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/image1.emf' }])), { fileName: 'chart.pptx' })
    expect(chart.deck?.pages[0]?.elements ?? []).toEqual([])
    expect(chart.diagnostics.find(item => item.feature === 'chart')?.level).toBe('retained')
    expect(chart.diagnostics.find(item => item.feature === 'emf')?.message).toBe(IMPORT_USER_MESSAGES.emf)
    expect(chart.diagnostics.find(item => item.feature === 'smartart')).toBeUndefined()
  })

  it('keeps a dsh image-slot contract in notes and lifts it only in the version 2 draft', () => {
    const notes = JSON.stringify(IMAGE_CONTRACT)
    const bytes = base(slide(`${textBox('title-el', '经营回顾', 48, 36, 400, 54)}${picture('hero', 500, 140, 200, 112, 'rId9')}`), {
      'ppt/media/image1.png': PNG,
      'ppt/notesSlides/notesSlide1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="备注"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${notes}</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:notes>`,
    }, rels([
      { id: 'rId9', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/image1.png' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide', target: '../notesSlides/notesSlide1.xml' },
    ]))
    const dir = mkdtempSync(join(tmpdir(), 'ppt-slot-'))
    try {
      const imported = importSimplePptx(bytes, { fileName: 'slots.pptx', assetDir: dir })
      expect(imported.deck?.pages[0]?.notes).toBe(notes)
      expect(imported.deck?.pages[0]?.elements.some(item => item.id === 'hero' && item.type === 'image')).toBe(true)
      expect(imported.diagnostics.find(item => item.feature === 'image-slots')?.level).toBe('faithful')
      expect(JSON.stringify(imported.deck)).not.toContain('imageSlots')
      const rejected = parseDeckDocument({ ...imported.deck, pages: [{ ...imported.deck!.pages[0], imageSlots: IMAGE_CONTRACT }] })
      expect(rejected.deck).toBeNull()
      const draft = liftImageSlots(imported.deck!)
      expect(draft.version).toBe(DECK_VERSION_DRAFT)
      expect(draft.pages[0]?.imageSlots?.slots[0]?.elementId).toBe('hero')
      expect(draft.pages[0]?.notes).toBe(notes)
      const down = downgradeDraft(draft)
      expect(down.ok).toBe(true)
      if (down.ok) {
        expect(down.deck.version).toBe(DECK_VERSION)
        expect(parseDeckDocument(down.deck).issues).toEqual([])
        expect(JSON.stringify(down.deck)).not.toContain('imageSlots')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves shipped decks on version 1 and does not touch template files', () => {
    const templatePath = join(import.meta.dir, '../styles/dsh-cartesian/deck.json')
    const before = createHash('sha256').update(readFileSync(templatePath)).digest('hex')
    const stamp = statSync(templatePath).mtimeMs
    const parsed = parseDeckSource(readFileSync(templatePath, 'utf8'))
    expect(parsed.issues).toEqual([])
    expect(parsed.deck?.version).toBe(DECK_VERSION)
    expect(DECK_VERSION).toBe(1)
    expect(DECK_VERSION_DRAFT).toBe(2)
    importSimplePptx(simplePptx(), { fileName: '经营回顾.pptx' })
    expect(createHash('sha256').update(readFileSync(templatePath)).digest('hex')).toBe(before)
    expect(statSync(templatePath).mtimeMs).toBe(stamp)
    const skill = readFileSync(join(import.meta.dir, '../SKILL.md'), 'utf8')
    const office = readFileSync(join(import.meta.dir, '../../officecli/SKILL.md'), 'utf8')
    const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
    const schema = readFileSync(join(import.meta.dir, 'schema.ts'), 'utf8')
    for (const source of [skill, office, index, schema]) {
      expect(source).not.toContain('importSimplePptx')
      expect(source).not.toContain('pptx-import-poc')
      expect(source).not.toContain('pptd_')
    }
  })

  it('downgrades a clean draft and refuses to drop crop, source, or a slot that is not in the notes', () => {
    const deck = makeDeck('草案', fixtureTheme, [makePage('p1', 'free', '页', '$paper', [text('hello', '你好', 48, 48, 200, 40, 18)], '')])
    const clean = liftImageSlots(deck)
    const down = downgradeDraft(clean)
    expect(down.ok).toBe(true)
    if (down.ok) expect(parseDeckDocument(down.deck).deck?.version).toBe(1)
    const sourced = liftImageSlots(deck, { kind: 'import', fileName: 'a.pptx', sha256: 'abc' })
    expect(downgradeDraft(sourced).ok).toBe(false)
    const cropped = liftImageSlots(deck)
    cropped.pages[0]!.elements[0]!.crop = { l: 0.1, t: 0, r: 0.1, b: 0 }
    expect(downgradeDraft(cropped).ok).toBe(false)
    const orphan = liftImageSlots(deck)
    orphan.pages[0]!.imageSlots = structuredClone(IMAGE_CONTRACT) as NonNullable<typeof orphan.pages[0]['imageSlots']>
    expect(downgradeDraft(orphan).ok).toBe(false)
    const adr = readFileSync(join(import.meta.dir, '../../../../../../docs/adr/ppt-pptd-features-on-deck.md'), 'utf8')
    for (const message of Object.values(IMPORT_USER_MESSAGES)) expect(adr).toContain(message)
    expect(parseImageContract('{"schema":"dsh.template-images/v1","slots":[]}').status).toBe('invalid')
    expect(DECK_V2_DRAFT_FIELDS.element).not.toContain('customGeometry' as never)
    expect(() => importSimplePptx(strToU8('hello'))).toThrow('不是有效的 PPTX')
    expect(() => importSimplePptx(zipSync({ '../x': strToU8('a') }))).toThrow('PPTX 路径无效')
  })
})
