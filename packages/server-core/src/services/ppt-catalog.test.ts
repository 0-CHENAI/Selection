import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PptRequest, SendMessageOptions } from '@craft-agent/shared/protocol'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@craft-agent/shared/protocol'
import { buildPptPrompt, getPptCatalog, getPptTemplatePages, pptSendOptions, readPptAsset, validatePptRequest } from './ppt-catalog'

const root = realpathSync(resolve(import.meta.dir, '../../../../apps/electron/resources/skills/ppt-design'))
const dirs: string[] = []
function temp() { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ppt-catalog-'))); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('every offered template has real decodable WebP references, Chinese title and approved home order/categories', () => {
  const catalog = getPptCatalog(root)
  const source = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8'))
  expect(catalog.templates.length).toBe(Object.keys(source).length)
  expect(catalog.templates.slice(0, 4).map(item => item.id)).toEqual(['ppt169_china_economy_2025_briefing', 'ppt169_qianli_jiangshan_scroll', 'ppt169_raft_consensus_deepdive', 'ppt169_ev_market_priorities'])
  expect(catalog.templates.find(item => item.id === 'dsh-cartesian')).toMatchObject({ title: '理性简报', category: '商务' })
  expect(catalog.templates.find(item => item.id === 'dsh-course-workshop')).toMatchObject({ title: '课程培训', category: '教学' })
  expect(catalog.templates.find(item => item.id === 'academic-research')?.category).toBe('学术')
  for (const item of catalog.templates) {
    expect(item.title).toMatch(/[\u3400-\u9fff]/)
    expect(['商务', '咨询', '学术', '教学', '技术', '创意', '社媒']).toContain(item.category)
    expect(item.referencePages.length).toBe(Math.min(2, item.pages - 1))
    for (const image of [item.cover, ...item.referencePages]) {
      const data = Buffer.from(image.split(',')[1]!, 'base64')
      expect(data.toString('ascii', 0, 4)).toBe('RIFF')
      expect(data.toString('ascii', 8, 12)).toBe('WEBP')
    }
  }
  expect(Buffer.byteLength(JSON.stringify({ type: 'response', result: catalog }))).toBeLessThan(DEFAULT_MAX_MESSAGE_BYTES)
  expect(getPptCatalog(root)).toBe(catalog)
})

test('lazy full previews match every real deck in numeric order within the RPC limit', () => {
  const source = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, { deck: string }>
  const display = JSON.parse(readFileSync(join(root, 'styles/picker.json'), 'utf8')) as { templates: Record<string, { previewId: string }> }
  for (const [id, entry] of Object.entries(source)) {
    const deck = JSON.parse(readFileSync(join(root, entry.deck), 'utf8'))
    const pages = getPptTemplatePages(id, root)
    expect(pages.length).toBe(deck.pages.length)
    expect(Buffer.byteLength(JSON.stringify({ type: 'response', result: pages }))).toBeLessThan(DEFAULT_MAX_MESSAGE_BYTES)
    pages.forEach((page, index) => {
      expect(Buffer.from(page.split(',')[1]!, 'base64')).toEqual(readFileSync(join(root, `styles/previews/pages/${display.templates[id]!.previewId}-${index + 1}.webp`)))
    })
  }
  expect(getPptTemplatePages('dsh-cartesian', root)).toHaveLength(12)
  expect(getPptTemplatePages('ppt169_china_economy_2025_briefing', root)).toHaveLength(17)
})

test('lazy full preview rejects unknown, traversal and inherited IDs', () => {
  for (const id of ['missing', '../dsh-cartesian', '/tmp/deck', '__proto__', 'constructor']) {
    expect(() => getPptTemplatePages(id, root)).toThrow('Unknown PPT template')
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
  expect(context).toContain('#123456')
  expect(context).toContain(join(session, 'data', 'deck.json'))
  expect(context).toContain('slide-01.png')
  const themeId = getPptCatalog(root).themes[0]!.id
  expect(validatePptRequest({ themeId }, root)).toEqual({ themeId })
  expect(readFileSync(join(session, 'attachments/ppt-brand/logo.png')).toString()).toBe('logo bytes')
  expect(prepared.ppt).toEqual(ppt)
})
