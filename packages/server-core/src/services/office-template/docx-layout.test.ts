import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { strFromU8, strToU8, zipSync } from 'fflate'
import {
  DocxPlanError,
  editDocx,
  formatLayoutDiagnostics,
  inventoryDocx,
  normalizeDocx,
  validateDocx,
  validateDocxAgainstTemplate,
  writeDocxFromTemplate,
  type DocxEditPlan,
  type DocxProfile,
} from './docx-layout.ts'
import { readOoxmlPackage, readXmlPart, writeOoxmlPackage, type OoxmlParts } from './ooxml-package.ts'
import { canonical, parseXml } from './xml-tree.ts'

const repoRoot = join(import.meta.dir, '../../../../..')
const cases = join(repoRoot, 'apps/electron/resources/skills/office-business/cases')
const goldens = JSON.parse(readFileSync(join(repoRoot, 'scripts/fixtures/office-parity/docx-layout/goldens.json'), 'utf8')) as {
  sha256: string
  cases: Record<string, {
    inventorySha256: string
    paragraphs: number
    sourceCanonicalSha256: string
    identity: { checks?: string[]; error?: string }
    plan: DocxEditPlan
    editCanonicalSha256: string
    edit: { checks?: string[]; error?: string }
    mutations: Record<string, { checks?: string[]; error?: string }>
    protectedRemoval: { id: string; error: string }
  }>
}
setDefaultTimeout(60_000)

const WORD_CASES = ['government-notice', 'meeting-minutes', 'coffee-market', 'equity-research'] as const

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const canonicalSha = (parts: OoxmlParts) => sha(canonical(readXmlPart(parts, 'word/document.xml').root))

function load(id: string): { bytes: Uint8Array; profile: DocxProfile | null } {
  const profilePath = join(cases, id, 'generation.json')
  return {
    bytes: readFileSync(join(cases, id, 'example.docx')),
    profile: existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) as DocxProfile : null,
  }
}

function mutate(parts: OoxmlParts, kind: string): OoxmlParts {
  const next = { ...parts }
  if (kind === 'delete-footer') {
    delete next[Object.keys(next).filter(name => name.startsWith('word/footer')).sort()[0]!]
    return next
  }
  let doc = strFromU8(next['word/document.xml']!)
  if (kind === 'margins') doc = doc.replace(/(<w:pgMar\b[^>]*\bw:top=")(\d+)"/, (_all, head: string, value: string) => `${head}${Number(value) + 200}"`)
  if (kind === 'font') doc = doc.replace(/w:eastAsia="([^"]+)"/, 'w:eastAsia="Comic Sans MS"')
  next['word/document.xml'] = strToU8(doc)
  return next
}

function firstError(report: ReturnType<typeof validateDocx>): { checks?: string[]; error?: string } {
  return report.ok ? { checks: report.checks } : { error: report.diagnostics[0]!.dsh }
}

describe('docx-layout parity with dsh 588412b docx-layout.py', () => {
  for (const id of WORD_CASES) {
    test(`${id}: inventory, edit and validate match the golden`, () => {
      const golden = goldens.cases[id]!
      const { bytes, profile } = load(id)
      const source = normalizeDocx(readOoxmlPackage(bytes), profile)
      expect(canonicalSha(source)).toBe(golden.sourceCanonicalSha256)
      const inventory = inventoryDocx(source, profile)
      expect(inventory.length).toBe(golden.paragraphs)
      expect(sha(JSON.stringify(inventory))).toBe(golden.inventorySha256)
      expect(firstError(validateDocx(source, source, profile))).toEqual(golden.identity)
      const edited = editDocx(source, profile, golden.plan)
      expect(canonicalSha(edited)).toBe(golden.editCanonicalSha256)
      expect(firstError(validateDocx(source, edited, profile))).toEqual(golden.edit)
      for (const [kind, expected] of Object.entries(golden.mutations)) {
        expect(firstError(validateDocx(source, mutate(edited, kind), profile))).toEqual(expected)
      }
      let thrown: unknown
      try { editDocx(source, profile, { ...golden.plan, removals: [golden.protectedRemoval.id] }) } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(DocxPlanError)
      expect((thrown as DocxPlanError).dsh).toBe(golden.protectedRemoval.error)
    })
  }
})

describe('Word template-faithful write', () => {
  test('T1 government-notice: header, title, 3 key-work paragraphs, 1 inherited addition, 1 removal; guard passes; template unchanged', () => {
    const { bytes, profile } = load('government-notice')
    const before = sha(bytes)
    const { bytes: output, report } = writeDocxFromTemplate(bytes, profile, goldens.cases['government-notice']!.plan)
    expect(report.ok).toBe(true)
    expect(report.checks).toHaveLength(7)
    expect(sha(readFileSync(join(cases, 'government-notice', 'example.docx')))).toBe(before)
    const parts = readOoxmlPackage(output)
    const inventory = inventoryDocx(parts, profile)
    expect(inventory.map(p => p.text)).toContain('（八）开展总结评估。活动结束后形成书面总结，报送公司安全部门。')
    expect(inventory.some(p => p.text.startsWith('吉林省文件要求'))).toBe(false)
    expect(inventory[1]!.text).toBe('中国中车集团有限公司文件')
    // The addition inherits the list paragraph's pPr and run rPr.
    const added = inventory.find(p => p.text.startsWith('（八）'))!
    expect(added.runs.map(r => r.fonts)).toEqual(['FangS-SC,FangS-SC', 'HYKaiTiJ,HYKaiTiJ', 'FangS-SC,FangS-SC'])
    expect(validateDocxAgainstTemplate(bytes, profile, output).ok).toBe(true)
  })

  test('T2 meeting-minutes: five new action rows keep table borders and column widths', () => {
    const { bytes, profile } = load('meeting-minutes')
    const rows = Array.from({ length: 5 }, (_, index) => ({
      after_paragraph_id: 'p96',
      cells: [[`${16 + index}. 新增行动项 ${index + 1}`, '交付：补充材料', '来源：会议记录'], '运营', '待确认'],
    }))
    const { bytes: output, report } = writeDocxFromTemplate(bytes, profile, { replacements: [{ paragraph_id: 'p0', text: '新版发布会筹备会议纪要' }], row_additions: rows })
    expect(report.ok).toBe(true)
    const source = readOoxmlPackage(bytes)
    const result = readOoxmlPackage(output)
    const grid = (parts: OoxmlParts) => strFromU8(parts['word/document.xml']!).match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0]
    expect(grid(result)).toBe(grid(source))
    const tblPr = (parts: OoxmlParts) => canonical(parseXml(strFromU8(parts['word/document.xml']!).match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)![0]).root)
    expect(tblPr(result)).toBe(tblPr(source))
    const rowCount = (parts: OoxmlParts) => (strFromU8(parts['word/document.xml']!).match(/<w:tr[ >]/g) ?? []).length
    expect(rowCount(result)).toBe(rowCount(source) + 5)
    const texts = inventoryDocx(result, profile).map(p => p.text)
    expect(texts.indexOf('16. 新增行动项 1')).toBeGreaterThan(texts.indexOf('明天（建议）'))
    expect(texts).toContain('20. 新增行动项 5')
    // G6：dsh §5 的纪要细节由模板继承下来，新增行不得破坏。
    const xml = strFromU8(result['word/document.xml']!)
    const styles = strFromU8(result['word/styles.xml']!)
    expect(styles.match(/<w:style [^>]*w:styleId="Title"[\s\S]*?<\/w:style>/)?.[0]).not.toContain('pBdr')
    expect(new Set(xml.match(/<w:snapToGrid [^>]*>/g))).toEqual(new Set(['<w:snapToGrid w:val="false"/>']))
    const gridCols = [...grid(result)!.matchAll(/w:w="(\d+)"/g)].map(m => m[1])
    for (const row of xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
      expect([...row.matchAll(/<w:tcW [^>]*w:w="(\d+)"/g)].map(m => m[1])).toEqual(gridCols)
    }
    const table = xml.match(/<w:tbl>[\s\S]*<\/w:tbl>/)![0]
    expect(new Set(table.match(/<w:spacing [^>]*>/g))).toEqual(new Set(['<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>']))
  })

  test('T3 negatives: protected paragraph removal is refused; changed margins, deleted footer and swapped font are blocked with readable diagnostics', () => {
    const { bytes, profile } = load('government-notice')
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [{ id: 'p1', text: '某公司文件' }], removals: ['p2'] })).toThrow(/受保护/)
    const { bytes: output } = writeDocxFromTemplate(bytes, profile, { replacements: [{ id: 'p1', text: '某公司文件' }] })
    const parts = readOoxmlPackage(output)
    for (const [kind, check, words] of [
      ['margins', 'page-geometry', '页边距'],
      ['delete-footer', 'embedded-fonts-and-running-content', '页脚'],
      ['font', 'template-font-assignments', 'Comic Sans MS'],
    ] as const) {
      const report = validateDocxAgainstTemplate(bytes, profile, writeOoxmlPackage(mutate(parts, kind)))
      expect(report.ok).toBe(false)
      expect(report.diagnostics[0]!.check).toBe(check)
      const text = formatLayoutDiagnostics('通知.docx', report)
      expect(text).toContain(words)
      expect(text).toContain('修复：')
    }
  })

  test('plan errors: unknown ID (zero hit), duplicate ID, bad run fragments and missing issuer header', () => {
    const { bytes, profile } = load('government-notice')
    const header = { id: 'p1', text: '某公司文件' }
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [header, { id: 'p999', text: 'x' }] })).toThrow(/不存在/)
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [header, { id: 'p3', text: 'a' }, { id: 'p3', text: 'b' }] })).toThrow(/重复/)
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [header, { id: 'p10', text: 'ab', runs: [{ source: 'p10:r0', text: 'a' }] }] })).toThrow(/拼起来/)
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [{ id: 'p3', text: '标题' }] })).toThrow(/版头/)
    expect(() => writeDocxFromTemplate(bytes, profile, { replacements: [header, { run_id: 'p10:r9', text: 'x' }] })).toThrow(/run ID 不存在/)
    const ok = writeDocxFromTemplate(bytes, profile, { replacements: [header, { run_id: 'p10:r1', text: '开展专题学习。' }] })
    expect(ok.report.ok).toBe(true)
    expect(inventoryDocx(readOoxmlPackage(ok.bytes), profile)[10]!.runs[1]!.text).toBe('开展专题学习。')
  })
})

describe('package and XML safety limits', () => {
  test('rejects DOCTYPE / external entities', () => {
    expect(() => parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')).toThrow(/DOCTYPE/)
    expect(() => parseXml('<x>&e;</x>')).toThrow(/实体/)
  })

  test('rejects packages with more than 5000 entries', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 5001; i += 1) files[`f${i}.xml`] = new Uint8Array([60])
    expect(() => readOoxmlPackage(zipSync(files))).toThrow(/5000/)
  })

  test('rejects packages that inflate beyond 64 MB', () => {
    const big = new Uint8Array(65 * 1024 * 1024)
    expect(() => readOoxmlPackage(zipSync({ 'word/document.xml': big }, { level: 9 }))).toThrow(/64 MB/)
  })
})
