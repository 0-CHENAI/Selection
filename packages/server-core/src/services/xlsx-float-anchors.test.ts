import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { alignXlsxFloats, readXlsxFloatAnchors } from './xlsx-float-anchors.ts'

const cases = join(import.meta.dir, '../../../../apps/electron/resources/skills/office-business/cases')
const div = '<div style="position:absolute;left:30pt;top:18pt;width:400pt;height:250pt;z-index:10;pointer-events:auto;display:flex" data-from-col="0" data-from-row="0">'

describe('Excel 浮动图表锚点', () => {
  test('oneCellAnchor 的图表按工作簿里的行列和尺寸放', () => {
    const bytes = readFileSync(join(cases, 'port-cargo/example.xlsx'))
    const anchors = readXlsxFloatAnchors(bytes)
    expect(anchors[0]!.map(a => [a.col, a.row])).toEqual([[1, 9], [1, 27], [9, 27]])
    expect(anchors[0]![0]!.widthPt).toBeCloseTo(691.65, 1)
    const html = `<div class="sheet-content active" data-sheet="0"><table></table>${div}</div>${div}${div}</div><div class="sheet-content" data-sheet="1">${div}</div>`
    const fixed = alignXlsxFloats(html, bytes)
    expect(fixed).toContain('width:691.65pt;height:226.77pt;z-index:10;pointer-events:auto;display:flex" data-from-col="1" data-from-row="9"')
    expect(fixed).toContain('data-from-col="9" data-from-row="27"')
    // 第二张表有两张图，HTML 只有一个浮动层：个数对不上就不动
    expect(fixed.split('data-sheet="1"')[1]).toContain('data-from-col="0" data-from-row="0"')
    expect(alignXlsxFloats(fixed, bytes)).toBe(fixed)
  })

  test('OfficeCLI 生成的 twoCellAnchor 保留原尺寸；坏包原样返回', () => {
    const bytes = readFileSync(join(cases, 'household-budget/example.xlsx'))
    expect(readXlsxFloatAnchors(bytes)[0]).toEqual([{ col: 0, row: 19 }])
    expect(alignXlsxFloats(`<div class="sheet-content" data-sheet="0">${div}</div>`, bytes)).toContain('width:400pt;height:250pt;z-index:10;pointer-events:auto;display:flex" data-from-col="0" data-from-row="19"')
    expect(alignXlsxFloats('<p>x</p>', new Uint8Array([1, 2, 3]))).toBe('<p>x</p>')
  })
})
