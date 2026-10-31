import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { OfficeDocumentState } from '@craft-agent/shared/protocol/office'
import { listOfficeTemplates } from '../office-catalog.ts'
import { readPrintSetup } from '../excel-delivery/page-setup.ts'
import { formatDeliveryIssues, officeDeliveryIssues, prepareOfficeTemplate, recalculateWorkspaceXlsx, writeOfficeTemplate, type OfficeToolSession } from './service.ts'
import { diagnoseFonts, documentFonts, parseFcList, parseMacFonts, parseWindowsFontRegistry } from './font-diagnostics.ts'

setDefaultTimeout(120_000)

const repoRoot = join(import.meta.dir, '../../../../..')
const businessRoot = join(repoRoot, 'apps/electron/resources/skills/office-business')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function session(office: OfficeDocumentState | null, overrides: Partial<OfficeToolSession> = {}): OfficeToolSession & { state: { office: OfficeDocumentState | null } } {
  const workspace = mkdtempSync(join(tmpdir(), 'office-ws-'))
  const storage = mkdtempSync(join(tmpdir(), 'office-session-'))
  temps.push(workspace, storage)
  const state = { office }
  const templates = listOfficeTemplates(businessRoot)
  return { workspaceRoot: workspace, storageDir: storage, office: () => state.office, templates: () => templates, businessRoot, canWrite: true, fonts: ['Arial'], xlsx: {}, state, ...overrides }
}

function revision(id: string): string {
  return listOfficeTemplates(businessRoot).find(item => item.id === id)!.revision
}

describe('office_template / office_template_write', () => {
  test('requires the selected case and write permission', async () => {
    await expect(prepareOfficeTemplate(session(null), { template_id: 'government-notice' })).rejects.toThrow('没有选中')
    const s = session({ mode: 'word', templateId: 'meeting-minutes', revision: revision('meeting-minutes') })
    await expect(prepareOfficeTemplate(s, { template_id: 'government-notice' })).rejects.toThrow('不是 government-notice')
    await expect(prepareOfficeTemplate({ ...s, canWrite: false }, { template_id: 'meeting-minutes' })).rejects.toThrow('写权限')
    await expect(prepareOfficeTemplate(session({ mode: 'word', templateId: 'meeting-minutes', revision: 'old' }), { template_id: 'meeting-minutes' })).rejects.toThrow('已更新')
  })

  for (const id of ['government-notice', 'meeting-minutes', 'coffee-market', 'equity-research']) {
    test(`${id}: copy is sha256-verified, write produces a new DOCX that passes the guard, original unchanged`, async () => {
      const original = join(businessRoot, 'cases', id, 'example.docx')
      const before = sha(readFileSync(original))
      const s = session({ mode: 'word', templateId: id, revision: revision(id) })
      const prepared = await prepareOfficeTemplate(s, { template_id: id })
      expect(prepared.reference_dir).toContain(`office-templates/${id}-`)
      expect(prepared.files.length).toBeGreaterThan(1)
      for (const file of prepared.files) expect(sha(readFileSync(file.workspace_path))).toBe(file.sha256)
      const removable = prepared.editable_paragraphs.filter(p => p.can_remove && p.text.trim() && p.runs.length === 1)
      const header = id === 'government-notice' ? [{ id: 'p1', text: '某某集团有限公司文件' }] : []
      const result = await writeOfficeTemplate(s, {
        output_path: 'out/成稿.docx',
        replacements: [...header, { paragraph_id: removable[0]!.id, text: '新的标题' }],
        additions: [{ after_paragraph_id: removable[1]!.id, style_from: removable[1]!.id, text: '新增一段，继承原样式。' }],
        removals: [removable[2]!.id],
      })
      expect(result.checks).toHaveLength(7)
      expect(result.path).toBe('out/成稿.docx')
      const output = join(s.workspaceRoot, 'out/成稿.docx')
      expect(officeDeliveryIssues(s, [output])).toEqual([])
      expect(sha(readFileSync(original))).toBe(before)
      await expect(writeOfficeTemplate(s, { output_path: 'out/成稿.docx', replacements: [...header] })).rejects.toThrow('已存在')
    })
  }

  test('selection change during copy invalidates the copy', async () => {
    const s = session({ mode: 'word', templateId: 'meeting-minutes', revision: revision('meeting-minutes') })
    let calls = 0
    const flaky = { ...s, office: () => (calls++ === 0 ? s.state.office : { mode: 'word' as const }) }
    await expect(prepareOfficeTemplate(flaky, { template_id: 'meeting-minutes' })).rejects.toThrow('作废')
    expect(readdirSync(join(s.storageDir, 'data', 'office-templates'))).toEqual([])
  })

  test('output must stay inside the workspace', async () => {
    const s = session({ mode: 'word', templateId: 'meeting-minutes', revision: revision('meeting-minutes') })
    await expect(writeOfficeTemplate(s, { output_path: '../escape.docx', replacements: [{ id: 'p0', text: 'x' }] })).rejects.toThrow('工作区')
    await expect(writeOfficeTemplate(s, { output_path: '/etc/x.docx', replacements: [{ id: 'p0', text: 'x' }] })).rejects.toThrow('工作区')
    await expect(writeOfficeTemplate(s, { output_path: 'a.doc', replacements: [{ id: 'p0', text: 'x' }] })).rejects.toThrow('扩展名')
  })
})

describe('delivery guard (needs_revision loop)', () => {
  test('a DOCX with changed margins is denied with readable diagnostics, and passes after revision', async () => {
    const s = session({ mode: 'word', templateId: 'meeting-minutes', revision: revision('meeting-minutes') })
    await prepareOfficeTemplate(s, { template_id: 'meeting-minutes' })
    await writeOfficeTemplate(s, { output_path: '纪要.docx', replacements: [{ paragraph_id: 'p0', text: '新纪要' }] })
    const path = join(s.workspaceRoot, '纪要.docx')
    const good = readFileSync(path)
    const files = unzipSync(good)
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']!).replace(/(<w:pgMar\b[^>]*\bw:left=")(\d+)"/, (_a, h: string, v: string) => `${h}${Number(v) + 400}"`))
    writeFileSync(path, zipSync(files))
    const issues = officeDeliveryIssues(s, [path])
    expect(issues).toHaveLength(1)
    const text = formatDeliveryIssues(issues)
    expect(text).toStartWith('needs_revision')
    expect(text).toContain('页边距')
    expect(text).toContain('修复：')
    // revision round: rewrite from the template and the guard passes
    writeFileSync(path, good)
    expect(officeDeliveryIssues(s, [path])).toEqual([])
  })

  test('Excel workbooks with formulas must be recalculated for the current bytes', async () => {
    const s = session({ mode: 'excel', templateId: 'port-cargo', revision: revision('port-cargo') })
    const prepared = await prepareOfficeTemplate(s, { template_id: 'port-cargo' })
    const path = prepared.workspace_path
    expect(path.startsWith(s.workspaceRoot)).toBe(true)
    expect(officeDeliveryIssues(s, [path])[0]?.summary).toContain('xlsx_recalculate')
    const result = await recalculateWorkspaceXlsx(s, { path, visual_review: 'not-needed' })
    expect(result.ready).toBe(true)
    expect(result.checks?.passed).toBe(true)
    expect(officeDeliveryIssues(s, [path])).toEqual([])
    writeFileSync(path, Buffer.concat([readFileSync(path)]))
    const bytes = unzipSync(readFileSync(path))
    bytes['docProps/x.xml'] = strToU8('<x/>')
    writeFileSync(path, zipSync(bytes))
    expect(officeDeliveryIssues(s, [path])[0]?.summary).toContain('又被修改')
  })

  test('annual-business without checks.json needs a dual read; mismatched caches are reported', async () => {
    const s = session({ mode: 'excel', templateId: 'annual-business', revision: revision('annual-business') })
    const prepared = await prepareOfficeTemplate(s, { template_id: 'annual-business' })
    const missing = await recalculateWorkspaceXlsx(s, { path: prepared.workspace_path, visual_review: 'not-needed' })
    expect(missing.ready).toBe(false)
    expect(missing.code).toBe('dual-read-missing')
    expect(officeDeliveryIssues(s, [prepared.workspace_path])).toHaveLength(1)
    const ok = await recalculateWorkspaceXlsx(s, { path: prepared.workspace_path, key_cells: ['增长质量!N62', '增长测算!C100'], visual_review: 'not-needed' })
    expect(ok.dualRead.every(cell => cell.ok)).toBe(true)
    expect(ok.ready).toBe(true)
    const unreviewed = await recalculateWorkspaceXlsx(s, { path: prepared.workspace_path, key_cells: ['增长质量!N62'], visual_review: 'reviewed', blank_page: true })
    expect(unreviewed.code).toBe('blank-page')
  })
})

describe('annual-business page setup sample extension', () => {
  test('working copy gets A3, fit to 1 page wide and print areas; the case file is untouched', async () => {
    const original = join(businessRoot, 'cases/annual-business/example.xlsx')
    const before = sha(readFileSync(original))
    const s = session({ mode: 'excel', templateId: 'annual-business', revision: revision('annual-business') })
    const prepared = await prepareOfficeTemplate(s, { template_id: 'annual-business' })
    expect(prepared.sample_extensions).toHaveLength(1)
    const setup = readPrintSetup(readFileSync(prepared.workspace_path))
    expect(setup).toHaveLength(6)
    for (const sheet of setup) {
      expect(sheet.paperSize).toBe('8')
      expect(sheet.fitToWidth).toBe('1')
      expect(sheet.fitToHeight).toBe('0')
      expect(sheet.fitToPage).toBe(true)
      expect(sheet.printArea).toMatch(/^'.+'!\$A\$1:\$P\$\d+$/)
    }
    expect(setup.find(sheet => sheet.sheet === '经营总览')!.printArea).toBe("'经营总览'!$A$1:$P$468")
    expect(sha(readFileSync(original))).toBe(before)
    expect(readPrintSetup(readFileSync(original)).every(sheet => !sheet.printArea && !sheet.paperSize)).toBe(true)
  })

  test('bio-assay 原始读数 and port-cargo 日度汇总 / 作业明细 keep their 45-row print areas', async () => {
    for (const [id, sheets] of [['bio-assay', { 原始读数: "'原始读数'!$A$1:$G$46" }], ['port-cargo', { 日度汇总: "'日度汇总'!$A$1:$H$46", 作业明细: "'作业明细'!$A$1:$L$46" }]] as const) {
      const s = session({ mode: 'excel', templateId: id, revision: revision(id) })
      const prepared = await prepareOfficeTemplate(s, { template_id: id })
      expect(prepared.sample_extensions).toEqual([])
      expect(sha(readFileSync(prepared.workspace_path))).toBe(sha(readFileSync(join(businessRoot, 'cases', id, 'example.xlsx'))))
      const setup = readPrintSetup(readFileSync(prepared.workspace_path))
      for (const [sheet, area] of Object.entries(sheets)) expect(setup.find(item => item.sheet === sheet)!.printArea).toBe(area)
    }
  })
})

describe('missing-font diagnostics (Lola regressions)', () => {
  const lola = ['FangS-SC', 'ShuS-SC', 'HYKaiTiJ', 'PingFang SC', 'Hiragino Sans GB', 'Helvetica', 'Arial', 'Calibri']

  test('仿宋_GB2312 → FangS-SC, Noto Sans CJK SC missing, Carlito missing are all reported', () => {
    const warnings = diagnoseFonts([
      { name: '仿宋_GB2312', embedded: false },
      { name: 'Noto Sans CJK SC', embedded: false },
      { name: 'Carlito', embedded: false },
      { name: 'Arial', embedded: false },
    ], lola)
    expect(warnings.map(w => [w.font, w.status, w.substitute])).toEqual([
      ['仿宋_GB2312', 'missing', 'FangS-SC'],
      ['Noto Sans CJK SC', 'missing', 'PingFang SC'],
      ['Carlito', 'missing', 'Calibri'],
    ])
    expect(warnings[0]!.message).toContain('FangS-SC')
  })

  test('lists fonts used by the Word and Excel cases', () => {
    const notice = documentFonts(readFileSync(join(businessRoot, 'cases/government-notice/example.docx')))
    expect(notice.map(font => font.name)).toEqual(expect.arrayContaining(['FangS-SC', 'ShuS-SC', 'HYKaiTiJ', 'HYZhongJianHeiJ']))
    expect(notice.find(font => font.name === 'FangS-SC')?.embedded).toBe(true)
    const coffee = documentFonts(readFileSync(join(businessRoot, 'cases/coffee-market/example.docx')))
    expect(diagnoseFonts(coffee, lola).some(w => w.font === 'Noto Sans CJK SC' && w.status === 'missing')).toBe(true)
    const port = documentFonts(readFileSync(join(businessRoot, 'cases/port-cargo/example.xlsx')))
    expect(port.map(font => font.name)).toContain('Noto Sans CJK SC')
  })

  test('parses macOS system_profiler, Windows registry and fc-list output', () => {
    expect(parseMacFonts(JSON.stringify({ SPFontsDataType: [{ _name: 'a.ttf', typefaces: [{ family: 'FangS-SC', fullname: 'FangS-SC Regular' }] }] }))).toEqual(['FangS-SC', 'FangS-SC Regular'])
    expect(parseWindowsFontRegistry('HKEY_LOCAL_MACHINE\\...\\Fonts\r\n    SimSun & NSimSun (TrueType)    REG_SZ    simsun.ttc\r\n    Arial (TrueType)    REG_SZ    arial.ttf\r\n')).toEqual(['SimSun', 'NSimSun', 'Arial'])
    expect(parseFcList('Noto Sans CJK SC,Noto Sans CJK SC Regular\nDejaVu Sans\n')).toEqual(['Noto Sans CJK SC', 'Noto Sans CJK SC Regular', 'DejaVu Sans'])
  })
})

