/**
 * Excel 交付门闩。未重算、核对失败、空白页或 OCR 都不能交付。
 */
import type { CellScalar } from '../office-render-poc/formula.ts'

export type ExcelDeliveryCode =
  | 'not-recalculated'
  | 'ocr-forbidden'
  | 'blank-page'
  | 'region-not-reviewed'
  | 'checks-failed'
  | 'dual-read-missing'
  | 'dual-read-mismatch'

export interface DualReadCell {
  ref: string
  formula: string
  cached: CellScalar
  computed: CellScalar
}

export interface ExcelDeliveryInput {
  recalculated: boolean
  checks?: { passed: boolean } | null
  dualRead?: DualReadCell[]
  regionReviewed: boolean
  blankPage?: boolean
  usedOcr?: boolean
}

export function assertExcelDelivery(input: ExcelDeliveryInput): { ok: true } | { ok: false; code: ExcelDeliveryCode; message: string } {
  if (!input.recalculated) return { ok: false, code: 'not-recalculated', message: '未重算，不能交付' }
  if (input.usedOcr) return { ok: false, code: 'ocr-forbidden', message: '视觉检查禁止 OCR' }
  if (input.blankPage) return { ok: false, code: 'blank-page', message: '区域渲染是空白页，已停止' }
  if (!input.regionReviewed) return { ok: false, code: 'region-not-reviewed', message: '关键表还没有做原生读图' }
  if (input.checks) {
    if (!input.checks.passed) return { ok: false, code: 'checks-failed', message: 'checks.json 未通过' }
    return { ok: true }
  }
  const declared = input.dualRead ?? []
  if (declared.length === 0) return { ok: false, code: 'dual-read-missing', message: '没有 checks.json，必须声明关键单元格并双读' }
  for (const cell of declared) {
    if (!cell.formula.trim()) return { ok: false, code: 'dual-read-mismatch', message: `${cell.ref} 缺少公式` }
    if (!same(cell.cached, cell.computed)) return { ok: false, code: 'dual-read-mismatch', message: `${cell.ref} 的缓存和计算值不一致` }
  }
  return { ok: true }
}

function same(cached: CellScalar, computed: CellScalar): boolean {
  if (typeof cached === 'number' && typeof computed === 'number') return Math.abs(cached - computed) <= 1e-6
  return cached === computed
}
