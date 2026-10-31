import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { macCalculateFullScript, parseOfficecliComputed, runXlsxRecalculateTool, windowsCalculateFullScript, workbookHasFormulas } from './xlsx-tool.ts'
import { readCaseBytes, readChecks } from './cases.ts'

setDefaultTimeout(120_000)

describe('xlsx_recalculate host adapter', () => {
  test('parses OfficeCLI computedValue; unevaluated and error cells go to the TypeScript evaluator', () => {
    const json = JSON.stringify({ success: true, data: { results: [
      { path: '/港口总览/B6', format: { type: 'Number', formula: 'SUM(A1:A2)', computedValue: '2516.8532', evaluated: true } },
      { path: '/港口总览/C6', format: { type: 'String', formula: 'TEXT(B1,"m/d")', computedValue: '12/31', evaluated: true } },
      { path: '/港口总览/D6', format: { type: 'Number', formula: 'FOO()', evaluated: false } },
      { path: '/港口总览/E6', format: { type: 'Number', formula: '1/0', computedValue: '#DIV/0!', evaluated: true } },
    ] } })
    expect(parseOfficecliComputed(json)).toEqual({ '港口总览!B6': 2516.8532, '港口总览!C6': '12/31', '港口总览!D6': 'unevaluated', '港口总览!E6': 'unevaluated' })
  })

  test('OfficeCLI values are used first; CalculateFull runs when Excel is installed; failures fall back', async () => {
    const bytes = readCaseBytes('port-cargo')
    let officeCalls = 0
    const officecli = async () => { officeCalls += 1; return JSON.stringify({ data: { results: [{ path: '/港口总览/B6', format: { type: 'Number', computedValue: '2516.8532', evaluated: true } }] } }) }
    const withExcel = await runXlsxRecalculateTool(bytes, { path: 'x.xlsx', visual_review: 'not-needed' }, {
      platform: 'darwin', officecliBinary: '/fake/officecli', runOfficecli: officecli, excelInstalled: true, checks: readChecks('port-cargo'),
      excelCalculateFull: async () => { throw new Error('Excel 未响应') },
    })
    expect(officeCalls).toBe(1)
    expect(withExcel.result.notes.join('')).toContain('CalculateFull 失败')
    expect(withExcel.result.ran).toContain('officecli-computed-writeback')
    expect(withExcel.result.ready).toBe(true)
    const calculated = await runXlsxRecalculateTool(bytes, { path: 'x.xlsx', visual_review: 'not-needed' }, {
      platform: 'win32', excelInstalled: true, checks: readChecks('port-cargo'), excelCalculateFull: async input => input,
    })
    expect(calculated.result.ran).toContain('excel-calculate-full')
  })

  test('not-reviewed visual check and failed checks block delivery and list the problem', async () => {
    const bytes = readCaseBytes('port-cargo')
    const unreviewed = await runXlsxRecalculateTool(bytes, { path: 'x.xlsx' }, { platform: 'linux', checks: readChecks('port-cargo') })
    expect(unreviewed.result.code).toBe('region-not-reviewed')
    const wrong = await runXlsxRecalculateTool(bytes, { path: 'x.xlsx', visual_review: 'not-needed' }, { platform: 'linux', checks: [{ sheet: '港口总览', cell: 'B6', expected: 1 }] })
    expect(wrong.result.ready).toBe(false)
    expect(wrong.result.code).toBe('checks-failed')
    expect(wrong.result.checks?.failures[0]?.ref).toBe('港口总览!B6')
  })

  test('native CalculateFull scripts only quit the Excel instance they started', () => {
    expect(macCalculateFullScript('/tmp/a "b".xlsx')).toContain('if not wasRunning then quit')
    expect(macCalculateFullScript('/tmp/a "b".xlsx')).toContain('\\"b\\"')
    const ps = windowsCalculateFullScript("C:\\a'b.xlsx")
    expect(ps).toContain("C:\\a''b.xlsx")
    expect(ps).toContain('$excel.CalculateFull()')
    expect(ps).toContain('$excel.Quit()')
  })

  test('workbooks without formulas do not need recalculation', () => {
    const plain = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'),
    })
    expect(workbookHasFormulas(plain)).toBe(false)
    expect(workbookHasFormulas(readCaseBytes('bio-assay'))).toBe(true)
  })

  const localOfficecli = process.env.SELECTION_OFFICECLI_TEST_BINARY
  test.skipIf(!localOfficecli || !existsSync(localOfficecli))('real OfficeCLI query feeds the recalculation (local only)', async () => {
    const result = await runXlsxRecalculateTool(readFileSync(join(import.meta.dir, '../../../../../apps/electron/resources/skills/office-business/cases/port-cargo/example.xlsx')), { path: 'x.xlsx', visual_review: 'not-needed' }, {
      platform: 'linux', officecliBinary: localOfficecli!, checks: readChecks('port-cargo'),
    })
    expect(result.result.ran[0]).toBe('officecli-computed-writeback')
    expect(result.result.ready).toBe(true)
  })
})
