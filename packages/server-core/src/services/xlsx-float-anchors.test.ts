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
    expect(fixed).toContain('width:691.65pt;height:226.77pt;z-index:10;pointer-events:auto;display:flex" data-from-col="1" data-from-row="9" data-anchor-range="1 9 ')
    expect(fixed).toContain('data-from-col="9" data-from-row="27" data-anchor-range="9 27 ')
    // 第二张表有两张图，HTML 只有一个浮动层：个数对不上就不动
    expect(fixed.split('data-sheet="1"')[1]).toContain('data-from-col="0" data-from-row="0"')
    expect(alignXlsxFloats(fixed, bytes)).toBe(fixed)
  })

  test('OfficeCLI 生成的 twoCellAnchor 按 from / to 的格子定尺寸；坏包原样返回', () => {
    const bytes = readFileSync(join(cases, 'household-budget/example.xlsx'))
    const [anchor] = readXlsxFloatAnchors(bytes)[0]!
    expect(anchor!.range).toEqual([0, 19, 4, 33])
    // A–D 四列 + 第 20–33 行，按工作表里的列宽、行高算出，不再用 OfficeCLI 的 400×250pt 估算
    expect(anchor!.widthPt).toBeCloseTo(304.5, 1)
    expect(anchor!.heightPt).toBeCloseTo(210, 1)
    expect(alignXlsxFloats(`<div class="sheet-content" data-sheet="0">${div}</div>`, bytes)).toContain('width:304.50pt;height:210.00pt;z-index:10;pointer-events:auto;display:flex" data-from-col="0" data-from-row="19" data-anchor-range="0 19 4 33"')
    expect(alignXlsxFloats('<p>x</p>', new Uint8Array([1, 2, 3]))).toBe('<p>x</p>')
  })

  test('oneCellAnchor 按 Excel 的列宽、行高推出覆盖范围；与 Excel 一样，宽图可以盖过右边的表', () => {
    const bytes = readFileSync(join(cases, 'annual-business/example.xlsx'))
    const [daily] = readXlsxFloatAnchors(bytes)[0]!
    // 609pt 宽的日新增图从 B12 起：B 列 129px，C 起每列 65px（宽 18.44 / 9.33 字符，Carlito 11）
    // 在 Excel 里走到 M 列一半，也就盖住 K–M 列的季度表。预览照 Excel 画，不另裁。
    expect(daily!.range![0]).toBe(1)
    expect(daily!.range![1]).toBe(11)
    expect(daily!.range![2]).toBeCloseTo(12.5077, 3)
    expect(daily!.range![3]).toBeCloseTo(22.9792, 3)
  })
})
