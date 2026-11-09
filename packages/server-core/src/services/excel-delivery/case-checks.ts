/**
 * checks.json 归一化。不读 import.meta，主进程 CJS 包也能安全引入。
 */
import type { CheckSpec } from '../office-render-poc/formula.ts'

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
