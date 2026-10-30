import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { readXlsxCells } from '../office-render-poc/formula.ts'
import { chartPartNames, patchWorkbookCells } from './workbook.ts'
import { linuxFormulaCapabilities, xlsxRecalculate } from './xlsx-recalculate.ts'
import { assertExcelDelivery } from './delivery-gate.ts'
import { cellValue, excelCaseRoot, materializeBioAssay, materializePortCargo, patchCell, readCaseBytes, readChecks, sha256 } from './cases.ts'

const inventoryPath = join(import.meta.dir, '../../../../../docs/plans/dsh-office-inventory.json')

const copied: Record<string, string> = {
  'annual-business/design.md': 'packages/dsh-desktop-office/sources/legacy/annual-business/design.md',
  'annual-business/example.xlsx': 'packages/dsh-desktop-office/sources/legacy/annual-business/example.xlsx',
  'port-cargo/checks.json': 'packages/dsh-desktop-office/sources/legacy/port-cargo/checks.json',
  'port-cargo/design.md': 'packages/dsh-desktop-office/sources/legacy/port-cargo/design.md',
  'port-cargo/example.xlsx': 'packages/dsh-desktop-office/sources/legacy/port-cargo/example.xlsx',
  'port-cargo/inputs/port.json': 'packages/dsh-desktop-office/sources/legacy/port-cargo/inputs/port.json',
  'bio-assay/checks.json': 'packages/dsh-desktop-office/sources/legacy/bio-assay/checks.json',
  'bio-assay/design.md': 'packages/dsh-desktop-office/sources/legacy/bio-assay/design.md',
  'bio-assay/example.xlsx': 'packages/dsh-desktop-office/sources/legacy/bio-assay/example.xlsx',
  'bio-assay/inputs/bio.json': 'packages/dsh-desktop-office/sources/legacy/bio-assay/inputs/bio.json',
}

test('三个 Excel 案例原件与阶段 01 清单 sha256 一致', () => {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as { files: Array<{ path: string; sha256: string }> }
  for (const [local, source] of Object.entries(copied)) {
    const expected = inventory.files.find(file => file.path === source)?.sha256
    const actual = createHash('sha256').update(readFileSync(join(excelCaseRoot, local))).digest('hex')
    expect(expected).toBeTruthy()
    expect(actual).toBe(expected ?? '')
  }
})

test('X1 port-cargo：inputs 生成后港口总览四项通过，原生图表还在', async () => {
  const original = readCaseBytes('port-cargo')
  const before = sha256(original)
  const charts = chartPartNames(original)
  expect(charts.length).toBe(8)
  const input = JSON.parse(readFileSync(join(excelCaseRoot, 'port-cargo/inputs/port.json'), 'utf8')) as { records: unknown[][] }
  const generated = materializePortCargo(original, input)
  expect(chartPartNames(generated)).toEqual(charts)
  expect(readXlsxCells(generated).some(cell => cell.sheet === '作业明细' && cell.address === 'L8' && cell.formula?.startsWith('IF'))).toBe(true)
  const result = await xlsxRecalculate({
    bytes: generated,
    checks: readChecks('port-cargo'),
    capabilities: linuxFormulaCapabilities(false),
  })
  expect(result.ran).toEqual(['selection-formula-fallback'])
  expect(result.checks.passed).toBe(true)
  expect(result.values['港口总览!B6']).toBeCloseTo(2516.8532, 6)
  expect(result.values['港口总览!F6']).toBeCloseTo(0.6504859719271668, 6)
  expect(result.values['港口总览!J6']).toBeCloseTo(2.6991141552511415, 6)
  expect(result.values['港口总览!N6']).toBe(2190)
  const mutated = materializePortCargo(original, {
    records: input.records.map((record, index) => index === 0 ? [...record.slice(0, 6), Number(record[6]) + 10000, ...record.slice(7)] : record),
  })
  const changed = await xlsxRecalculate({ bytes: mutated, checks: [], capabilities: linuxFormulaCapabilities(false) })
  expect(Number(changed.values['港口总览!B6']) - Number(result.values['港口总览!B6'])).toBeCloseTo(1, 6)
  expect(sha256(original)).toBe(before)
}, 180000)

test('X2 bio-assay：inputs 生成后 checks 全部通过', async () => {
  const original = readCaseBytes('bio-assay')
  const input = JSON.parse(readFileSync(join(excelCaseRoot, 'bio-assay/inputs/bio.json'), 'utf8')) as { wells: unknown[][] }
  const generated = materializeBioAssay(original, input)
  expect(chartPartNames(generated).length).toBe(4)
  const result = await xlsxRecalculate({
    bytes: generated,
    checks: readChecks('bio-assay'),
    capabilities: linuxFormulaCapabilities(false),
  })
  expect(result.checks.passed).toBe(true)
  expect(result.checks.failures).toEqual([])
})

test('X3 改一个月度新增 MRR 后，总览、测算和留存按公式联动', async () => {
  const original = readCaseBytes('annual-business')
  const before = await xlsxRecalculate({ bytes: original, capabilities: linuxFormulaCapabilities(false) })
  // N62 汇总「月度经营数据!B41」所在月份的新增 MRR，增长测算!C100 再引用该列合计。
  const edited = patchCell(original, '月度经营数据', 'E41', Number(cellValue(original, '月度经营数据', 'E41')) + 10000)
  const after = await xlsxRecalculate({ bytes: edited, capabilities: linuxFormulaCapabilities(false) })
  expect(Number(after.values['增长质量!N62']) - Number(before.values['增长质量!N62'])).toBeCloseTo(10000, 6)
  expect(Number(after.values['增长测算!C100']) - Number(before.values['增长测算!C100'])).toBeCloseTo(10000, 6)
  const overviewMoved = Object.keys(after.values).some(ref => {
    if (!ref.startsWith('经营总览!')) return false
    const next = after.values[ref]
    const prev = before.values[ref]
    return typeof next === 'number' && typeof prev === 'number' && Math.abs(next - prev) > 1e-6
  })
  expect(overviewMoved).toBe(true)
  expect(after.values['客户留存!B12']).toBe(after.values['客户批次数据!B9'])
  expect(after.values['客户留存!N2']).toBe(after.values['增长测算!H6'])
  expect(after.values['客户留存!N2']).toBe('基准')
  const reread = readXlsxCells(after.bytes).find(cell => cell.sheet === '增长测算' && cell.address === 'C100')
  expect(reread?.cachedValue).toBeCloseTo(Number(after.values['增长测算!C100']), 6)
  expect(sha256(original)).toBe(sha256(readCaseBytes('annual-business')))
})

test('OfficeCLI 已求值的格子不再交给 TypeScript，未求值的才补', async () => {
  const bytes = tinyBook()
  let calls = 0
  const result = await xlsxRecalculate({
    bytes,
    checks: [{ sheet: 'Sheet1', cell: 'A3', expected: 30 }],
    capabilities: linuxFormulaCapabilities(true),
    officecli: async () => {
      calls += 1
      return { 'Sheet1!A3': 'unevaluated' }
    },
  })
  expect(calls).toBe(1)
  expect(result.ran).toEqual(['officecli-computed-writeback', 'selection-formula-fallback'])
  expect(result.unevaluatedFilledByTypeScript).toBe(1)
  expect(result.values['Sheet1!A3']).toBe(30)
  const covered = await xlsxRecalculate({
    bytes,
    capabilities: linuxFormulaCapabilities(true),
    officecli: async () => ({ 'Sheet1!A3': 99 }),
  })
  expect(covered.ran).toEqual(['officecli-computed-writeback'])
  expect(covered.unevaluatedFilledByTypeScript).toBe(0)
  expect(covered.values['Sheet1!A3']).toBe(99)
})

test('Linux 上即使声称有 Excel 也不调用 CalculateFull', async () => {
  const bytes = tinyBook()
  await xlsxRecalculate({
    bytes,
    capabilities: { ...linuxFormulaCapabilities(false), excel: true },
    excelCalculateFull: () => Promise.reject(new Error('不应在 Linux 上调用')),
  })
})

test('Windows 上装了 Excel 才调用 CalculateFull', async () => {
  const bytes = tinyBook()
  let called = false
  const result = await xlsxRecalculate({
    bytes,
    capabilities: { ...linuxFormulaCapabilities(false), platform: 'win32', excel: true },
    excelCalculateFull: async current => {
      called = true
      return patchWorkbookCells(current, [{ sheet: 'Sheet1', address: 'A3', value: 30 }])
    },
  })
  expect(called).toBe(true)
  expect(result.ran[0]).toBe('excel-calculate-full')
  expect(result.plan.map(step => step.id)).toContain('excel-calculate-full')
  expect(result.plan.find(step => step.id === 'excel-calculate-full')?.ciWithoutOffice).toBe(false)
})

describe('未重算不能交付', () => {
  test('直接交付被拒绝', () => {
    const blocked = assertExcelDelivery({ recalculated: false, checks: { passed: true }, regionReviewed: true })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('not-recalculated')
  })

  test('重算后 checks 失败、空白页和 OCR 也不能交付', () => {
    expect(assertExcelDelivery({ recalculated: true, checks: { passed: false }, regionReviewed: true }).ok).toBe(false)
    expect(assertExcelDelivery({ recalculated: true, checks: { passed: true }, regionReviewed: true, blankPage: true }).ok).toBe(false)
    expect(assertExcelDelivery({ recalculated: true, checks: { passed: true }, regionReviewed: true, usedOcr: true }).ok).toBe(false)
    expect(assertExcelDelivery({ recalculated: true, checks: { passed: true }, regionReviewed: false }).ok).toBe(false)
    expect(assertExcelDelivery({ recalculated: true, checks: { passed: true }, regionReviewed: true }).ok).toBe(true)
  })

  test('没有 checks 时必须双读一致', () => {
    expect(assertExcelDelivery({ recalculated: true, regionReviewed: true }).ok).toBe(false)
    expect(assertExcelDelivery({
      recalculated: true,
      regionReviewed: true,
      dualRead: [{ ref: '增长质量!C62', formula: 'SUMIFS(...)', cached: 1, computed: 2 }],
    }).ok).toBe(false)
    expect(assertExcelDelivery({
      recalculated: true,
      regionReviewed: true,
      dualRead: [{ ref: '增长质量!C62', formula: 'SUMIFS(...)', cached: 48960, computed: 48960 }],
    }).ok).toBe(true)
  })
})

function tinyBook(): Uint8Array {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="A2"><v>20</v></c><c r="A3"><f>SUM(A1:A2)</f><v>0</v></c></row></sheetData></worksheet>`
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  return zipSync({
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}
