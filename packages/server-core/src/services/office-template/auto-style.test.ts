import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { listOfficeTemplates } from '../office-catalog'
import { officeDeliveryIssues, prepareOfficeTemplate, writeOfficeTemplate, workspacePath, type OfficeToolSession } from './service'
import type { OfficeDocumentState } from '@craft-agent/shared/protocol/office'

const businessRoot = join(import.meta.dir, '../../../../../apps/electron/resources/skills/office-business')
const templates = listOfficeTemplates(businessRoot)
const styles = templates.filter(t => t.autoSelect)
const temporary: string[] = []
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function session(): OfficeToolSession {
  const root = mkdtempSync(join(tmpdir(), 'auto-word-'))
  temporary.push(root)
  return { workspaceRoot: root, storageDir: root, businessRoot, templates: () => templates, office: () => null, canWrite: true, fonts: ['Calibri', 'Cambria', '微软雅黑', '宋体'] }
}
const fill = (text: string) => text.replace(/【[^】]+】/g, '用户提供的真实内容')

test('the seven native styles are available to ordinary chat', () => {
  expect(styles.map(style => style.id)).toEqual([
    'style-design-report',
    'style-experiment-analysis',
    'style-investment-memo',
    'style-legal-memo',
    'style-minimal-letter',
    'style-strategy-memo',
    'style-system-design',
  ])
  expect(styles.every(style => style.autoSelect && style.mode === 'word' && style.category === '文档样式')).toBe(true)
  const guide = readFileSync(join(businessRoot, '../officecli/guides/word.md'), 'utf8')
  for (const style of styles) expect(guide).toContain(style.id)
  expect(guide).toContain('仅修改已有文件时不自动选新模板')
  expect(guide).toContain('立即交付')
})
for (const style of styles) {
  test(`${style.id}: ordinary chat prepare/write, inherited additions, exact-byte delivery reuse`, async () => {
    const s = session()
    const source = readFileSync(join(businessRoot, style.source, style.sampleFile))
    const before = source.toString('base64')
    const prepared = await prepareOfficeTemplate(s, { template_id: style.id })
    const body = prepared.editable_paragraphs.find(p => p.text.includes('内容】'))!
    const result = await writeOfficeTemplate(s, {
      template_id: prepared.template_id, output_path: '报告.docx',
      replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })),
      additions: [{ after_paragraph_id: body.id, style_from: body.id, text: '补充中文与 English 内容，保留【用户自定义标记】。' }],
    })
    expect(result.status).toBe('ready')
    expect(result.next_action).toContain('直接交付')
    expect(prepared.editable_paragraphs.every(p => 'style_id' in p)).toBe(true)
    expect(result.checks).toHaveLength(7)
    expect(s.office()).toBeNull()
    expect(officeDeliveryIssues(s, [join(s.workspaceRoot, result.path)])).toEqual([])
    expect(readFileSync(join(businessRoot, style.source, style.sampleFile)).toString('base64')).toBe(before)
    const parts = unzipSync(readFileSync(join(s.workspaceRoot, result.path)))
    const original = unzipSync(source)
    for (const part of ['word/styles.xml', 'word/footer1.xml']) expect(parts[part]).toEqual(original[part])
    const xml = strFromU8(parts['word/document.xml']!)
    expect(xml).toContain('用户自定义标记')
    // Changing the artifact invalidates the cached check even outside Office mode.
    parts['word/document.xml'] = strToU8(xml.replace('w:left="1440"', 'w:left="2440"'))
    writeFileSync(join(s.workspaceRoot, result.path), zipSync(parts))
    expect(officeDeliveryIssues(s, [join(s.workspaceRoot, result.path)])[0]?.summary).toContain('页边距')
  })
}

test('explicit choice / Excel mode / read-only cannot be overridden by automatic styles', async () => {
  const s = session()
  const chosen = templates.find(t => t.id === 'meeting-minutes')!
  for (const state of [{ mode: 'word', templateId: chosen.id, revision: chosen.revision }, { mode: 'excel' }] as OfficeDocumentState[]) {
    await expect(prepareOfficeTemplate({ ...s, office: () => state }, { template_id: styles[0]!.id })).rejects.toThrow()
  }
  await expect(prepareOfficeTemplate({ ...s, canWrite: false }, { template_id: styles[0]!.id })).rejects.toThrow('写权限')
  await expect(prepareOfficeTemplate(s, { template_id: '../other' })).rejects.toThrow('没有选中')
})

test('automatic writes require template ID, reject leftovers, preserve existing outputs', async () => {
  const s = session()
  const id = styles[0]!.id
  await expect(writeOfficeTemplate(s, { output_path: 'draft.docx', replacements: [] })).rejects.toThrow('没有选中')
  await expect(writeOfficeTemplate(s, { template_id: id, output_path: 'draft.docx', replacements: [] })).rejects.toThrow('占位符')
  expect(existsSync(join(s.workspaceRoot, 'draft.docx'))).toBe(false)
  writeFileSync(join(s.workspaceRoot, 'draft.docx'), 'existing')
  await expect(writeOfficeTemplate(s, { template_id: id, output_path: 'draft.docx', replacements: [] })).rejects.toThrow('已存在')
  expect(readFileSync(join(s.workspaceRoot, 'draft.docx'), 'utf8')).toBe('existing')
})

test('several documents retain individual template provenance across composer changes', async () => {
  const s = session()
  const paths: string[] = []
  for (const style of styles.slice(0, 2)) {
    const prepared = await prepareOfficeTemplate(s, { template_id: style.id })
    const output = await writeOfficeTemplate(s, { template_id: style.id, output_path: `${style.id}.docx`, replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })) })
    paths.push(join(s.workspaceRoot, output.path))
  }
  const other = templates.find(t => t.id === 'meeting-minutes')!
  expect(officeDeliveryIssues({ ...s, office: () => ({ mode: 'word', templateId: other.id, revision: other.revision }) }, paths)).toEqual([])
})

test('a selection changed during automatic prepare invalidates the scratch copy', async () => {
  const s = session()
  let reads = 0
  await expect(prepareOfficeTemplate({ ...s, office: () => reads++ === 0 ? null : { mode: 'excel' } }, { template_id: styles[0]!.id })).rejects.toThrow('作废')
})

test('composer selection does not force its layout onto an unrelated existing file', () => {
  const s = session()
  const t = templates.find(t => t.id === 'meeting-minutes')!
  const file = join(s.workspaceRoot, '用户原稿.docx')
  writeFileSync(file, readFileSync(join(businessRoot, 'cases/style-minimal-letter/example.docx')))
  expect(officeDeliveryIssues({ ...s, office: () => ({ mode: 'word', templateId: t.id, revision: t.revision }) }, [file])).toEqual([])
})

test('automatic templates expose native files and preview pages through the catalog', async () => {
  const { officeTemplatePreview } = await import('../office-catalog')
  for (const style of styles) {
    const native = officeTemplatePreview(style.id, style.revision, undefined, templates, businessRoot)
    const preview = officeTemplatePreview(style.id, style.revision, 1, templates, businessRoot)
    expect(native.available).toBe(true)
    expect(preview.available).toBe(true)
    expect(native.path).toBe(`cases/${style.id}/example.docx`)
  }
})

test('a valid post-write edit refreshes the digest instead of repeating its check on every delivery', async () => {
  const s = session()
  const id = styles[0]!.id
  const prepared = await prepareOfficeTemplate(s, { template_id: id })
  await writeOfficeTemplate(s, { template_id: id, output_path: 'edited.docx', replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })) })
  const file = join(s.workspaceRoot, 'edited.docx')
  const recordPath = join(s.storageDir, 'data/office-deliveries.json')
  const before = readFileSync(recordPath, 'utf8')
  const parts = unzipSync(readFileSync(file))
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']!).replace('用户提供的真实内容', '修改后的真实内容'))
  writeFileSync(file, zipSync(parts))
  expect(officeDeliveryIssues(s, [file])).toEqual([])
  const after = readFileSync(recordPath, 'utf8')
  expect(after).not.toBe(before)
  expect(officeDeliveryIssues(s, [file])).toEqual([])
  expect(readFileSync(recordPath, 'utf8')).toBe(after)
})

test('workspace root alias is normalized without permitting child symlinks', () => {
  const s = session()
  const alias = s.workspaceRoot + '-alias'
  temporary.push(alias)
  symlinkSync(s.workspaceRoot, alias, 'dir')
  expect(workspacePath(alias, join(alias, 'report.docx'), /\.docx$/, true).absolute).toBe(join(realpathSync(s.workspaceRoot), 'report.docx'))
  symlinkSync(s.workspaceRoot, join(s.workspaceRoot, 'child'), 'dir')
  expect(() => workspacePath(alias, join(alias, 'child/report.docx'), /\.docx$/, true)).toThrow('符号链接')
})

test('before/after insertions preserve order, source coverage and the original template style', async () => {
  const s = session()
  const prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design' })
  expect(prepared.editable_paragraphs.find(p => p.id === 'p13')?.location).toEqual({ kind: 'table-cell', table: 1, row: 2, cell: 1 })
  expect(prepared.editable_paragraphs.find(p => p.id === 'p16')?.location).toEqual({ kind: 'body' })
  const replacements = prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) }))
  writeFileSync(join(s.workspaceRoot, 'source.txt'), '表后第一段。\n表后第二段。\n标题后正文。')
  const result = await writeOfficeTemplate(s, { template_id: prepared.template_id, output_path: 'before.docx', source_text_path: 'source.txt', replacements,
    additions: [
      { before_paragraph_id: 'p16', style_from: 'p7', text: '表后第一段。' },
      { before_paragraph_id: 'p16', style_from: 'p7', text: '表后第二段。' },
      { after_paragraph_id: 'p16', style_from: 'p7', text: '标题后正文。' },
    ],
  })
  expect(result.content_check.serialized_text).toBe('passed')
  expect(result.content_check.source_lines).toBe(3)
  expect(result.content_check.source_order).toBe('preserved')
  const xml = strFromU8(unzipSync(readFileSync(join(s.workspaceRoot, result.path)))['word/document.xml']!)
  expect(xml.indexOf('</w:tbl>')).toBeLessThan(xml.indexOf('表后第一段。'))
  expect(xml.indexOf('表后第一段。')).toBeLessThan(xml.indexOf('表后第二段。'))
  expect(xml.indexOf('表后第二段。')).toBeLessThan(xml.indexOf('方案与关键设计'))
  expect(xml.indexOf('方案与关键设计')).toBeLessThan(xml.indexOf('标题后正文。'))
  expect(officeDeliveryIssues(s, [join(s.workspaceRoot, result.path)])).toEqual([])
  await expect(writeOfficeTemplate(s, { template_id: prepared.template_id, output_path: 'missing.docx', source_text_path: 'source.txt', replacements })).rejects.toThrow('原文完整性检查失败')
  expect(existsSync(join(s.workspaceRoot, 'missing.docx'))).toBe(false)
  await expect(writeOfficeTemplate(s, { template_id: prepared.template_id, output_path: 'ambiguous.docx', replacements,
    additions: [{ before_paragraph_id: 'p16', after_paragraph_id: 'p7', text: 'bad' }],
  })).rejects.toThrow('只能指定')
})

test('running content ignores serializer IDs but preserves literal footer text and PAGE field', async () => {
  const s = session()
  const prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design' })
  const result = await writeOfficeTemplate(s, { template_id: prepared.template_id, output_path: 'footer.docx', replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })) })
  const path = join(s.workspaceRoot, result.path)
  const parts = unzipSync(readFileSync(path))
  const original = strFromU8(parts['word/footer1.xml']!)
  const serialized = original.replace('<w:p>', '<w:p xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:paraId="00100088" w14:textId="00100089">').replaceAll('/>', ' />')
  parts['word/footer1.xml'] = strToU8(serialized)
  writeFileSync(path, zipSync(parts))
  expect(officeDeliveryIssues(s, [path])).toEqual([])
  parts['word/footer1.xml'] = strToU8(serialized.replace('SYSTEM DESIGN', 'CHANGED'))
  writeFileSync(path, zipSync(parts))
  expect(officeDeliveryIssues(s, [path])[0]?.summary).toContain('页脚')
  parts['word/footer1.xml'] = strToU8(serialized.replace('w:instr="PAGE"', 'w:instr="DATE"'))
  writeFileSync(path, zipSync(parts))
  expect(officeDeliveryIssues(s, [path])[0]?.summary).toContain('页脚')
})


test('source coverage rejects a missing repeated line and reads only workspace files', async () => {
  const s = session()
  const prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design' })
  const plan = { template_id: prepared.template_id, output_path: 'checked.docx', source_text_path: 'source.txt',
    replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })),
    additions: [{ after_paragraph_id: 'p7', style_from: 'p7', text: '重复的原文。' }],
  }
  writeFileSync(join(s.workspaceRoot, 'source.txt'), '重复的原文。\n重复的原文。')
  await expect(writeOfficeTemplate(s, plan)).rejects.toThrow('原文完整性检查失败')
  expect(existsSync(join(s.workspaceRoot, 'checked.docx'))).toBe(false)
  const result = await writeOfficeTemplate(s, { ...plan, additions: [...plan.additions, ...plan.additions] })
  expect(result.content_check.source_lines).toBe(2)
  const outside = session()
  writeFileSync(join(outside.workspaceRoot, 'source.txt'), '重复的原文。')
  await expect(writeOfficeTemplate(s, { ...plan, output_path: 'outside.docx', source_text_path: join(outside.workspaceRoot, 'source.txt') })).rejects.toThrow()
  symlinkSync(join(outside.workspaceRoot, 'source.txt'), join(s.workspaceRoot, 'linked.txt'))
  await expect(writeOfficeTemplate(s, { ...plan, output_path: 'linked.docx', source_text_path: 'linked.txt' })).rejects.toThrow('符号链接')
})


test('verbatim source coverage rejects reordered text before writing the artifact', async () => {
  const s = session()
  const prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design' })
  writeFileSync(join(s.workspaceRoot, 'source.txt'), '先讲问题。\n再讲方案。')
  await expect(writeOfficeTemplate(s, { template_id: prepared.template_id, output_path: 'reordered.docx', source_text_path: 'source.txt',
    replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: fill(p.text) })),
    additions: [{ after_paragraph_id: 'p7', style_from: 'p7', text: '再讲方案。' }, { after_paragraph_id: 'p7', style_from: 'p7', text: '先讲问题。' }],
  })).rejects.toThrow('顺序不符')
  expect(existsSync(join(s.workspaceRoot, 'reordered.docx'))).toBe(false)
})
