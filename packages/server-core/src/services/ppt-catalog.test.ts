import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PptRequest, SendMessageOptions } from '@craft-agent/shared/protocol'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@craft-agent/shared/protocol'
import type { ChartSkillCandidate } from '@craft-agent/shared/skills'
import { buildPptPrompt, getPptCatalog, getPptTemplatePages, getPptTemplatePreview, PPT_ARCHIVED_ASSET_MESSAGE, pptSendOptions, readPptAsset, validatePptRequest } from './ppt-catalog'
import { coverQuality } from './ppt-cover-quality'

const root = realpathSync(resolve(import.meta.dir, '../../../../apps/electron/resources/skills/ppt-design'))
const dirs: string[] = []
function temp() { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ppt-catalog-'))); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const defaultIds = ['dsh-cartesian', 'ppt169_china_economy_2025_briefing', 'mbb-consulting', 'operating-review', 'dsh-engineering-blueprint', 'dsh-course-workshop']
const themeIds = ['dsh-signal', 'dsh-monochrome', 'dsh-editorial-forest', 'dsh-soft-editorial', 'dsh-editorial-notebook']

test('every offered template has real decodable WebP references, Chinese title and approved home order/categories', () => {
  const catalog = getPptCatalog(root)
  const source = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, unknown>
  expect(Object.keys(source).length).toBeGreaterThan(catalog.templates.length)
  expect(catalog.templates.filter(item => item.tier === 'default').map(item => item.id)).toEqual(defaultIds)
  expect(catalog.templates.filter(item => item.tier === 'more')).toHaveLength(13)
  expect(catalog.templates.find(item => item.id === 'dsh-blue-professional')?.note).toContain('理性简报')
  expect(catalog.templates.find(item => item.id === 'dsh-cartesian')?.variants?.map(item => item.id)).toEqual(themeIds)
  expect(catalog.templates.some(item => item.id === 'workshop-teaching' || item.id === 'ppt169_qianli_jiangshan_scroll' || item.id === 'dsh-broadside')).toBe(false)
  expect(catalog.templates.find(item => item.id === 'dsh-cartesian')).toMatchObject({ title: '理性简报', category: '商务' })
  expect(catalog.templates.find(item => item.id === 'ppt169_china_economy_2025_briefing')).toMatchObject({ title: '数据简报', category: '商务' })
  expect(catalog.templates.find(item => item.id === 'dsh-course-workshop')).toMatchObject({ title: '课程培训', category: '教学' })
  expect(catalog.templates.find(item => item.id === 'academic-research')?.category).toBe('学术')
  for (const item of catalog.templates) {
    expect(item.title).toMatch(/[\u3400-\u9fff]/)
    expect(['商务', '咨询', '学术', '教学', '技术', '创意', '社媒']).toContain(item.category)
    expect(item.referencePages.length).toBe(Math.min(2, item.pages - 1))
    for (const image of [item.cover, ...item.referencePages, ...(item.variants ?? []).flatMap(variant => [variant.cover, ...variant.referencePages])]) {
      const data = Buffer.from(image.split(',')[1]!, 'base64')
      expect(data.toString('ascii', 0, 4)).toBe('RIFF')
      expect(data.toString('ascii', 8, 12)).toBe('WEBP')
    }
  }
  expect(Buffer.byteLength(JSON.stringify({ type: 'response', result: catalog }))).toBeLessThan(DEFAULT_MAX_MESSAGE_BYTES)
  expect(getPptCatalog(root)).toBe(catalog)
})

test('lazy full previews match every visible deck in numeric order within the RPC limit', () => {
  const source = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, { deck: string }>
  const display = JSON.parse(readFileSync(join(root, 'styles/picker.json'), 'utf8')) as { templates: Record<string, { previewId: string; tier?: string; variantOf?: string }> }
  const visible = Object.entries(display.templates).filter(([, item]) => item.tier === 'default' || item.tier === 'more' || item.variantOf)
  expect(visible.length).toBe(defaultIds.length + 13 + themeIds.length)
  for (const [id, item] of visible) {
    const entry = source[id]!
    const deck = JSON.parse(readFileSync(join(root, entry.deck), 'utf8'))
    const pages = getPptTemplatePages(id, root)
    expect(pages.length).toBe(deck.pages.length)
    expect(Buffer.byteLength(JSON.stringify({ type: 'response', result: pages }))).toBeLessThan(DEFAULT_MAX_MESSAGE_BYTES)
    pages.forEach((page, index) => {
      expect(Buffer.from(page.split(',')[1]!, 'base64')).toEqual(readFileSync(join(root, `styles/previews/pages/${item.previewId}-${index + 1}.webp`)))
    })
  }
  expect(getPptTemplatePages('dsh-cartesian', root)).toHaveLength(12)
  expect(getPptTemplatePages('ppt169_china_economy_2025_briefing', root)).toHaveLength(17)
  expect(getPptTemplatePages('dsh-broadside', root)).toHaveLength(12)
  expect(getPptTemplatePreview('dsh-broadside', root).startsWith('data:application/pdf;base64,')).toBe(true)
})

test('lazy full preview rejects unknown, traversal and inherited IDs', () => {
  for (const id of ['missing', '../dsh-cartesian', '/tmp/deck', '__proto__', 'constructor']) {
    expect(() => getPptTemplatePages(id, root)).toThrow('Unknown PPT template')
    expect(() => getPptTemplatePreview(id, root)).toThrow('Unknown PPT template')
  }
})

test('every detail document is a real vector PDF within the WebUI transport limit', () => {
  const catalog = getPptCatalog(root)
  for (const template of [...catalog.templates, ...catalog.templates.flatMap(item => item.variants ?? [])]) {
    const document = getPptTemplatePreview(template.id, root)
    expect(document.startsWith('data:application/pdf;base64,')).toBe(true)
    const pdf = Buffer.from(document.split(',')[1]!, 'base64')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // A text/font PDF, not one full-slide thumbnail embedded in a PDF wrapper.
    expect(pdf.includes(Buffer.from('/Font'))).toBe(true)
    expect(Buffer.byteLength(JSON.stringify({ type: 'response', result: document }))).toBeLessThan(DEFAULT_MAX_MESSAGE_BYTES)
  }
})

test('lazy preview images cannot escape the canonical resource root through symlinks', () => {
  const inside = temp(), outside = temp()
  mkdirSync(join(inside, 'styles/previews'), { recursive: true })
  writeFileSync(join(inside, 'styles/catalog.json'), JSON.stringify({ safe: { deck: 'deck.json' } }))
  writeFileSync(join(inside, 'styles/picker.json'), JSON.stringify({ templates: { safe: { previewId: 'safe' } } }))
  writeFileSync(join(inside, 'deck.json'), JSON.stringify({ pages: [{}] }))
  writeFileSync(join(outside, 'safe-1.webp'), 'outside')
  symlinkSync(outside, join(inside, 'styles/previews/pages'), 'dir')
  expect(() => getPptTemplatePages('safe', inside)).toThrow('escapes')
})

test('canonical bundled root rejects traversal, absolute paths and symlink escapes', () => {
  const inside = temp(), outside = temp()
  writeFileSync(join(inside, 'ok.txt'), 'inside')
  writeFileSync(join(outside, 'secret.txt'), 'outside')
  symlinkSync(outside, join(inside, 'escape'), 'dir')
  expect(readPptAsset(inside, 'ok.txt').toString()).toBe('inside')
  expect(() => readPptAsset(inside, join(outside, 'secret.txt'))).toThrow()
  expect(() => readPptAsset(inside, '../' + outside.split('/').pop() + '/secret.txt')).toThrow()
  expect(() => readPptAsset(inside, 'escape/secret.txt')).toThrow('escapes')
})

test('visible card covers are not blank or tofu, and a hollow-box fixture is caught', async () => {
  const sharp = (await import('sharp')).default
  const blank = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#E85D26' } }).png().toBuffer()
  expect((await coverQuality(blank)).blank).toBe(true)
  const boxes = Array.from({ length: 6 }, (_, index) => `<rect x="${16 + index * 28}" y="70" width="18" height="18" fill="none" stroke="#181915" stroke-width="2"/>`).join('')
  const tofu = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#E85D26"/>${boxes}</svg>`)).png().toBuffer()
  expect((await coverQuality(tofu)).tofu).toBe(true)
  const display = JSON.parse(readFileSync(join(root, 'styles/picker.json'), 'utf8')) as { templates: Record<string, { previewId: string; tier?: string; variantOf?: string }> }
  const seen = new Set<string>()
  for (const item of Object.values(display.templates)) {
    if (item.tier !== 'default' && item.tier !== 'more' && !item.variantOf) continue
    if (seen.has(item.previewId)) continue
    seen.add(item.previewId)
    const quality = await coverQuality(readFileSync(join(root, `styles/previews/${item.previewId}-1.webp`)))
    expect(quality, item.previewId).toMatchObject({ blank: false, tofu: false })
  }
  expect(seen.size).toBe(defaultIds.length + 13 + themeIds.length)
})

test('archived ids stay valid and explain a missing install without throwing', () => {
  expect(validatePptRequest({ templateId: 'dsh-broadside' }, root).templateId).toBe('dsh-broadside')
  expect(validatePptRequest({ templateId: 'ppt169_ev_market_priorities' }, root).templateId).toBe('ppt169_ev_market_priorities')
  const inside = temp()
  mkdirSync(join(inside, 'styles/themes'), { recursive: true })
  writeFileSync(join(inside, 'styles/catalog.json'), JSON.stringify({ 'dsh-broadside': { name: '宣言', design: 'styles/dsh-broadside/design.md', deck: 'styles/_archive/imported/dsh-broadside/deck.json' } }))
  writeFileSync(join(inside, 'styles/picker.json'), JSON.stringify({ homeOrder: [], moreOrder: [], templates: { 'dsh-broadside': { title: '宣言海报', category: '创意', previewId: 'dsh-broadside', tier: 'archive' } } }))
  writeFileSync(join(inside, 'styles/themes/catalog.json'), '{}')
  const session = temp()
  const prompt = buildPptPrompt({ templateId: 'dsh-broadside' }, session, inside)
  expect(prompt).toContain(PPT_ARCHIVED_ASSET_MESSAGE)
  expect(prompt).toContain('[skill:ppt-design]')
  expect(() => getPptTemplatePages('dsh-broadside', inside)).toThrow(PPT_ARCHIVED_ASSET_MESSAGE)
})

test('request validation only accepts bundled IDs and safe settings', () => {
  const request: PptRequest = { templateId: 'dsh-cartesian', brandColor: '#12abEF', aspectRatio: '4:3', logo: { name: '品牌.png', mimeType: 'image/png', base64: Buffer.from('logo').toString('base64') } }
  expect(validatePptRequest(request, root)).toEqual(request)
  for (const invalid of [{ templateId: '../other' }, { themeId: 'missing' }, { brandColor: 'red' }, { aspectRatio: '2:1' }, { logo: { name: 'x', mimeType: 'text/html', base64: 'AAAA' } }]) {
    expect(() => validatePptRequest(invalid as PptRequest, root)).toThrow()
  }
})

test('PRO request enables skill without changing user transport options and adds real design references model-side', () => {
  const ppt: PptRequest = { templateId: 'dsh-cartesian', brandColor: '#123456', aspectRatio: '16:9', logo: { name: 'logo.png', mimeType: 'image/png', base64: Buffer.from('logo bytes').toString('base64') } }
  const options: SendMessageOptions = { skillSlugs: ['research'], ppt }
  expect(() => pptSendOptions('NORM', undefined, options, root)).toThrow('PRO')
  const prepared = pptSendOptions('PRO', undefined, options, root)!
  expect(prepared.skillSlugs).toEqual(['research', 'ppt-design'])
  expect(options.skillSlugs).toEqual(['research'])
  expect(pptSendOptions('PRO', ppt, undefined, root)?.ppt).toEqual(ppt)
  const session = temp()
  const context = buildPptPrompt(ppt, session, root)
  expect(context).toContain('[skill:ppt-design]')
  expect(context).toContain('selection-deck')
  expect(context).toContain(readFileSync(join(root, 'styles/dsh-cartesian/design.md'), 'utf8'))
  expect(context).toContain(realpathSync(join(root, 'styles/dsh-cartesian/deck.json')))
  expect(context).toContain(realpathSync(join(root, 'styles/previews/dsh-cartesian-1.webp')))
  expect(context).toContain('NOT a rigid form')
  expect(context).toContain('deck already exists')
  expect(context).toContain('#123456')
  expect(context).toContain(join(session, 'data', 'deck.json'))
  expect(context).toContain('slide-01.png')
  expect(context).toContain('ppt-output.json')
  expect(context).not.toContain('live panel')
  expect(context).not.toContain('data/deck.pptx')
  const themeId = getPptCatalog(root).themes[0]!.id
  expect(validatePptRequest({ themeId }, root)).toEqual({ themeId })
  expect(readFileSync(join(session, 'attachments/ppt-brand/logo.png')).toString()).toBe('logo bytes')
  expect(prepared.ppt).toEqual(ppt)
})

const sampleCharts: ChartSkillCandidate = {
  slug: 'sample-charts',
  source: 'workspace',
  metadata: { name: 'Sample Charts', description: '把表格画成图表，支持自定义色板。' },
  content: 'Return one SVG file. A custom palette may be supplied by the caller.',
}

test('an installed chart skill is named in the prompt only when the user names it', () => {
  const themeId = getPptCatalog(root).themes[0]!.id
  const request = { templateId: 'dsh-cartesian', themeId, brandColor: '#123456' }
  expect(validatePptRequest(Object.assign({}, request, { chartSkill: 'sample-charts' }), root)).toEqual(request)
  expect(validatePptRequest(JSON.parse('{"chartSkill":"../sample-charts"}'), root)).toEqual({})
  const named = '用 sample-charts 画图'
  const prepared = pptSendOptions('PRO', undefined, { skillSlugs: ['research'], ppt: request }, root, [sampleCharts], named)!
  expect(prepared.skillSlugs).toEqual(['research', 'ppt-design', 'sample-charts'])
  expect(prepared.ppt).toEqual(request)
  const namedSession = temp()
  const context = buildPptPrompt(request, namedSession, root, [sampleCharts], named)
  expect(context).toContain('[skill:sample-charts]')
  expect(context).toContain('custom palette')
  expect(context).toContain('#123456')
  expect(context).toContain('chart-fallback.json')
  expect(context).toContain('chartImage')
  expect(context).not.toContain('templates/color')
  expect(JSON.parse(readFileSync(join(namedSession, 'data', 'chart-fallback.json'), 'utf8'))).toEqual({ fallbacks: [] })
  const quietSession = temp()
  const quiet = buildPptPrompt(request, quietSession, root, [sampleCharts], '画个图表')
  expect(quiet).toContain('sample-charts')
  expect(quiet).not.toContain('[skill:sample-charts]')
  expect(quiet.toLowerCase()).toContain('do not ask')
  expect(pptSendOptions('PRO', request, undefined, root, [sampleCharts], '画个图表')?.skillSlugs).toEqual(['ppt-design'])
  expect(JSON.parse(readFileSync(join(quietSession, 'data', 'chart-fallback.json'), 'utf8')).fallbacks).toEqual([])
  const missingSession = temp()
  const missing = buildPptPrompt(request, missingSession, root, [], '用 lieflat-charts 画图')
  expect(missing).toContain('not installed')
  expect(missing).toContain('native editable charts')
  expect(missing).not.toContain('[skill:lieflat-charts]')
  expect(pptSendOptions('PRO', request, undefined, root, [], '用 lieflat-charts 画图')?.skillSlugs).toEqual(['ppt-design'])
  expect(JSON.parse(readFileSync(join(missingSession, 'data', 'chart-fallback.json'), 'utf8')).fallbacks).toEqual([{ skill: 'lieflat-charts', reason: 'missing' }])
})
