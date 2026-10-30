import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { IMPORT_USER_MESSAGES } from '../pptx-import-poc.ts'
import { parseDeckDocument } from '../schema.ts'
import { applyTheme } from '../theme.ts'
import { checkDeck } from '../check.ts'
import { DSH_PAGE_OBJECT_CATEGORIES, importPptx } from './pptx-to-deck.ts'
import { applySideBySideLayout, exportImportedDeck, importPptxFile } from './project.ts'
import { RENDER_PATH_UNDECIDED } from './preview-port.ts'
import { pptUploadRole } from '../../../../../../../packages/server-core/src/services/ppt-catalog.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function emu(points: number): number {
  return Math.round(points * 12700)
}

function pack(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, value] of Object.entries(files)) entries[name] = typeof value === 'string' ? strToU8(value) : value
  return zipSync(entries)
}

function rels(items: Array<{ id: string; type: string; target: string; external?: boolean }>): string {
  const body = items.map(item => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"${item.external ? ' TargetMode="External"' : ''}/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="导入">
  <a:themeElements>
    <a:clrScheme name="导入">
      <a:dk1><a:srgbClr val="111111"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="5C5A55"/></a:dk2>
      <a:lt2><a:srgbClr val="F5F3EE"/></a:lt2>
      <a:accent1><a:srgbClr val="C41628"/></a:accent1>
    </a:clrScheme>
    <a:fontScheme name="导入">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`
}

function textBox(name: string, text: string, x: number, y: number, w: number, h: number, extra = ''): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2000" b="1" dirty="0"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody>
    ${extra}
  </p:sp>`
}

function rect(name: string, x: number, y: number, w: number, h: number, fill = 'C41628'): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="3" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>
    </p:spPr>
  </p:sp>`
}

function slideXml(body: string, name = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="${name}"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    ${body}
  </p:spTree></p:cSld>
</p:sld>`
}

function presentation(count: number): string {
  const ids = Array.from({ length: count }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${emu(960)}" cy="${emu(540)}"/>
</p:presentation>`
}

function masterFiles(): Record<string, string> {
  const logo = rect('logo', 36, 18, 72, 24)
  const footer = textBox('footer', '内部资料', 48, 508, 200, 22)
  return {
    'ppt/slideMasters/slideMaster1.xml': slideXml(`${logo}${footer}`, '母版'),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([]),
    'ppt/slideLayouts/slideLayout1.xml': slideXml('', '标题版式'),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', target: '../slideMasters/slideMaster1.xml' }]),
  }
}

function deckFiles(slides: string[], extra: Record<string, string | Uint8Array> = {}, slideRels: string[] = []): Uint8Array {
  const files: Record<string, string | Uint8Array> = {
    ...masterFiles(),
    'ppt/presentation.xml': presentation(slides.length),
    'ppt/theme/theme1.xml': themeXml(),
    'ppt/_rels/presentation.xml.rels': rels([
      { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', target: 'theme/theme1.xml' },
      ...slides.map((_, index) => ({ id: `rId${index + 2}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', target: `slides/slide${index + 1}.xml` })),
    ]),
    ...extra,
  }
  slides.forEach((body, index) => {
    files[`ppt/slides/slide${index + 1}.xml`] = slideXml(body, `第${index + 1}页`)
    const extraRels = slideRels[index] ?? ''
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = rels([
      { id: 'rIdLayout', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      ...(extraRels ? [] : []),
    ])
  })
  return pack(files)
}

function withSlideRels(base: Uint8Array, slide: number, items: Array<{ id: string; type: string; target: string; external?: boolean }>): Uint8Array {
  const files = unzipSync(base)
  const key = `ppt/slides/_rels/slide${slide}.xml.rels`
  const layout = { id: 'rIdLayout', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }
  files[key] = strToU8(rels([layout, ...items]))
  return zipSync(files)
}

describe('ppt_import', () => {
  it('imports a 20-page deck, restyles page 5, and keeps the source and master decorations', async () => {
    const group = `<p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="8" name="指标组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="${emu(80)}" y="${emu(180)}"/><a:ext cx="${emu(200)}" cy="${emu(80)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(200)}" cy="${emu(80)}"/></a:xfrm></p:grpSpPr>
      ${rect('左块', 0, 0, 80, 40, '111111').replace('p:sp>', 'p:sp>')}
      ${rect('右块', 100, 0, 80, 40, '5C5A55')}
    </p:grpSp>`
    const merged = `<p:graphicFrame>
      <p:nvGraphicFramePr><p:cNvPr id="9" name="合并表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="${emu(80)}" y="${emu(180)}"/><a:ext cx="${emu(400)}" cy="${emu(80)}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
        <a:tblGrid><a:gridCol w="${emu(200)}"/><a:gridCol w="${emu(200)}"/></a:tblGrid>
        <a:tr h="${emu(40)}"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>合并</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t></a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic>
    </p:graphicFrame>`
    const plain = `<p:graphicFrame>
      <p:nvGraphicFramePr><p:cNvPr id="10" name="经营表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="${emu(80)}" y="${emu(200)}"/><a:ext cx="${emu(420)}" cy="${emu(80)}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
        <a:tblGrid><a:gridCol w="${emu(210)}"/><a:gridCol w="${emu(210)}"/></a:tblGrid>
        <a:tr h="${emu(36)}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400" b="1"/><a:t>项目</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400" b="1"/><a:t>金额</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
        <a:tr h="${emu(36)}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400"/><a:t>营收</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400"/><a:t>12</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic>
    </p:graphicFrame>`
    const slides = Array.from({ length: 20 }, (_, index) => {
      const page = index + 1
      const title = textBox('title', `第${page}页主张`, 48, 72, 420, 40)
      const body = textBox('body', '这一页只讲一件事', 48, 140, 420, 36)
      if (page === 2) return `${title}${body}${group}`
      if (page === 3) return `${title}${body}${merged}`
      if (page === 4) return `${title}${body}${plain}`
      if (page === 5) return `${title}${textBox('left', '现状说明', 48, 150, 300, 40)}${textBox('right', '目标说明', 480, 150, 300, 40)}`
      return `${title}${body}`
    })
    const bytes = deckFiles(slides)
    const dir = mkdtempSync(join(tmpdir(), 'ppt-import-'))
    const source = join(dir, '国企汇报.pptx')
    writeFileSync(source, bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const stamp = statSync(source).mtimeMs
    const template = join(import.meta.dir, '../../styles/dsh-cartesian/deck.json')
    const templateHash = createHash('sha256').update(readFileSync(template)).digest('hex')
    try {
      const imported = await importPptxFile(source, join(dir, 'project'))
      expect(imported.deck, imported.diagnostics.map(item => item.message).join('\n')).not.toBeNull()
      expect(imported.source.sha256).toBe(hash)
      expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(hash)
      expect(statSync(source).mtimeMs).toBe(stamp)
      expect(createHash('sha256').update(readFileSync(template)).digest('hex')).toBe(templateHash)
      expect(imported.preview).toEqual({ status: 'unavailable', reason: RENDER_PATH_UNDECIDED })
      const deck = imported.deck!
      expect(deck.version).toBe(2)
      expect(deck.pages).toHaveLength(20)
      expect(deck.pages.every(page => page.elements.some(element => element.id === 'm-logo' && element.role === 'decoration'))).toBe(true)
      expect(deck.pages[4]!.elements.find(element => element.id === 'title')?.text).toBe('第5页主张')
      const grouped = deck.pages[1]!.elements.filter(element => element.group?.id === '指标组')
      expect(grouped.map(element => element.id).sort()).toEqual(['右块', '左块'])
      expect(grouped.find(element => element.id === '左块')?.bounds.x).toBe(80)
      expect(deck.pages[2]!.elements.find(element => element.id === '合并表')?.retained?.feature).toBe('table-merge')
      expect(deck.pages[3]!.elements.find(element => element.id === '经营表')?.table?.rows[1]?.[0]?.text).toBe('营收')
      const before = structuredClone(deck.pages)
      deck.pages[4] = applySideBySideLayout(deck.pages[4]!, deck.canvas)
      expect(deck.pages[4]!.layout).toBe('free')
      expect(deck.pages[4]!.elements.find(element => element.id === 'm-logo')?.bounds).toEqual(before[4]!.elements.find(element => element.id === 'm-logo')?.bounds)
      expect(deck.pages[4]!.elements.find(element => element.id === 'left')?.bounds.x).not.toBe(before[4]!.elements.find(element => element.id === 'left')?.bounds.x)
      for (const index of deck.pages.keys()) {
        if (index === 4) continue
        expect(deck.pages[index]).toEqual(before[index])
      }
      expect(checkDeck(deck)).toEqual([])
      const theme = JSON.parse(readFileSync(join(import.meta.dir, '../../styles/dsh-blue-professional/deck.json'), 'utf8')).theme
      const restyled = applyTheme(deck, theme)
      expect(checkDeck(restyled)).toEqual([])
      const out = join(dir, 'out.pptx')
      const exported = await exportImportedDeck(restyled, out, JSON.parse(readFileSync(join(dir, 'project/retained.json'), 'utf8')))
      expect(exported.status).toBe('ok')
      const xml = new TextDecoder().decode(unzipSync(readFileSync(out))['ppt/slides/slide5.xml']!)
      expect(xml).toContain('第5页主张')
      expect(xml).toContain('1E2BFA')
      expect(xml).not.toContain('C41628')
      const slide3 = new TextDecoder().decode(unzipSync(readFileSync(out))['ppt/slides/slide3.xml']!)
      expect(slide3).toContain('合并表')
      const round = importPptx(bytes)
      const title = round.deck!.pages[0]!.elements.find(element => element.id === 'title')!
      const again = await exportImportedDeck(round.deck!, join(dir, 'round.pptx'))
      const back = new TextDecoder().decode(unzipSync(readFileSync(again.pptx!))['ppt/slides/slide1.xml']!)
      const titleBlock = back.split('name="title"')[1] ?? ''
      const off = Number(/<a:off x="(\d+)"/.exec(titleBlock)?.[1])
      expect(Math.abs(off / 12700 - title.bounds.x)).toBeLessThanOrEqual(2)
      expect(back).toContain(title.text!)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps rich text, crop, links, charts, and reports SmartArt and video in the fixed sentences', () => {
    const rich = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="rich"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${emu(48)}" y="${emu(48)}"/><a:ext cx="${emu(400)}" cy="${emu(80)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t>重点</a:t></a:r><a:r><a:rPr sz="1400"><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></a:rPr><a:t>补充</a:t></a:r></a:p>
      </p:txBody></p:sp>`
    const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rIdImg"/><a:srcRect l="10000" t="0" r="20000" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${emu(480)}" y="${emu(48)}"/><a:ext cx="${emu(200)}" cy="${emu(120)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    const emf = `<p:pic><p:nvPicPr><p:cNvPr id="5" name="emf-logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rIdEmf"/></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${emu(700)}" y="${emu(48)}"/><a:ext cx="${emu(80)}" cy="${emu(40)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    const video = `<p:pic><p:nvPicPr><p:cNvPr id="6" name="clip"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdVid"/></p:nvPr></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${emu(48)}" y="${emu(200)}"/><a:ext cx="${emu(160)}" cy="${emu(90)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    const smart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="smart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="${emu(240)}" y="${emu(200)}"/><a:ext cx="${emu(200)}" cy="${emu(80)}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:graphic></p:graphicFrame>`
    const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="11" name="trend"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="${emu(48)}" y="${emu(300)}"/><a:ext cx="${emu(400)}" cy="${emu(180)}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/></a:graphicData></a:graphic>
    </p:graphicFrame>`
    const connector = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="12" name="arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
      <p:spPr><a:xfrm><a:off x="${emu(480)}" y="${emu(300)}"/><a:ext cx="${emu(120)}" cy="${emu(0.5)}"/></a:xfrm>
        <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>
      </p:spPr></p:cxnSp>`
    const part = `<p:contentPart r:id="rIdInk"/>`
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="13" name="小组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${emu(800)}" y="${emu(400)}"/><a:ext cx="${emu(80)}" cy="${emu(40)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(80)}" cy="${emu(40)}"/></a:xfrm></p:grpSpPr>${rect('组块', 0, 0, 60, 30)}</p:grpSp>`
    let bytes = deckFiles([`${rich}${picture}${emf}${video}${smart}${chart}${connector}${part}${group}`], {
      'ppt/media/photo.png': PNG,
      'ppt/media/mark.emf': strToU8('EMF-BYTES'),
      'ppt/charts/chart1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart>
  <c:barDir val="col"/><c:grouping val="clustered"/>
  <c:ser><c:tx><c:v>营收</c:v></c:tx>
    <c:cat><c:strLit><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="1"><c:v>2025</c:v></c:pt></c:strLit></c:cat>
    <c:val><c:numLit><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>12</c:v></c:pt></c:numLit></c:val>
  </c:ser>
</c:barChart></c:plotArea></c:chart></c:chartSpace>`,
    })
    bytes = withSlideRels(bytes, 1, [
      { id: 'rIdImg', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/photo.png' },
      { id: 'rIdEmf', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/mark.emf' },
      { id: 'rIdVid', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video', target: '../media/clip.mp4' },
      { id: 'rIdChart', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', target: '../charts/chart1.xml' },
      { id: 'rIdLink', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', target: 'https://example.com/report', external: true },
      { id: 'rIdInk', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml', target: '../ink/ink1.xml' },
    ])
    const imported = importPptx(bytes, { fileName: '咨询稿.pptx' })
    expect(imported.deck, imported.diagnostics.filter(item => item.feature === 'schema').map(item => item.message).join('\n')).not.toBeNull()
    const page = imported.deck!.pages[0]!
    const text = page.elements.find(element => element.id === 'rich')
    expect(text?.text).toContain('重点')
    expect(text?.text).toContain('补充')
    expect(text?.runs?.length).toBe(2)
    expect(text?.link?.href).toBe('https://example.com/report')
    expect(text?.text?.startsWith('•')).toBe(true)
    const photo = page.elements.find(element => element.id === 'photo')
    expect(photo?.crop).toEqual({ l: 0.1, t: 0, r: 0.2, b: 0 })
    expect(page.elements.find(element => element.id === 'emf-logo')?.retained?.message).toBe(IMPORT_USER_MESSAGES.emf)
    expect(imported.diagnostics.find(item => item.feature === 'smartart')?.message).toBe(IMPORT_USER_MESSAGES.smartart)
    expect(imported.diagnostics.find(item => item.feature === 'video')?.message).toBe(IMPORT_USER_MESSAGES.video)
    expect(page.elements.find(element => element.id === 'trend')?.chart).toMatchObject({ kind: 'column', categories: ['2024', '2025'] })
    expect(page.elements.find(element => element.id === 'arrow')?.arrow).toBe('start')
    const kinds = new Set(imported.diagnostics.map(item => item.sourceKind).filter(Boolean))
    for (const kind of DSH_PAGE_OBJECT_CATEGORIES) expect(kinds.has(kind)).toBe(true)
    expect(checkDeck(imported.deck!)).toEqual([])
  })

  it('maps geometry, gradient, pattern, and shadow into the existing deck fields', () => {
    const round = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="round"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="${emu(40)}" y="${emu(80)}"/><a:ext cx="${emu(100)}" cy="${emu(100)}"/></a:xfrm>
      <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>
      <a:solidFill><a:srgbClr val="C41628"/></a:solidFill>
      <a:effectLst><a:outerShdw blurRad="${emu(4)}" dist="${emu(2)}" dir="2700000"><a:srgbClr val="111111"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>
    </p:spPr></p:sp>`
    const triangle = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="tri"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="${emu(160)}" y="${emu(80)}"/><a:ext cx="${emu(100)}" cy="${emu(100)}"/></a:xfrm>
      <a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>
      <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
    </p:spPr></p:sp>`
    const custom = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="custom"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="${emu(280)}" y="${emu(80)}"/><a:ext cx="${emu(100)}" cy="${emu(100)}"/></a:xfrm>
      <a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
      <a:solidFill><a:srgbClr val="111111"/></a:solidFill>
    </p:spPr></p:sp>`
    const gradient = `<p:sp><p:nvSpPr><p:cNvPr id="5" name="fade"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="${emu(400)}" y="${emu(80)}"/><a:ext cx="${emu(100)}" cy="${emu(100)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="C41628"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>
    </p:spPr></p:sp>`
    const pattern = `<p:sp><p:nvSpPr><p:cNvPr id="6" name="grain"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="${emu(520)}" y="${emu(80)}"/><a:ext cx="${emu(100)}" cy="${emu(100)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="111111"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>
    </p:spPr></p:sp>`
    const imported = importPptx(deckFiles([`${round}${triangle}${custom}${gradient}${pattern}`]))
    expect(imported.deck, imported.diagnostics.filter(item => item.feature === 'schema').map(item => item.message).join('\n')).not.toBeNull()
    const page = imported.deck!.pages[0]!
    expect(page.elements.find(element => element.id === 'round')).toMatchObject({ shape: 'roundRect', radius: 25, fill: '$accent' })
    expect(page.elements.find(element => element.id === 'round')?.shadow?.opacity).toBe(0.4)
    expect(page.elements.find(element => element.id === 'tri')?.shape).toBe('path')
    expect(page.elements.find(element => element.id === 'custom')?.path).toContain('M 0 0')
    expect(page.elements.find(element => element.id === 'fade')?.gradient).toMatchObject({ kind: 'linear', angle: 90 })
    expect(page.elements.find(element => element.id === 'grain')?.pattern?.preset).toBe('ltHorz')
    expect(checkDeck(imported.deck!)).toEqual([])
  })

  it('rejects unsafe packages and enforces the page limit without claiming a preview', () => {
    expect(() => importPptx(strToU8('hello'))).toThrow('不是有效的 PPTX')
    const hostile = pack({
      'ppt/presentation.xml': `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "y">]><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="${emu(960)}" cy="${emu(540)}"/></p:presentation>`,
    })
    expect(() => importPptx(hostile)).toThrow('不受支持的 XML')
    const tooMany = deckFiles(Array.from({ length: 41 }, () => textBox('title', '页', 48, 72, 200, 40)))
    expect(() => importPptx(tooMany)).toThrow('页数上限')
    expect(pptUploadRole('季度汇报.pptx', 'conversation')).toBe('external-deck')
    expect(pptUploadRole('季度汇报.pptx', 'template-gallery')).toBe('template-library')
    expect(pptUploadRole('notes.txt', 'conversation')).toBe('other')
  })

  it('imports five shipped template exports and five structural decks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppt-samples-'))
    try {
      const styles = ['dsh-cartesian', 'dsh-blue-professional', 'dsh-course-workshop', 'dsh-editorial-notebook', 'dsh-engineering-blueprint']
      for (const style of styles) {
        const loaded = JSON.parse(readFileSync(join(import.meta.dir, `../../styles/${style}/deck.json`), 'utf8'))
        loaded.pages = loaded.pages.slice(0, 1)
        const out = join(dir, `${style}.pptx`)
        const exported = await exportImportedDeck(loaded, out)
        expect(exported.status).toBe('ok')
        const imported = importPptx(new Uint8Array(readFileSync(out)), { fileName: `${style}.pptx` })
        expect(imported.deck, `${style} ${imported.diagnostics.filter(item => item.feature === 'schema').map(item => item.message).join('; ')}`).not.toBeNull()
        expect(imported.diagnostics.some(item => item.slide === 1 || item.feature === 'theme-font' || item.feature === 'text' || item.feature === 'shape')).toBe(true)
        expect(parseDeckDocument(imported.deck!).deck?.version).toBe(2)
      }
      const structural = [
        deckFiles([textBox('title', '封面', 48, 72, 400, 40)]),
        deckFiles([`${textBox('title', '组合页', 48, 48, 300, 36)}<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${emu(40)}" y="${emu(120)}"/><a:ext cx="${emu(100)}" cy="${emu(40)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(100)}" cy="${emu(40)}"/></a:xfrm></p:grpSpPr>${rect('块', 0, 0, 80, 30)}</p:grpSp>`]),
        deckFiles([textBox('title', '图表页', 48, 40, 200, 36)]),
        deckFiles([`${textBox('title', '媒体页', 48, 40, 200, 36)}<p:pic><p:nvPicPr><p:cNvPr id="4" name="film"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdV"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdV"/></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(40)}" y="${emu(100)}"/><a:ext cx="${emu(80)}" cy="${emu(40)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`]),
        deckFiles([textBox('title', '表格页', 48, 40, 200, 36)]),
      ]
      for (const [index, bytes] of structural.entries()) {
        const imported = importPptx(bytes, { fileName: `enterprise-${index + 1}.pptx` })
        expect(imported.deck, imported.diagnostics.filter(item => item.feature === 'schema').map(item => item.message).join(';')).not.toBeNull()
        expect(imported.diagnostics.length).toBeGreaterThan(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
