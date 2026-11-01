import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { customTemplateCard, deletePptTemplate, importPptTemplate, materializeTemplateProject, setPptPreviewRasterForTests, TEMPLATE_DRAFT_TTL_MS, cleanupTemplateDrafts } from './ppt-library'
import { createTemplateTaskProject, writeSampleExtension } from './ppt-template-project'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function sample(title: string, pages: number, image = false): Promise<Uint8Array> {
  const deck = new PptxGenJS()
  deck.defineLayout({ name: 'wide', width: 13.333, height: 7.5 })
  deck.layout = 'wide'
  for (let page = 1; page <= pages; page++) {
    const slide = deck.addSlide()
    slide.addText(`${title} ${page}`, { x: 0.6, y: 0.4, w: 10, h: 0.6, fontSize: 28, color: '1A1A1A' })
    if (image && page === 1) slide.addImage({ data: `data:image/png;base64,${TINY_PNG.toString('base64')}`, x: 0.6, y: 1.6, w: 3.2, h: 1.8 })
  }
  return new Uint8Array(await deck.write({ outputType: 'uint8array' }) as Uint8Array)
}

test('a personal template becomes an editable project without touching the original', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-project-'))
  const workspace = mkdtempSync(join(tmpdir(), 'ppt-workspace-'))
  setPptPreviewRasterForTests((_source, _page, output) => { writeFileSync(output, TINY_PNG); return true })
  try {
    const bytes = await sample('季度汇报', 3, true)
    const sourceSha = createHash('sha256').update(bytes).digest('hex')
    const imported = importPptTemplate(bytes, '公司模板.pptx', root)
    const again = importPptTemplate(bytes, '改名.pptx', root)
    expect(again.duplicate).toBe(true)
    expect(again.record.id).toBe(imported.record.id)
    const record = await materializeTemplateProject(imported.record.id, root)
    expect(record.diagnostics).toBeTruthy()
    expect(createHash('sha256').update(readFileSync(join(root, record.id, 'source.pptx'))).digest('hex')).toBe(sourceSha)
    const created = await createTemplateTaskProject({ templateId: record.id, workspaceDir: workspace, libraryRoot: root, pages: [1, 3] })
    expect(created.sourceUnchanged).toBe(true)
    expect(created.sourceSha256).toBe(sourceSha)
    expect(created.pages.map(page => page.index)).toEqual([1, 2])
    expect(created.files.length).toBeGreaterThan(0)
    expect(created.files.every(file => file.sha256 === createHash('sha256').update(readFileSync(file.path)).digest('hex'))).toBe(true)
    expect(created.proposedImageSlots && existsSync(created.proposedImageSlots)).toBe(true)
    const proposal = JSON.parse(readFileSync(created.proposedImageSlots!, 'utf8')) as { confirmed: boolean }
    expect(proposal.confirmed).toBe(false)
    const extension = writeSampleExtension(created.projectDir, '样例.json', new TextEncoder().encode('{"sample":true}'))
    expect(extension).toContain(`${created.projectDir}/sample-extension`)
    expect(() => writeSampleExtension(created.projectDir, '../escape.json', new Uint8Array([1]))).toThrow('样例扩展')
    deletePptTemplate(record.id, root)
    expect(existsSync(join(root, record.id))).toBe(false)
    expect(existsSync(join(created.projectDir, 'deck.json'))).toBe(true)
  } finally {
    setPptPreviewRasterForTests(null)
    rmSync(root, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('old drafts expire after 24 hours and a fresh draft stays', () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-drafts-'))
  try {
    const drafts = join(root, 'drafts')
    mkdirSync(drafts, { recursive: true })
    writeFileSync(join(drafts, 'old.txt'), 'old')
    writeFileSync(join(drafts, 'new.txt'), 'new')
    const old = (Date.now() - TEMPLATE_DRAFT_TTL_MS - 5_000) / 1000
    utimesSync(join(drafts, 'old.txt'), old, old)
    expect(cleanupTemplateDrafts(root).sort()).toEqual(['old.txt'])
    expect(existsSync(join(drafts, 'new.txt'))).toBe(true)
    expect(statSync(join(drafts, 'new.txt')).isFile()).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an old library record can be upgraded without replacing its pptx', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ppt-upgrade-'))
  setPptPreviewRasterForTests((_source, _page, output) => { writeFileSync(output, TINY_PNG); return true })
  try {
    const bytes = await sample('旧模板', 1)
    const { record } = importPptTemplate(bytes, '旧.pptx', root)
    rmSync(join(root, record.id, 'project'), { recursive: true, force: true })
    const meta = JSON.parse(readFileSync(join(root, record.id, 'meta.json'), 'utf8')) as { diagnostics?: unknown }
    delete meta.diagnostics
    writeFileSync(join(root, record.id, 'meta.json'), JSON.stringify(meta))
    const upgraded = await materializeTemplateProject(record.id, root)
    expect(existsSync(join(root, record.id, 'project', 'deck.json'))).toBe(true)
    expect(upgraded.diagnostics).toBeTruthy()
    expect(readFileSync(join(root, record.id, 'source.pptx'))).toEqual(Buffer.from(bytes))
    const card = customTemplateCard(upgraded, root)
    expect(card.diagnostics?.unsupported).toBeGreaterThanOrEqual(0)
    expect(card.title).toBe(record.title)
  } finally {
    setPptPreviewRasterForTests(null)
    rmSync(root, { recursive: true, force: true })
  }
})
