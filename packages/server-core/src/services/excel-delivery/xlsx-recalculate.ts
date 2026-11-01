/**
 * 阶段 09 接入的公式重算。顺序来自已批准的原生优先计划：
 * OfficeCLI computedValue 写回缓存；Windows/macOS 且装了 Excel 时再 CalculateFull；
 * TypeScript 只补未求值的格子。
 */
import {
  cellRef,
  readXlsxCells,
  recalculateWorkbook,
  type CellData,
  type CellInput,
  type CellScalar,
  type CheckSpec,
  type RecalcResult,
} from '../office-render-poc/formula.ts'
import { planNativeOfficeRender, type NativeCapabilities, type NativeStep } from '../office-render-poc/native-plan.ts'
import { writeFormulaCache } from './workbook.ts'

export type OfficeComputed = CellScalar | 'unevaluated'

export interface XlsxRecalculateInput {
  bytes: Uint8Array
  checks?: CheckSpec[]
  capabilities: NativeCapabilities
  /** OfficeCLI 求值。缺席或返回 unevaluated 的格子留给 TypeScript。 */
  officecli?: (cells: CellInput[]) => Promise<Record<string, OfficeComputed>>
  /** 仅当计划里有 excel-calculate-full 时调用。Linux 上的计划不会包含这一步。 */
  excelCalculateFull?: (bytes: Uint8Array) => Promise<Uint8Array>
}

export interface XlsxRecalculateResult {
  bytes: Uint8Array
  plan: NativeStep[]
  ran: string[]
  values: Record<string, CellData>
  checks: RecalcResult['checks']
  unevaluatedFilledByTypeScript: number
}

export async function xlsxRecalculate(input: XlsxRecalculateInput): Promise<XlsxRecalculateResult> {
  const plan = planNativeOfficeRender(input.capabilities).formula
  const ran: string[] = []
  let bytes = input.bytes
  const office = new Map<string, CellScalar>()

  if (plan.some(step => step.id === 'officecli-computed-writeback') && input.officecli) {
    const cells = readXlsxCells(bytes)
    const computed = await input.officecli(cells)
    for (const [ref, value] of Object.entries(computed)) {
      if (value !== 'unevaluated') office.set(ref, value)
    }
    ran.push('officecli-computed-writeback')
  }

  if (plan.some(step => step.id === 'excel-calculate-full')) {
    if (!input.excelCalculateFull) {
      throw new Error('计划要求 Excel CalculateFull，但当前没有可调用的 Excel')
    }
    bytes = await input.excelCalculateFull(bytes)
    ran.push('excel-calculate-full')
    for (const cell of readXlsxCells(bytes)) {
      if (cell.formula && cell.cachedValue !== undefined) office.set(cellRef(cell.sheet, cell.address), cell.cachedValue)
    }
  }

  const source = readXlsxCells(bytes)
  let unevaluated = 0
  const fallbackCells: CellInput[] = source.map(cell => {
    if (!cell.formula) return cell
    const known = office.get(cellRef(cell.sheet, cell.address))
    if (known !== undefined) return { sheet: cell.sheet, address: cell.address, value: known, cachedValue: known }
    unevaluated += 1
    return cell
  })
  if (unevaluated > 0 || ran.length === 0) ran.push('selection-formula-fallback')
  const result = recalculateWorkbook(fallbackCells, input.checks ?? [])
  const written = writeFormulaCache(bytes, result.values)
  return {
    bytes: written,
    plan,
    ran,
    values: result.values,
    checks: result.checks,
    unevaluatedFilledByTypeScript: unevaluated,
  }
}

export function linuxFormulaCapabilities(officecliFormula: boolean): NativeCapabilities {
  return {
    platform: 'linux',
    electronPrintToPdf: true,
    electronCapturePage: true,
    officecliHtml: true,
    officecliFormula,
    exporterPdfPlugin: false,
    word: false,
    powerpoint: false,
    excel: false,
  }
}
