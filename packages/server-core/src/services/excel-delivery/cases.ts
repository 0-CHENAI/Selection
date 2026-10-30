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
  return JSON.parse(readFileSync(join(excelCaseRoot, id, 'checks.json'), 'utf8')) as CheckSpec[]
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
