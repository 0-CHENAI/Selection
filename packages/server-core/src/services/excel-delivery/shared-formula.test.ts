import { expect, test } from 'bun:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { readXlsxCells } from '../office-render-poc/formula.ts'
import { writeFormulaCache } from './workbook.ts'
import { runXlsxRecalculateTool } from './xlsx-tool.ts'

function workbook(rows: string) {
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" r:id="r1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
  })
}

test('shared formulas expand relative axes without changing strings, sheet names or function names', () => {
  const bytes = workbook(`<row r="3"><c r="C3"><f t="shared" si="0"/><v>0</v></c></row>
    <row r="2"><c r="B2"><f t="shared" si="0" ref="B2:C3">A1+$A1+A$1+$A$1+SUM(A1:B2)+'A1'!A1+S1!A1+LOG10(A1)+"A1"+Table1[A1]</f><v>0</v></c></row>`)
  expect(readXlsxCells(bytes).find(c => c.address === 'C3')?.formula)
    .toBe('B2+$A2+B$1+$A$1+SUM(B2:C3)+\'A1\'!B2+S1!B2+LOG10(B2)+"A1"+Table1[A1]')
})

test('saved shared formula followers survive cache writes and key-cell dual reads', async () => {
  const bytes = workbook(`<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="shared" si="0" ref="B1:B2">A1+1</f><v>3</v></c></row>
    <row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>`)
  const written = writeFormulaCache(bytes, { 'S!B1': 3, 'S!B2': 4 })
  expect(strFromU8(unzipSync(written)['xl/worksheets/sheet1.xml']!)).toContain('<f t="shared" si="0"/>')
  expect(readXlsxCells(written).find(c => c.address === 'B2')).toMatchObject({ formula: 'A2+1', cachedValue: 4 })
  const result = await runXlsxRecalculateTool(written, { path: 'x.xlsx', key_cells: ['S!B2'], visual_review: 'not-needed' }, {
    platform: 'darwin', excelInstalled: true, excelCalculateFull: async () => written,
  })
  expect(result.result.ready).toBe(true)
  expect(result.result.dualRead[0]).toMatchObject({ formula: 'A2+1', cached: 4, computed: 4, ok: true })
})

test('a missing shared master is not silently treated as a static value', () => {
  expect(() => readXlsxCells(workbook('<row r="1"><c r="B1"><f t="shared" si="9"/><v>4</v></c></row>')))
    .toThrow('共享公式缺少主公式')
})
