import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { listOfficeTemplates } from '../office-catalog'
import { officeDeliveryIssues, prepareOfficeTemplate, writeOfficeTemplate, type OfficeToolSession, type PrepareResult } from './service'

const businessRoot = join(import.meta.dir, '../../../../../apps/electron/resources/skills/office-business')
const templates = listOfficeTemplates(businessRoot)
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'word-contract-')); roots.push(root)
  const workspaceRoot = join(root, 'workspace'), storageDir = join(root, 'session')
  mkdirSync(workspaceRoot); mkdirSync(join(storageDir, 'data'), { recursive: true })
  const session: OfficeToolSession = { workspaceRoot, storageDir, businessRoot, templates: () => templates, office: () => null, canWrite: true, fonts: ['Calibri', '微软雅黑'] }
  writeFileSync(join(workspaceRoot, 'source.txt'), '第一段原文。\n第二段原文。')
  return session
}
function plan(prepared: PrepareResult, complete = true) {
  return { template_id: prepared.template_id, preparation_id: prepared.preparation_id, output_path: 'report.docx',
    replacements: prepared.editable_paragraphs.filter(p => p.text.includes('【')).map(p => ({ id: p.id, text: p.text.replace(/【[^】]+】/g, '用户提供的内容') })),
    additions: [{ after_paragraph_id: 'p7', style_from: 'p7', text: '第一段原文。' }, ...(complete ? [{ after_paragraph_id: 'p7', style_from: 'p7', text: '第二段原文。' }] : [])],
  }
}
const prepare = (s: OfficeToolSession) => prepareOfficeTemplate(s, { template_id: 'style-system-design', content_mode: 'verbatim', source_text_path: 'source.txt' })

test('preparation binds source across failed retries, omitted parameters, and host recreation', async () => {
  const s = setup(), prepared = await prepare(s)
  expect(prepared.content_contract?.mode).toBe('verbatim')
  await expect(writeOfficeTemplate(s, plan(prepared, false))).rejects.toThrow('原文完整性检查失败')
  expect(existsSync(join(s.workspaceRoot, 'report.docx'))).toBe(false)
  await expect(writeOfficeTemplate({ ...s }, { ...plan(prepared, false), preparation_id: undefined })).rejects.toThrow('原文完整性检查失败')
  const repeated = await prepareOfficeTemplate(s, { template_id: prepared.template_id })
  expect(repeated.preparation_id).toBe(prepared.preparation_id)
  const result = await writeOfficeTemplate(s, plan(prepared))
  expect(result.content_check.source_lines).toBe(2)
  expect(result.content_check.source_order).toBe('preserved')
  expect(result.verified).toContain('source-text-coverage-and-order')
  expect(result.unverified).toContain('visual-pagination')
  expect(result.tables).toEqual([{ table: 1, rows: 2, cells_per_row: [3, 3] }])
})

test('legacy write-time source binding upgrades the same preparation before a failed plan', async () => {
  const s = setup(), prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design' })
  await expect(writeOfficeTemplate(s, { ...plan(prepared, false), source_text_path: 'source.txt' })).rejects.toThrow('原文完整性检查失败')
  await expect(writeOfficeTemplate(s, plan(prepared, false))).rejects.toThrow('原文完整性检查失败')
  const result = await writeOfficeTemplate(s, plan(prepared))
  expect(result.preparation_id).toBe(prepared.preparation_id)
  expect(result.content_check.source_lines).toBe(2)
})

test('identical retries reuse saved receipts without rewriting; changed plans and files cannot reuse', async () => {
  const s = setup(), prepared = await prepare(s), request = plan(prepared)
  const first = await writeOfficeTemplate(s, request)
  const file = join(s.workspaceRoot, first.path), stamp = statSync(file).mtimeMs
  const second = await writeOfficeTemplate({ ...s }, { ...request, source_text_path: 'source.txt' })
  expect(first.reused).toBe(false); expect(second.reused).toBe(true)
  const reorderedKeys = JSON.parse(JSON.stringify(request, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value))
  expect((await writeOfficeTemplate(s, reorderedKeys)).reused).toBe(true)
  expect(second.sha256).toBe(first.sha256); expect(statSync(file).mtimeMs).toBe(stamp)
  await expect(writeOfficeTemplate(s, { ...request, additions: [...request.additions, { after_paragraph_id: 'p7', text: '新增' }] })).rejects.toThrow('output_path 已存在')
  const bytes = readFileSync(file), parts = unzipSync(bytes)
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']!).replace('第二段原文。', '删除了原文'))
  writeFileSync(file, zipSync(parts))
  await expect(writeOfficeTemplate(s, request)).rejects.toThrow('output_path 已存在')
  expect(officeDeliveryIssues(s, [file])[0]?.detail).toContain('原文完整性检查失败')
  writeFileSync(file, bytes)
  expect((await writeOfficeTemplate(s, request)).reused).toBe(true)
})

test('valid external changes invalidate the original write receipt instead of lending it to new bytes', async () => {
  const s = setup(), prepared = await prepare(s), request = plan(prepared)
  await writeOfficeTemplate(s, request)
  const file = join(s.workspaceRoot, 'report.docx'), parts = unzipSync(readFileSync(file))
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']!).replace('用户提供的内容', '用户新增内容'))
  writeFileSync(file, zipSync(parts))
  expect(officeDeliveryIssues(s, [file])).toEqual([])
  await expect(writeOfficeTemplate(s, request)).rejects.toThrow('output_path 已存在')
})

test('source changes are rejected even on cached writes; an explicit new authored task resets only its active binding', async () => {
  const s = setup(), prepared = await prepare(s)
  await writeOfficeTemplate(s, plan(prepared))
  writeFileSync(join(s.workspaceRoot, 'source.txt'), '变化了的原文')
  await expect(writeOfficeTemplate(s, plan(prepared))).rejects.toThrow('原文在准备后已变化')
  const authored = await prepareOfficeTemplate(s, { template_id: prepared.template_id, content_mode: 'authored' })
  const result = await writeOfficeTemplate(s, { ...plan(authored, false), output_path: 'summary.docx' })
  expect(result.content_check.source_lines).toBeUndefined()
  expect(result.unverified).toContain('source-text-coverage-no-bound-source')
  await expect(writeOfficeTemplate(s, { ...plan(prepared), output_path: 'old-task.docx' })).rejects.toThrow('原文在准备后已变化')
})

test('preparations do not cross workspace/template boundaries', async () => {
  const s = setup(), prepared = await prepare(s)
  const other = setup()
  await expect(writeOfficeTemplate({ ...s, workspaceRoot: other.workspaceRoot }, plan(prepared))).rejects.toThrow('preparation_id')
  await expect(writeOfficeTemplate(s, { ...plan(prepared), template_id: 'style-design-report' })).rejects.toThrow('preparation_id')
})

test('source and output path errors identify the right field; session-data sources are supported', async () => {
  const s = setup()
  await expect(prepareOfficeTemplate(s, { template_id: 'style-system-design', content_mode: 'verbatim' })).rejects.toThrow('必须提供 source_text_path')
  await expect(prepareOfficeTemplate(s, { template_id: 'style-system-design', content_mode: 'authored', source_text_path: 'source.txt' })).rejects.toThrow('不接受 source_text_path')
  await expect(prepareOfficeTemplate(s, { template_id: 'style-system-design', source_text_path: '/outside/source.txt' })).rejects.toThrow('source_text_path 无效')
  const source = join(s.storageDir, 'data', 'source.txt')
  writeFileSync(source, '第一段原文。\n第二段原文。')
  const prepared = await prepareOfficeTemplate(s, { template_id: 'style-system-design', content_mode: 'verbatim', source_text_path: source })
  await expect(writeOfficeTemplate(s, { ...plan(prepared), output_path: join(s.storageDir, 'data', 'report.docx') })).rejects.toThrow('output_path 无效')
  expect((await writeOfficeTemplate(s, plan(prepared))).content_check.source_lines).toBe(2)
  symlinkSync(source, join(s.workspaceRoot, 'linked.txt'))
  await expect(prepareOfficeTemplate(s, { template_id: 'style-system-design', source_text_path: 'linked.txt' })).rejects.toThrow('符号链接')
})

test('corrupt preparation records fail closed rather than silently skipping source checks', async () => {
  const s = setup(), prepared = await prepare(s)
  writeFileSync(join(s.storageDir, 'data', 'office-word-preparations.json'), '{broken')
  await expect(writeOfficeTemplate(s, plan(prepared))).rejects.toThrow('准备记录损坏')
})


test('two documents with the same template retain independent bound sources', async () => {
  const s = setup(), first = await prepare(s)
  writeFileSync(join(s.workspaceRoot, 'second.txt'), '另一份报告。')
  const second = await prepareOfficeTemplate(s, { template_id: first.template_id, content_mode: 'verbatim', source_text_path: 'second.txt' })
  expect((await writeOfficeTemplate(s, plan(first))).content_check.source_lines).toBe(2)
  const other = { ...plan(second), output_path: 'second.docx', additions: [{ after_paragraph_id: 'p7', style_from: 'p7', text: '另一份报告。' }] }
  expect((await writeOfficeTemplate(s, other)).content_check.source_lines).toBe(1)
  await expect(writeOfficeTemplate(s, { ...plan(first), preparation_id: undefined, output_path: 'ambiguous.docx' })).rejects.toThrow('原文完整性检查失败')
})


test('a new user request can edit existing prose without inheriting the previous conversion constraint', async () => {
  const s = { ...setup(), taskId: 'create-request' }, prepared = await prepare(s)
  await writeOfficeTemplate(s, plan(prepared))
  const path = join(s.workspaceRoot, 'report.docx'), parts = unzipSync(readFileSync(path))
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']!).replace('第二段原文。', '用户明确要求改为这句话。'))
  writeFileSync(path, zipSync(parts))
  expect(officeDeliveryIssues(s, [path])[0]?.detail).toContain('原文完整性检查失败')
  const next = { ...s, taskId: 'edit-request' }
  expect(officeDeliveryIssues(next, [path])).toEqual([])
  const authored = await prepareOfficeTemplate(next, { template_id: prepared.template_id })
  expect(authored.content_contract?.mode).toBe('authored')
  expect(authored.preparation_id).not.toBe(prepared.preparation_id)
})

test('explicit continuation of an earlier preparation binds retries in the new request too', async () => {
  const s = { ...setup(), taskId: 'first-request' }, prepared = await prepare(s)
  const resumed = { ...s, taskId: 'resume-request' }
  await expect(writeOfficeTemplate(resumed, plan(prepared, false))).rejects.toThrow('原文完整性检查失败')
  await expect(writeOfficeTemplate(resumed, { ...plan(prepared, false), preparation_id: undefined })).rejects.toThrow('原文完整性检查失败')
})


test('session-root generation rejects scratch outputs and publishes into outputs', async () => {
  const s = setup()
  s.workspaceRoot = s.storageDir
  writeFileSync(join(s.workspaceRoot, 'source.txt'), '第一段原文。\n第二段原文。')
  const prepared = await prepare(s)
  for (const folder of ['data', 'plans', 'long_responses']) {
    await expect(writeOfficeTemplate(s, { ...plan(prepared), output_path: `${folder}/report.docx` })).rejects.toThrow('最终产物不能写入会话临时目录')
    expect(existsSync(join(s.storageDir, folder, 'report.docx'))).toBe(false)
  }
  await writeOfficeTemplate(s, { ...plan(prepared), output_path: 'outputs/report.docx' })
  expect(existsSync(join(s.storageDir, 'outputs/report.docx'))).toBe(true)
})
