/**
 * 用案例 inputs 在副本上生成工作簿。example.xlsx 只读。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { excelDateSerial, readXlsxCells, type CellScalar, type CheckSpec } from '../office-render-poc/formula.ts'
import { patchWorkbookCells, type CellPatch } from './workbook.ts'

export const excelCaseRoot = join(import.meta.dir, '../../../../../apps/electron/resources/skills/office-business/cases')

export interface PortRecord {
  title?: string
  records: unknown[][]
}

export interface BioInput {
  wells: unknown[][]
}

export function readCaseBytes(id: 'annual-business' | 'port-cargo' | 'bio-assay'): Uint8Array {
  return readFileSync(join(excelCaseRoot, id, 'example.xlsx'))
}

export function readChecks(id: 'port-cargo' | 'bio-assay'): CheckSpec[] {
  return normalizeCaseChecks(JSON.parse(readFileSync(join(excelCaseRoot, id, 'checks.json'), 'utf8')), `${id}/checks.json`)
}

function isScalar(value: unknown): value is CheckSpec['expected'] {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
}

/**
 * checks.json 有两种写法，统一成 CheckSpec[]：
 * - dsh 案例（港口、荧光酶）：`[{ sheet, cell, expected, tolerance? }]`
 * - 个人办公案例（#728）：`{ sheet, expect: { C11: 18000, ... }, tolerance? }`，键也可以写成 `收支!C11` 覆盖默认表。
 *   只有 `note` 没有 `expect`（如项目甘特）时返回空数组，交给关键单元格双读。
 * 其它形状直接报错，避免在重算里才以「is not iterable」崩掉。
 */
export function normalizeCaseChecks(raw: unknown, source = 'checks.json'): CheckSpec[] {
  const invalid = (why: string) => new Error(`${source} 格式不对：${why}`)
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      const spec = item as Partial<CheckSpec> | null
      if (!spec || typeof spec.sheet !== 'string' || typeof spec.cell !== 'string' || !isScalar(spec.expected)) throw invalid(`第 ${index + 1} 项缺少 sheet / cell / expected`)
      if (spec.tolerance !== undefined && typeof spec.tolerance !== 'number') throw invalid(`第 ${index + 1} 项 tolerance 不是数字`)
      return { sheet: spec.sheet, cell: spec.cell, expected: spec.expected, ...(spec.tolerance !== undefined ? { tolerance: spec.tolerance } : {}) }
    })
  }
  if (!raw || typeof raw !== 'object') throw invalid('应为数组或含 expect 的对象')
  const file = raw as { sheet?: unknown; expect?: unknown; tolerance?: unknown }
  if (file.expect === undefined) return []
  if (!file.expect || typeof file.expect !== 'object' || Array.isArray(file.expect)) throw invalid('expect 应为「单元格 → 期望值」对象')
  if (file.tolerance !== undefined && typeof file.tolerance !== 'number') throw invalid('tolerance 不是数字')
  return Object.entries(file.expect as Record<string, unknown>).map(([key, expected]) => {
    if (!isScalar(expected)) throw invalid(`${key} 的期望值不是数字、文本或布尔`)
    const bang = key.lastIndexOf('!')
    const sheet = bang >= 0 ? key.slice(0, bang).replace(/^'(.*)'$/, '$1') : file.sheet
    const cell = bang >= 0 ? key.slice(bang + 1) : key
    if (typeof sheet !== 'string' || !sheet) throw invalid(`${key} 没有工作表（缺少 sheet）`)
    return { sheet, cell, expected, ...(file.tolerance !== undefined ? { tolerance: file.tolerance as number } : {}) }
  })
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function materializePortCargo(example: Uint8Array, input: PortRecord): Uint8Array {
  const patches: CellPatch[] = []
  input.records.forEach((record, index) => {
    const row = 8 + index
    const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']
    record.forEach((value, column) => {
      const address = `${columns[column]}${row}`
      if (!columns[column]) return
      patches.push({ sheet: '作业明细', address, value: column === 1 ? excelDateSerial(...isoParts(String(value))) : coerce(value) })
    })
  })
  return patchWorkbookCells(example, patches)
}

export function materializeBioAssay(example: Uint8Array, input: BioInput): Uint8Array {
  const patches: CellPatch[] = []
  const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  input.wells.forEach((well, index) => {
    const row = 8 + index
    well.forEach((value, column) => {
      const address = columns[column]
      if (!address || value === null || value === undefined) return
      patches.push({ sheet: '原始读数', address: `${address}${row}`, value: coerce(value) })
    })
  })
  return patchWorkbookCells(example, patches)
}

export function patchCell(bytes: Uint8Array, sheet: string, address: string, value: CellScalar): Uint8Array {
  return patchWorkbookCells(bytes, [{ sheet, address, value }])
}

export function cellValue(bytes: Uint8Array, sheet: string, address: string): CellScalar | undefined {
  const cell = readXlsxCells(bytes).find(item => item.sheet === sheet && item.address.toUpperCase() === address.toUpperCase())
  return cell?.value ?? cell?.cachedValue
}

function coerce(value: unknown): CellScalar {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value == null ? null : String(value)
}

function isoParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) throw new Error(`无法解析日期 ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
