import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import PptxGenJS from 'pptxgenjs'
import sharp from 'sharp'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { buildPptPrompt } from './ppt-catalog'
import { buildPptRevisionPrompt, validatePptRevision } from './ppt-live'
import { customTemplateCard, customTemplatePreview, deletePptTemplate, exportPptTemplate, importPptTemplate, listCustomCatalogTemplates, listPptCustomTemplates, renamePptTemplate, setPptPreviewHtmlForTests, setPptPreviewRasterForTests, thumbnailPptTemplateCard } from './ppt-library'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('custom details render source HTML once, preserve text and keep cards lightweight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-detail-'))
  const high = await sharp({ create: { width: 2880, height: 1620, channels: 3, background: '#fff' } }).png().toBuffer()
  let renders = 0
  setPptPreviewRasterForTests((_source, _page, output) => { writeFileSync(output, high); return true })
  setPptPreviewHtmlForTests(async (source, page) => {
    expect(source.endsWith('source.pptx')).toBe(true)
    expect(page).toBe(1)
    renders++
    return '<html><head></head><body><p>中文小字与 Retina</p><script>if(location.hash.indexOf(\'screenshot\')>=0){}</script></body></html>'
  })
  try {
    const source = await sample('中文小字与 Retina', 1)
    const { record } = importPptTemplate(source, '模板.pptx', root)
    const card = await thumbnailPptTemplateCard(customTemplateCard(record, root))
    const thumb = await sharp(Buffer.from(card.cover.split(',')[1]!, 'base64')).metadata()
    expect(thumb.width).toBe(480)
    const requests = [customTemplatePreview(record.id, 1, root), customTemplatePreview(record.id, 1, root)]
    const [first, second] = await Promise.all(requests)
    expect(first).toBe(second)
    expect(first.startsWith('data:text/html;base64,')).toBe(true)
    const html = Buffer.from(first.split(',')[1]!, 'base64').toString()
    expect(html).toContain('中文小字与 Retina')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('if(true)')
    expect(await customTemplatePreview(record.id, 1, root)).toBe(first)
    expect(renders).toBe(1)
    expect(readFileSync(join(root, record.id, 'source.pptx'))).toEqual(Buffer.from(source))
    for (const page of [undefined, 0, -1, 2, 1.5, NaN]) await expect(customTemplatePreview(record.id, page, root)).rejects.toThrow('Unknown PPT template page')
    await expect(customTemplatePreview('../escape', 1, root)).rejects.toThrow('Unknown PPT template')
  } finally { setPptPreviewRasterForTests(null); setPptPreviewHtmlForTests(undefined); rmSync(root, { recursive: true, force: true }) }
})

test('custom detail rejects invalid output instead of enlarging the stored raster', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-detail-small-'))
  setPptPreviewRasterForTests((_source, _page, output) => { writeFileSync(output, TINY_PNG); return true })
  setPptPreviewHtmlForTests(async () => 'data:image/png;base64,small-thumbnail')
  try {
    const { record } = importPptTemplate(await sample('小图', 1), '模板.pptx', root)
    await expect(customTemplatePreview(record.id, 1, root)).rejects.toThrow('Invalid PPT preview HTML')
  } finally { setPptPreviewRasterForTests(null); setPptPreviewHtmlForTests(undefined); rmSync(root, { recursive: true, force: true }) }
})

test('custom cache evicts old generated details without removing user sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-detail-budget-'))
  setPptPreviewRasterForTests((_source, _page, output) => { writeFileSync(output, TINY_PNG); return true })
  setPptPreviewHtmlForTests(async () => '<html><head></head><body>中文小字</body></html>')
  try {
    const { record } = importPptTemplate(await sample('保留原稿', 1), '模板.pptx', root)
    const caches: string[] = []
    for (const [index, id] of ['custom-0000000000000000', 'custom-1111111111111111'].entries()) {
      const dir = join(root, id, 'previews')
      mkdirSync(dir, { recursive: true })
      const cache = join(dir, '01.detail-v1.html')
      writeFileSync(cache, '')
      truncateSync(cache, 80 * 1024 * 1024) // sparse: exercise the byte budget without allocating 160 MiB
      utimesSync(cache, index + 1, index + 1)
      caches.push(cache)
    }
    await customTemplatePreview(record.id, 1, root)
    expect(existsSync(caches[0]!)).toBe(false)
    expect(existsSync(caches[1]!)).toBe(true)
    expect(existsSync(join(root, record.id, 'source.pptx'))).toBe(true)
    expect(existsSync(join(root, record.id, 'previews/01.png'))).toBe(true)
  } finally { setPptPreviewRasterForTests(null); setPptPreviewHtmlForTests(undefined); rmSync(root, { recursive: true, force: true }) }
})

async function sample(title: string, pages = 2): Promise<Uint8Array> {
  const deck = new PptxGenJS()
  deck.defineLayout({ name: 'wide', width: 13.333, height: 7.5 })
  deck.layout = 'wide'
  deck.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei' }
  for (let page = 1; page <= pages; page++) {
    const slide = deck.addSlide()
    slide.background = { color: 'F4F1EA' }
    slide.addText(`${title} ${page}`, { x: 0.6, y: 0.4, w: 10, h: 0.8, fontSize: 28, color: '1A1A1A', bold: true })
    slide.addText('可替换的说明', { x: 0.6, y: 1.5, w: 8, h: 0.5, fontSize: 16, color: '5C5A55' })
    slide.addShape('rect', { x: 0.6, y: 2.4, w: 3, h: 1.4, fill: { color: '1D4ED8' } })
  }
  return new Uint8Array(await deck.write({ outputType: 'uint8array' }) as Uint8Array)
}

test('custom PPTX is stored in the user library and reused by hash', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ppt-library-'))
  const root = join(home, 'ppt-templates')
  const previous = process.env.CRAFT_CONFIG_DIR
  process.env.CRAFT_CONFIG_DIR = home
  setPptPreviewRasterForTests(() => false)
  try {
    const bytes = await sample('季度经营会', 3)
    const uploadPath = '/tmp/upload-季度经营会.pptx'
    const first = importPptTemplate(bytes, '季度经营会.pptx', root)
    expect(first.duplicate).toBe(false)
    expect(first.record.id).toMatch(/^custom-[a-f0-9]{16}$/)
    expect(first.record.pageCount).toBe(3)
    expect(first.record.canvas.label).toBe('16:9')
    const theme = JSON.parse(readFileSync(join(root, first.record.id, 'theme.json'), 'utf8')) as { colors: Record<string, string>; fonts: { majorLatin?: string }; masters: string[]; layouts: string[] }
    expect(theme.colors.accent1).toMatch(/^#[0-9A-F]{6}$/)
    expect(theme.fonts.majorLatin).toBe('Microsoft YaHei')
    expect(theme.masters.length).toBeGreaterThan(0)
    expect(theme.layouts.length).toBeGreaterThan(0)
    const slots = JSON.parse(readFileSync(join(root, first.record.id, 'slots.json'), 'utf8')) as Array<{ page: number; text: string }>
    expect(slots.some(slot => slot.page === 1 && slot.text.includes('季度经营会'))).toBe(true)
    expect(first.record.preview).toBe('geometry')
    expect(readFileSync(join(root, first.record.id, 'previews', '01.svg'), 'utf8')).toContain('<svg')
    expect(readFileSync(join(root, first.record.id, 'previews', '03.svg'), 'utf8')).toContain('季度经营会 3')
    const source = readFileSync(join(root, first.record.id, 'source.pptx'))
    expect(Buffer.compare(source, Buffer.from(bytes))).toBe(0)

    const renamed = renamePptTemplate(first.record.id, '经营会模板', root)
    const again = importPptTemplate(bytes, '另一个名字.pptx', root)
    expect(again.duplicate).toBe(true)
    expect(again.record.id).toBe(first.record.id)
    expect(again.record.title).toBe('经营会模板')
    expect(listPptCustomTemplates(root)).toHaveLength(1)

    const exported = exportPptTemplate(first.record.id, root)
    expect(exported.name).toBe('经营会模板.pptx')
    expect(Buffer.compare(Buffer.from(exported.bytes), source)).toBe(0)

    const prompt = buildPptPrompt({ templateId: first.record.id }, join(home, 'session'))
    expect(prompt).toContain(join(root, first.record.id, 'source.pptx'))
    expect(prompt).toContain(join(root, first.record.id, 'theme.json'))
    expect(prompt).toContain(join(root, first.record.id, 'slots.json'))
    expect(prompt).toContain('01.svg')
    expect(prompt).not.toContain(uploadPath)
    const revision = validatePptRevision({ action: 'restyle', targets: [], templateId: first.record.id })
    expect(buildPptRevisionPrompt(revision, join(home, 'session'))).toContain(join(root, first.record.id, 'source.pptx'))

    const child = Bun.spawn([process.execPath, '-e', `
      const { listPptCustomTemplates } = await import(${JSON.stringify(new URL('./ppt-library.ts', import.meta.url).href)})
      console.log(JSON.stringify(listPptCustomTemplates(${JSON.stringify(root)}).map(record => record.title)))
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual(['经营会模板'])

    setPptPreviewRasterForTests((_pptx, _page, out) => {
      writeFileSync(out, TINY_PNG)
      return true
    })
    const rendered = importPptTemplate(await sample('真实预览', 2), '真实预览.pptx', root)
    expect(rendered.record.preview).toBe('officecli')
    expect(readFileSync(join(root, rendered.record.id, 'previews', '01.png')).subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(existsSync(join(root, rendered.record.id, 'previews', '01.svg'))).toBe(false)
    const card = listCustomCatalogTemplates(root).find(item => item.id === rendered.record.id)
    expect(card?.cover.startsWith('data:image/png;base64,')).toBe(true)
    const renderedPrompt = buildPptPrompt({ templateId: rendered.record.id }, join(home, 'session'))
    expect(renderedPrompt).toContain('01.png')
    expect(renderedPrompt).not.toContain(join(root, rendered.record.id, 'previews', '01.svg'))
    const slotsStill = JSON.parse(readFileSync(join(root, rendered.record.id, 'slots.json'), 'utf8')) as Array<{ text: string }>
    expect(slotsStill.some(slot => slot.text.includes('真实预览'))).toBe(true)

    setPptPreviewRasterForTests(() => { throw new Error('renderer down') })
    const fellBack = importPptTemplate(await sample('退回几何', 1), '退回几何.pptx', root)
    expect(fellBack.record.preview).toBe('geometry')
    expect(readFileSync(join(root, fellBack.record.id, 'previews', '01.svg'), 'utf8')).toContain('退回几何')

    deletePptTemplate(renamed.id, root)
    deletePptTemplate(rendered.record.id, root)
    deletePptTemplate(fellBack.record.id, root)
    expect(listPptCustomTemplates(root)).toEqual([])
    expect(() => exportPptTemplate(first.record.id, root)).toThrow('Unknown PPT template')
    expect(() => renamePptTemplate('../escape', 'x', root)).toThrow('Unknown PPT template')
    expect(() => importPptTemplate(new Uint8Array(8 * 1024 * 1024 + 1), 'big.pptx', root)).toThrow('Invalid PPTX')
    expect(() => importPptTemplate(zipSync({ '../evil.txt': strToU8('no'), 'ppt/presentation.xml': strToU8('<p/>') }), 'slip.pptx', root)).toThrow('Invalid PPTX')
  } finally {
    setPptPreviewRasterForTests(null)
    if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = previous
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)

test('bundled OfficeCLI HTML screenshot is kept when it returns a PNG', async () => {
  const bin = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
  if (!bin || process.platform === 'win32') return
  const home = mkdtempSync(join(tmpdir(), 'ppt-library-live-'))
  const root = join(home, 'ppt-templates')
  setPptPreviewRasterForTests(null)
  try {
    const imported = importPptTemplate(await sample('实拍预览', 1), '实拍预览.pptx', root)
    const png = join(root, imported.record.id, 'previews', '01.png')
    const svg = join(root, imported.record.id, 'previews', '01.svg')
    if (existsSync(png)) {
      expect(readFileSync(png).subarray(0, 4).toString('hex')).toBe('89504e47')
      expect(imported.record.preview).toBe('officecli')
    } else {
      expect(readFileSync(svg, 'utf8')).toContain('实拍预览')
      expect(imported.record.preview).toBe('geometry')
    }
  } finally {
    setPptPreviewRasterForTests(null)
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
