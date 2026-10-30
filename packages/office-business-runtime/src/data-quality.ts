/**
 * 12 维数据体检。权重、等级和建议文案对齐 dataset-health-audit 的 data_quality_checker.py。
 * 读表优先 CSV / TSV / JSON。xlsx 由调用方先导出单元格再传入，不引入新的表格库。
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

export const DIMENSION_WEIGHTS = {
  missing_values: 15,
  duplicates: 10,
  type_consistency: 10,
  value_range: 10,
  format_compliance: 10,
  uniqueness: 8,
  whitespace: 7,
  constant_columns: 5,
  distribution_skew: 5,
  column_naming: 5,
  cardinality: 5,
  cross_column: 10,
} as const

export type DimensionName = keyof typeof DIMENSION_WEIGHTS
export type Cell = number | string | null
export type Column = { name: string; values: Cell[] }
export type Table = { columns: Column[] }

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/
const PHONE_RE = /^(\+?\d{1,4}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}$/
const URL_RE = /^https?:\/\/[^\s]+$/
const DATE_FORMATS = ['%Y-%m-%d', '%Y/%m/%d', '%d-%m-%Y', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%Y%m%d', '%m/%d/%Y', '%m-%d-%Y']
const CLEAN_RE = /^[a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$/

export function scoreToGrade(score: number): string {
  if (score >= 95) return 'A+'
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

export function auditTable(table: Table, options: { idColumns?: string[]; fileName?: string } = {}): QualityReport {
  const dimensions = {
    missing_values: checkMissing(table),
    duplicates: checkDuplicates(table),
    type_consistency: checkTypes(table),
    value_range: checkRange(table),
    format_compliance: checkFormat(table),
    uniqueness: checkUnique(table, options.idColumns),
    whitespace: checkWhitespace(table),
    constant_columns: checkConstant(table),
    distribution_skew: checkSkew(table),
    column_naming: checkNames(table),
    cardinality: checkCardinality(table),
    cross_column: checkCross(table),
  }
  const weight = Object.values(DIMENSION_WEIGHTS).reduce((sum, item) => sum + item, 0)
  const weighted = (Object.keys(DIMENSION_WEIGHTS) as DimensionName[])
    .reduce((sum, name) => sum + dimensions[name].score * DIMENSION_WEIGHTS[name], 0)
  const overall = round(weighted / weight, 2)
  return {
    file: options.fileName ?? '',
    rows: table.columns[0]?.values.length ?? 0,
    columns: table.columns.length,
    column_list: table.columns.map(column => column.name),
    overall_score: overall,
    grade: scoreToGrade(overall),
    dimensions,
    top_suggestions: topSuggestions(dimensions),
  }
}

export interface QualityReport {
  file: string
  rows: number
  columns: number
  column_list: string[]
  overall_score: number
  grade: string
  dimensions: Record<DimensionName, { score: number; issues: Array<Record<string, unknown>>; note?: string }>
  top_suggestions: string[]
}

export function loadTable(path: string, encoding = 'utf-8'): Table {
  const text = readFileSync(path, encoding as BufferEncoding)
  const ext = extname(path).toLowerCase()
  if (ext === '.json') return tableFromJson(text)
  if (ext === '.tsv') return tableFromDelimited(text, '\t')
  return tableFromDelimited(text, ',')
}

export function auditFile(path: string, options: { idColumns?: string[]; sample?: number } = {}): QualityReport {
  let table = loadTable(path)
  if (options.sample && options.sample < rowCount(table)) table = sampleTable(table, options.sample)
  if (rowCount(table) === 0) throw new Error('文件为空或无有效数据')
  return auditTable(table, { ...options, fileName: basename(path) })
}

function checkMissing(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  const rows = rowCount(table)
  let missingCells = 0
  for (const column of table.columns) {
    const missing = column.values.filter(value => value === null).length
    if (missing === 0) continue
    missingCells += missing
    const numeric = numericValues(column)
    let suggestion: string
    if (isNumericColumn(column) && numeric.length > 0) {
      suggestion = `建议用中位数(${formatG(median(numeric))})或均值填充`
    } else {
      const mode = modeOf(column.values.filter((value): value is string => typeof value === 'string'))
      suggestion = mode === undefined ? '建议删除该列或补充数据来源' : `建议用众数「${mode}」填充，或标记为专用缺失标识`
    }
    issues.push({ column: column.name, missing_count: missing, missing_pct: round(missing / rows * 100, 2), suggestion })
  }
  const total = rows * table.columns.length
  const score = total === 0 ? 100 : round(100 * (1 - missingCells / total), 2)
  return { score: Math.max(score, 0), issues }
}

function checkDuplicates(table: Table): QualityReport['dimensions'][DimensionName] {
  const rows = rowCount(table)
  const seen = new Set<string>()
  const duplicateIndexes: number[] = []
  for (let index = 0; index < rows; index += 1) {
    const key = JSON.stringify(table.columns.map(column => column.values[index] ?? null))
    if (seen.has(key)) duplicateIndexes.push(index)
    else seen.add(key)
  }
  const issues: Array<Record<string, unknown>> = []
  if (duplicateIndexes.length > 0) {
    const pct = round(duplicateIndexes.length / rows * 100, 2)
    issues.push({
      duplicate_rows: duplicateIndexes.length,
      duplicate_pct: pct,
      sample_row_indices: duplicateIndexes.slice(0, 5),
      suggestion: `发现 ${duplicateIndexes.length} 行完全重复（${pct}%），建议使用 drop_duplicates() 去重`,
    })
  }
  const score = round(100 * (1 - duplicateIndexes.length / Math.max(rows, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkTypes(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  let problems = 0
  for (const column of table.columns) {
    if (isNumericColumn(column)) continue
    const values = column.values.filter(value => value !== null)
    if (values.length === 0) continue
    const counts = new Map<string, number>()
    for (const value of values) {
      const kind = typeof value === 'string' ? 'str' : typeof value === 'number' && Number.isInteger(value) ? 'int' : 'float'
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    if (counts.size > 1) {
      problems += 1
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
      issues.push({
        column: column.name,
        types_found: Object.fromEntries(counts),
        suggestion: `列中混合了多种类型，主要是 ${dominant[0]}（${dominant[1]}个），建议统一转换`,
      })
      continue
    }
    if (!counts.has('str')) continue
    const texts = values.filter((value): value is string => typeof value === 'string')
    const numericCount = texts.filter(value => value.trim() !== '' && Number.isFinite(Number(value))).length
    if (numericCount > 0 && numericCount < texts.length && numericCount > texts.length * 0.5) {
      problems += 1
      const nonNumeric = texts.length - numericCount
      issues.push({
        column: column.name,
        numeric_values: numericCount,
        non_numeric_values: nonNumeric,
        suggestion: `有 ${nonNumeric} 个值无法转为数字，其余均为数字，建议清洗后转为数值类型`,
      })
    }
  }
  const score = round(100 * (1 - problems / Math.max(table.columns.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkRange(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  const numeric = table.columns.filter(isNumericColumn)
  let outlierCols = 0
  for (const column of numeric) {
    const series = numericValues(column)
    if (series.length < 4) continue
    const q1 = quantile(series, 0.25)
    const q3 = quantile(series, 0.75)
    const iqr = q3 - q1
    const lower = q1 - 1.5 * iqr
    const upper = q3 + 1.5 * iqr
    const outliers = series.filter(value => value < lower || value > upper)
    if (outliers.length === 0) continue
    const pct = round(outliers.length / series.length * 100, 2)
    if (pct > 1) outlierCols += 1
    issues.push({
      column: column.name,
      outlier_count: outliers.length,
      outlier_pct: pct,
      range: { min: Math.min(...series), max: Math.max(...series) },
      iqr_bounds: { lower: round(lower, 4), upper: round(upper, 4) },
      suggestion: `${outliers.length} 个值超出 IQR 范围 [${formatG(lower)}, ${formatG(upper)}]，建议检查是否为录入错误或截断处理`,
    })
  }
  const score = round(100 * (1 - outlierCols / Math.max(numeric.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkFormat(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  let checked = 0
  let problems = 0
  for (const column of table.columns) {
    if (isNumericColumn(column)) continue
    const detected = detectFormat(column)
    if (!detected) continue
    checked += 1
    const values = column.values.filter((value): value is string => typeof value === 'string')
    const bad = values.filter(value => !matchesFormat(value, detected))
    if (bad.length === 0) continue
    problems += 1
    const pct = round(bad.length / values.length * 100, 2)
    issues.push({
      column: column.name,
      detected_format: detected,
      invalid_count: bad.length,
      invalid_pct: pct,
      samples: bad.slice(0, 5),
      suggestion: `检测到 ${detected} 格式，但有 ${bad.length} 个值不符合（${pct}%），建议统一格式`,
    })
  }
  const score = checked === 0 ? 100 : round(100 * (1 - problems / checked), 2)
  return { score: Math.max(score, 0), issues }
}

function checkUnique(table: Table, idColumns?: string[]): QualityReport['dimensions'][DimensionName] {
  let ids = idColumns?.filter(name => table.columns.some(column => column.name === name)) ?? []
  if (!idColumns) {
    ids = table.columns.map(column => column.name).filter(name => {
      const lower = name.toLowerCase().trim()
      return lower === 'id' || lower === 'uuid' || lower === 'key' || lower.endsWith('_id') || lower.startsWith('id_') || ['uuid', '编号', '编码'].some(word => lower.includes(word))
    })
  }
  if (ids.length === 0) return { score: 100, issues: [], note: '未检测到 ID 类列，跳过唯一性检查' }
  const issues: Array<Record<string, unknown>> = []
  let problems = 0
  for (const name of ids) {
    const column = table.columns.find(item => item.name === name)
    if (!column) continue
    const values = column.values.filter(value => value !== null)
    const counts = new Map<string, number>()
    for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
    const duplicateCount = [...counts.values()].reduce((sum, count) => sum + Math.max(count - 1, 0), 0)
    if (duplicateCount === 0) continue
    problems += 1
    const pct = round(duplicateCount / Math.max(values.length, 1) * 100, 2)
    const top = [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
    issues.push({
      column: name,
      duplicate_count: duplicateCount,
      duplicate_pct: pct,
      top_duplicates: Object.fromEntries(top),
      suggestion: `ID 列「${name}」有 ${duplicateCount} 个重复值（${pct}%），建议核查数据来源或加主键约束`,
    })
  }
  const score = round(100 * (1 - problems / Math.max(ids.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkWhitespace(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  const strings = table.columns.filter(column => !isNumericColumn(column))
  let problems = 0
  for (const column of strings) {
    const values = column.values.filter((value): value is string => typeof value === 'string')
    if (values.length === 0) continue
    const leading = values.filter(value => value !== value.trim()).length
    const empty = values.filter(value => value.trim() === '').length
    const only = values.filter(value => /^\s+$/.test(value)).length
    if (leading + empty === 0) continue
    problems += 1
    const detail: string[] = []
    if (leading > 0) detail.push(`${leading} 个值有前后空格`)
    if (empty > 0) detail.push(`${empty} 个空字符串`)
    if (only > 0) detail.push(`${only} 个仅含空白字符`)
    issues.push({
      column: column.name,
      leading_trailing_spaces: leading,
      empty_strings: empty,
      whitespace_only: only,
      suggestion: `列「${column.name}」${detail.join('，')}，建议 strip() 清洗并将空字符串转为 NaN`,
    })
  }
  const score = round(100 * (1 - problems / Math.max(strings.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkConstant(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  let constants = 0
  for (const column of table.columns) {
    const present = column.values.filter(value => value !== null)
    const unique = new Set(present.map(value => String(value))).size
    if (unique > 1) continue
    constants += 1
    const shown = unique === 1 ? String(present[0]) : 'N/A'
    issues.push({
      column: column.name,
      unique_values: unique,
      constant_value: shown,
      suggestion: `列「${column.name}」仅有 ${unique} 个唯一值（${shown}），信息量为零，建议删除`,
    })
  }
  const score = round(100 * (1 - constants / Math.max(table.columns.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkSkew(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  const numeric = table.columns.filter(isNumericColumn)
  let skewed = 0
  for (const column of numeric) {
    const series = numericValues(column)
    if (series.length < 8) continue
    const skewness = sampleSkew(series)
    const abs = Math.abs(skewness)
    if (abs > 3) {
      skewed += 1
      const direction = skewness > 0 ? '右偏（正偏）' : '左偏（负偏）'
      issues.push({
        column: column.name,
        skewness: round(skewness, 4),
        direction,
        suggestion: `偏度 = ${skewness.toFixed(2)}（${direction}），分布极度不对称，建议 log 变换或 Box-Cox 变换`,
      })
    } else if (abs > 1) {
      issues.push({
        column: column.name,
        skewness: round(skewness, 4),
        direction: skewness > 0 ? '轻度右偏' : '轻度左偏',
        suggestion: `偏度 = ${skewness.toFixed(2)}，分布略有偏斜，如做回归分析可考虑变换`,
      })
    }
  }
  const score = round(100 * (1 - skewed / Math.max(numeric.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkNames(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  let problems = 0
  for (const column of table.columns) {
    const name = column.name
    const found: string[] = []
    if (name !== name.trim()) found.push('含前后空格')
    if (name.trim().includes(' ')) found.push('含空格')
    if (!CLEAN_RE.test(name.trim())) found.push('含特殊字符')
    if (found.length === 0) continue
    problems += 1
    issues.push({ column: name, problems: found, suggestion: `列名「${name}」${found.join('、')}，建议重命名为 snake_case 格式` })
  }
  const styles = new Set<string>()
  for (const column of table.columns) {
    const name = column.name.trim()
    if (name === name.toLowerCase()) styles.add('lower')
    else if (name === name.toUpperCase()) styles.add('upper')
    else styles.add('mixed')
  }
  const mixed = styles.size > 1
  if (mixed) {
    issues.push({
      column: '(全局)',
      problems: ['大小写风格不统一'],
      styles_found: [...styles],
      suggestion: '列名大小写不一致，建议统一为 snake_case',
    })
  }
  const penalty = problems + (mixed ? 1 : 0)
  const score = round(100 * (1 - penalty / (Math.max(table.columns.length, 1) + 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkCardinality(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  let problems = 0
  for (const column of table.columns) {
    const present = column.values.filter(value => value !== null)
    if (present.length === 0) continue
    const unique = new Set(present.map(value => String(value))).size
    const ratio = unique / present.length
    if (isNumericColumn(column)) {
      if (unique <= 2 && present.length > 20) {
        problems += 1
        issues.push({ column: column.name, unique_values: unique, total_values: present.length, suggestion: `数值列「${column.name}」仅有 ${unique} 个唯一值，可能应标记为分类变量` })
      }
    } else if (ratio > 0.95 && present.length > 50) {
      problems += 1
      issues.push({
        column: column.name,
        unique_values: unique,
        total_values: present.length,
        cardinality_ratio: round(ratio, 4),
        suggestion: `文本列「${column.name}」基数极高（${unique}/${present.length}），可能是自由文本而非分类字段，建议核查`,
      })
    }
  }
  const score = round(100 * (1 - problems / Math.max(table.columns.length, 1)), 2)
  return { score: Math.max(score, 0), issues }
}

function checkCross(table: Table): QualityReport['dimensions'][DimensionName] {
  const issues: Array<Record<string, unknown>> = []
  const pairs: Array<[Column, Column]> = []
  const earlier = [['start', 'begin', 'from'], ['create', 'signup', 'register', 'open', 'birth']]
  const later = [['end', 'finish', 'to'], ['update', 'modify', 'close', 'last_login', 'login', 'expire']]
  const columns = table.columns
  for (let i = 0; i < columns.length; i += 1) {
    for (let j = i + 1; j < columns.length; j += 1) {
      const left = columns[i]!
      const right = columns[j]!
      const l = left.name.toLowerCase().replaceAll(' ', '_')
      const r = right.name.toLowerCase().replaceAll(' ', '_')
      let matched = false
      for (let group = 0; group < earlier.length; group += 1) {
        if (earlier[group]!.some(word => l.includes(word)) && later[group]!.some(word => r.includes(word))) matched = true
      }
      if (!matched && l.includes('min') && r.includes('max') && l.replaceAll('min', '') === r.replaceAll('max', '')) matched = true
      if (matched) pairs.push([left, right])
    }
  }
  let checks = 0
  let problems = 0
  for (const [left, right] of pairs) {
    checks += 1
    const violations = comparePair(left, right)
    if (violations.count === 0) continue
    problems += 1
    const pct = round(violations.count / violations.valid * 100, 2)
    issues.push({
      columns: [left.name, right.name],
      violation_count: violations.count,
      violation_pct: pct,
      suggestion: `「${left.name}」应 ≤「${right.name}」，但有 ${violations.count} 行（${pct}%）违反此约束，建议核查`,
    })
  }
  for (let i = 0; i < columns.length; i += 1) {
    for (let j = i + 1; j < columns.length; j += 1) {
      const left = columns[i]!
      const right = columns[j]!
      if (!isNumericColumn(left) || !isNumericColumn(right)) continue
      const l = left.name.toLowerCase()
      const r = right.name.toLowerCase()
      if (!((l.includes('price') && r.includes('discount')) || (l.includes('total') && r.includes('tax')))) continue
      checks += 1
      let count = 0
      let valid = 0
      for (let row = 0; row < rowCount(table); row += 1) {
        const a = left.values[row]
        const b = right.values[row]
        if (typeof a !== 'number' || typeof b !== 'number') continue
        valid += 1
        if (b > a) count += 1
      }
      if (count === 0) continue
      problems += 1
      issues.push({ columns: [left.name, right.name], violation_count: count, suggestion: `「${right.name}」不应大于「${left.name}」，但有 ${count} 行违反` })
      void valid
    }
  }
  if (checks === 0) return { score: 100, issues: [], note: '未检测到可校验的列对组合，跳过跨列检查' }
  return { score: Math.max(round(100 * (1 - problems / checks), 2), 0), issues }
}

function comparePair(left: Column, right: Column): { count: number; valid: number } {
  const numeric = pairNumbers(left, right)
  const usable = numeric ?? pairDates(left, right)
  if (!usable) return { count: 0, valid: 0 }
  let count = 0
  for (let index = 0; index < usable.left.length; index += 1) {
    if (usable.left[index]! > usable.right[index]!) count += 1
  }
  return { count, valid: usable.left.length }
}

function pairNumbers(left: Column, right: Column): { left: number[]; right: number[] } | null {
  const a: number[] = []
  const b: number[] = []
  for (let index = 0; index < left.values.length; index += 1) {
    const lv = asNumber(left.values[index])
    const rv = asNumber(right.values[index])
    if (lv === null || rv === null) continue
    a.push(lv)
    b.push(rv)
  }
  if (a.length === 0) return null
  return { left: a, right: b }
}

function pairDates(left: Column, right: Column): { left: number[]; right: number[] } | null {
  const a: number[] = []
  const b: number[] = []
  for (let index = 0; index < left.values.length; index += 1) {
    const lv = asDate(left.values[index])
    const rv = asDate(right.values[index])
    if (lv === null || rv === null) continue
    a.push(lv)
    b.push(rv)
  }
  return a.length === 0 ? null : { left: a, right: b }
}

function detectFormat(column: Column): string | null {
  const sample = column.values.filter((value): value is string => typeof value === 'string').slice(0, 100)
  if (sample.length === 0) return null
  if (sample.filter(value => EMAIL_RE.test(value.trim())).length > sample.length * 0.5) return 'email'
  if (sample.filter(value => PHONE_RE.test(value.trim())).length > sample.length * 0.5) return 'phone'
  if (sample.filter(value => URL_RE.test(value.trim())).length > sample.length * 0.5) return 'url'
  for (const format of DATE_FORMATS) {
    if (sample.filter(value => dateMatches(value.trim(), format)).length > sample.length * 0.7) return `date:${format}`
  }
  return null
}

function matchesFormat(value: string, format: string): boolean {
  const text = value.trim()
  if (format === 'email') return EMAIL_RE.test(text)
  if (format === 'phone') return PHONE_RE.test(text)
  if (format === 'url') return URL_RE.test(text)
  if (format.startsWith('date:')) return dateMatches(text, format.slice(5))
  return true
}

function dateMatches(value: string, format: string): boolean {
  const patterns: Record<string, RegExp> = {
    '%Y-%m-%d': /^(\d{4})-(\d{2})-(\d{2})$/,
    '%Y/%m/%d': /^(\d{4})\/(\d{2})\/(\d{2})$/,
    '%d-%m-%Y': /^(\d{2})-(\d{2})-(\d{4})$/,
    '%d/%m/%Y': /^(\d{2})\/(\d{2})\/(\d{4})$/,
    '%Y-%m-%d %H:%M:%S': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    '%Y/%m/%d %H:%M:%S': /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    '%Y%m%d': /^(\d{4})(\d{2})(\d{2})$/,
    '%m/%d/%Y': /^(\d{2})\/(\d{2})\/(\d{4})$/,
    '%m-%d-%Y': /^(\d{2})-(\d{2})-(\d{4})$/,
  }
  const match = patterns[format]?.exec(value)
  if (!match) return false
  return !Number.isNaN(asDate(value) ?? Number.NaN)
}

function asDate(value: Cell | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + (value.length === 10 ? 'T00:00:00Z' : 'Z'))
  return Number.isNaN(parsed) ? null : parsed
}

function asNumber(value: Cell | undefined): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function tableFromDelimited(text: string, delimiter: string): Table {
  const rows = parseDelimited(text.replace(/^\uFEFF/, ''), delimiter)
  if (rows.length === 0) return { columns: [] }
  const header = rows[0] ?? []
  const columns = header.map((name, index) => ({
    name,
    values: rows.slice(1).map(row => coerce(row[index] ?? '')),
  }))
  return { columns }
}

function tableFromJson(text: string): Table {
  const parsed = JSON.parse(text) as unknown
  if (Array.isArray(parsed) && parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    const records = parsed as Array<Record<string, unknown>>
    const names = [...new Set(records.flatMap(record => Object.keys(record)))]
    return {
      columns: names.map(name => ({
        name,
        values: records.map(record => coerce(record[name] == null ? '' : String(record[name]))),
      })),
    }
  }
  throw new Error('JSON 需要是对象数组')
}

function coerce(raw: string): Cell {
  const text = raw.trim()
  if (text === '') return null
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    const number = Number(text)
    if (Number.isFinite(number)) return number
  }
  return raw
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1 }
        else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter) { row.push(cell); cell = ''; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    if (ch === '\r') continue
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows.filter(item => item.some(value => value !== ''))
}

function isNumericColumn(column: Column): boolean {
  const present = column.values.filter(value => value !== null)
  return present.length > 0 && present.every(value => typeof value === 'number')
}

function numericValues(column: Column): number[] {
  return column.values.filter((value): value is number => typeof value === 'number')
}

function rowCount(table: Table): number {
  return table.columns[0]?.values.length ?? 0
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo] ?? 0
  const left = sorted[lo] ?? 0
  const right = sorted[hi] ?? 0
  return left * (hi - pos) + right * (pos - lo)
}

function modeOf(values: string[]): string | undefined {
  if (values.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const best = Math.max(...counts.values())
  return [...counts.entries()].filter(([, count]) => count === best).map(([value]) => value).sort()[0]
}

function sampleSkew(values: number[]): number {
  const n = values.length
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const m2 = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n
  const m3 = values.reduce((sum, value) => sum + (value - mean) ** 3, 0) / n
  if (m2 === 0) return 0
  const g1 = m3 / m2 ** 1.5
  return g1 * Math.sqrt(n * (n - 1)) / (n - 2)
}

function formatG(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const text = Number(value.toPrecision(4)).toString()
  return text
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function topSuggestions(dimensions: QualityReport['dimensions']): string[] {
  const suggestions: string[] = []
  for (const result of Object.values(dimensions)) {
    for (const issue of result.issues) {
      const suggestion = issue.suggestion
      if (typeof suggestion === 'string' && suggestion) suggestions.push(suggestion)
    }
  }
  return suggestions.slice(0, 10)
}

/** 与 pandas sample(random_state=42) 不是同一个序列。对拍不要使用 sample。 */
export function sampleTable(table: Table, count: number): Table {
  const rows = rowCount(table)
  const order = [...Array(rows).keys()]
  let state = 42
  for (let index = order.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const swap = state % (index + 1)
    const current = order[index]!
    order[index] = order[swap]!
    order[swap] = current
  }
  const picked = order.slice(0, count).sort((a, b) => a - b)
  return {
    columns: table.columns.map(column => ({ name: column.name, values: picked.map(index => column.values[index] ?? null) })),
  }
}
