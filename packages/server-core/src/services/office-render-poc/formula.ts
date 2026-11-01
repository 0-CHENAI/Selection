/**
 * C3：不依赖 LibreOffice / HyperFormula 的工作簿重算。
 * 覆盖 dsh 588412b 三个 Excel 案例 worksheet 里出现的函数。
 * C1（OfficeCLI computedValue）由调用方放进 officeComputed，本模块做独立核对。
 */

import { strFromU8, unzipSync } from 'fflate'

export const FORMULA_FUNCTIONS = [
  'ABS', 'AND', 'AVERAGE', 'AVERAGEIFS', 'CHOOSE', 'CONCAT', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS',
  'DATE', 'IF', 'IFERROR', 'INDEX', 'INT', 'MAX', 'MIN', 'MOD', 'NA', 'NOT', 'OR', 'POWER',
  'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SQRT', 'STDEV', 'SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'TEXT', 'TRIM',
] as const

const FUNCTION_SET = new Set<string>(FORMULA_FUNCTIONS)

export type FormulaErrorCode = '#DIV/0!' | '#VALUE!' | '#NAME?' | '#REF!' | '#N/A' | '#NUM!' | '#CYCLE!'
export type CellError = { error: FormulaErrorCode }
export type CellScalar = number | string | boolean | null
export type CellData = CellScalar | CellError

export type CellInput = {
  sheet: string
  address: string
  formula?: string
  value?: CellScalar
  cachedValue?: CellScalar
  /** OfficeCLI 的 computedValue。提供时与本求值器对拍，不一致记入 divergences。 */
  officeComputed?: CellScalar
}

export type CheckSpec = {
  sheet: string
  cell: string
  expected: number | string | boolean
  tolerance?: number
}

export type RecalcResult = {
  renderer: 'selection-formula'
  order: string[]
  values: Record<string, CellData>
  changed: Array<{ ref: string; before: CellScalar | undefined; after: CellData }>
  stale: Array<{ ref: string; cached: CellScalar; computed: CellData }>
  errors: Array<{ ref: string; code: FormulaErrorCode }>
  divergences: Array<{ ref: string; office: CellScalar; independent: CellData }>
  checks: { passed: boolean; failures: Array<{ ref: string; expected: number | string | boolean; actual: CellData }> }
}

type Grid = { kind: 'grid'; rows: number; cols: number; items: CellData[] }
type Val = CellData | Grid

type RefAst = { sheet?: string; col: string; row: number }
type Ast =
  | { t: 'num'; n: number }
  | { t: 'str'; s: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; ref: RefAst }
  | { t: 'range'; a: RefAst; b: RefAst }
  | { t: 'bin'; op: string; l: Ast; r: Ast }
  | { t: 'un'; op: '-'; x: Ast }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'err'; code: FormulaErrorCode }

type Tok =
  | { k: 'num'; n: number }
  | { k: 'str'; s: string }
  | { k: 'id'; s: string }
  | { k: 'cell'; sheet?: string; col: string; row: number }
  | { k: 'op'; s: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' }
  | { k: 'colon' }

const TOLERANCE = 1e-6

export function isCellError(value: unknown): value is CellError {
  return typeof value === 'object' && value !== null && 'error' in value && !('kind' in value)
}

export function cellRef(sheet: string, address: string): string {
  return `${sheet}!${canonicalAddress(address)}`
}

export function excelDateSerial(year: number, month: number, day: number): number {
  const utc = Date.UTC(year, month - 1, day)
  const epoch = Date.UTC(1899, 11, 30)
  return Math.round((utc - epoch) / 86_400_000)
}

export function recalculateWorkbook(cells: CellInput[], checks: CheckSpec[] = [], tolerance = TOLERANCE): RecalcResult {
  const book = new Map<string, StoredCell>()
  const sheetNames = new Map<string, string>()
  for (const input of cells) {
    const sheet = canonicalSheet(input.sheet, sheetNames)
    const address = canonicalAddress(input.address)
    const formula = input.formula?.trim().replace(/^=/, '')
    let ast: Ast | undefined
    let parseError: FormulaErrorCode | undefined
    if (formula) {
      try { ast = parseFormula(formula) }
      catch { parseError = '#VALUE!' }
    }
    book.set(key(sheet, address), {
      sheet, address, formula, ast, parseError,
      literal: input.value ?? null,
      cached: input.cachedValue,
      office: input.officeComputed,
    })
  }

  const formulaCells = [...book.values()].filter(cell => cell.formula)
  const deps = new Map<string, string[]>()
  for (const cell of formulaCells) {
    const id = key(cell.sheet, cell.address)
    const edges: string[] = []
    if (cell.ast) {
      visitRefs(cell.ast, cell.sheet, ref => {
        const resolved = resolveSheet(ref.sheet, sheetNames)
        if (!resolved) return
        const dep = book.get(key(resolved, canonicalAddress(`${ref.col}${ref.row}`)))
        if (dep?.formula) edges.push(key(dep.sheet, dep.address))
      })
    }
    deps.set(id, edges)
  }

  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const cell of formulaCells) {
    const id = key(cell.sheet, cell.address)
    indegree.set(id, 0)
    outgoing.set(id, [])
  }
  for (const [id, edges] of deps) {
    for (const edge of edges) {
      if (!indegree.has(edge)) continue
      indegree.set(id, (indegree.get(id) ?? 0) + 1)
      outgoing.get(edge)!.push(id)
    }
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
  const order: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1
      indegree.set(next, degree)
      if (degree === 0) queue.push(next)
    }
  }
  const unresolved = new Set([...indegree.keys()].filter(id => !order.includes(id)))
  let grew = true
  while (grew) {
    grew = false
    for (const [id, edges] of deps) {
      if (unresolved.has(id)) continue
      if (edges.some(edge => unresolved.has(edge))) {
        unresolved.add(id)
        grew = true
      }
    }
  }

  const values = new Map<string, CellData>()
  for (const cell of book.values()) {
    if (!cell.formula) values.set(key(cell.sheet, cell.address), cell.literal)
  }
  for (const id of order) {
    const cell = book.get(id)!
    values.set(id, cell.parseError ? { error: cell.parseError } : evalCell(cell.ast!, cell.sheet, sheetNames, book, values))
  }
  for (const id of unresolved) values.set(id, { error: '#CYCLE!' })

  const result: RecalcResult = {
    renderer: 'selection-formula',
    order: order.map(displayRef),
    values: {},
    changed: [],
    stale: [],
    errors: [],
    divergences: [],
    checks: { passed: true, failures: [] },
  }
  for (const [id, value] of values) {
    const ref = displayRef(id)
    result.values[ref] = value
    const cell = book.get(id)
    if (!cell) continue
    if (isCellError(value)) result.errors.push({ ref, code: value.error })
    if (cell.cached !== undefined && !sameValue(cell.cached, value, tolerance)) {
      result.stale.push({ ref, cached: cell.cached, computed: value })
    }
    if (cell.formula && !sameValue(cell.cached ?? null, value, tolerance)) {
      result.changed.push({ ref, before: cell.cached, after: value })
    }
    if (cell.office !== undefined && !sameValue(cell.office, value, tolerance)) {
      result.divergences.push({ ref, office: cell.office, independent: value })
    }
  }
  for (const check of checks) {
    const sheet = resolveSheet(check.sheet, sheetNames) ?? check.sheet
    const ref = cellRef(sheet, check.cell)
    const actual = result.values[ref] ?? null
    const limit = check.tolerance ?? tolerance
    if (!sameValue(check.expected, actual, limit)) {
      result.checks.passed = false
      result.checks.failures.push({ ref, expected: check.expected, actual })
    }
  }
  return result
}

type StoredCell = {
  sheet: string
  address: string
  formula?: string
  ast?: Ast
  parseError?: FormulaErrorCode
  literal: CellScalar
  cached?: CellScalar
  office?: CellScalar
}

function evalCell(ast: Ast, sheet: string, names: Map<string, string>, book: Map<string, StoredCell>, values: Map<string, CellData>): CellData {
  const value = evalAst(ast, sheet, names, book, values)
  if (isGrid(value)) return { error: '#VALUE!' }
  return value
}

function evalAst(ast: Ast, sheet: string, names: Map<string, string>, book: Map<string, StoredCell>, values: Map<string, CellData>): Val {
  switch (ast.t) {
    case 'num': return ast.n
    case 'str': return ast.s
    case 'bool': return ast.v
    case 'err': return { error: ast.code }
    case 'ref': return readRef(ast.ref, sheet, names, book, values)
    case 'range': return readRange(ast.a, ast.b, sheet, names, book, values)
    case 'un': {
      const inner = evalAst(ast.x, sheet, names, book, values)
      if (isGrid(inner)) return mapGrid(inner, item => negate(item))
      return negate(inner)
    }
    case 'bin': return evalBin(ast.op, evalAst(ast.l, sheet, names, book, values), evalAst(ast.r, sheet, names, book, values))
    case 'call': return evalCall(ast.name, ast.args.map(arg => evalAst(arg, sheet, names, book, values)))
  }
}

function readRef(ref: RefAst, current: string, names: Map<string, string>, book: Map<string, StoredCell>, values: Map<string, CellData>): CellData {
  const sheet = resolveSheet(ref.sheet ?? current, names)
  if (!sheet) return { error: '#REF!' }
  const address = canonicalAddress(`${ref.col}${ref.row}`)
  const id = key(sheet, address)
  if (values.has(id)) return values.get(id) ?? null
  if (!book.has(id)) return null
  return book.get(id)!.literal
}

function readRange(a: RefAst, b: RefAst, current: string, names: Map<string, string>, book: Map<string, StoredCell>, values: Map<string, CellData>): Val {
  const sheetName = a.sheet ?? b.sheet ?? current
  if (a.sheet && b.sheet && resolveSheet(a.sheet, names) !== resolveSheet(b.sheet, names)) return { error: '#VALUE!' }
  const left = colIndex(a.col)
  const right = colIndex(b.col)
  const top = Math.min(a.row, b.row)
  const bottom = Math.max(a.row, b.row)
  const c1 = Math.min(left, right)
  const c2 = Math.max(left, right)
  const items: CellData[] = []
  for (let row = top; row <= bottom; row++) {
    for (let col = c1; col <= c2; col++) {
      items.push(readRef({ sheet: sheetName, col: indexToCol(col), row }, current, names, book, values))
    }
  }
  return { kind: 'grid', rows: bottom - top + 1, cols: c2 - c1 + 1, items }
}

function evalBin(op: string, left: Val, right: Val): Val {
  if (op === '&') {
    const l = scalarOf(left)
    const r = scalarOf(right)
    if (isCellError(l)) return l
    if (isCellError(r)) return r
    return excelText(l) + excelText(r)
  }
  if (isGrid(left) || isGrid(right)) return evalGridBin(op, left, right)
  if (isCellError(left)) return left
  if (isCellError(right)) return right
  if ('+-*/^'.includes(op)) {
    const l = asNumber(left)
    const r = asNumber(right)
    if (isCellError(l)) return l
    if (isCellError(r)) return r
    if (op === '+') return l + r
    if (op === '-') return l - r
    if (op === '*') return l * r
    if (op === '/') return r === 0 ? { error: '#DIV/0!' } : l / r
    if (l === 0 && r < 0) return { error: '#DIV/0!' }
    return l ** r
  }
  return compareScalars(op, left, right)
}

function evalGridBin(op: string, left: Val, right: Val): Val {
  const lg = asGrid(left)
  const rg = asGrid(right)
  if (isCellError(lg)) return lg
  if (isCellError(rg)) return rg
  if (lg.rows !== rg.rows || lg.cols !== rg.cols) return { error: '#N/A' }
  const items: CellData[] = lg.items.map((item, index) => {
    const other = rg.items[index] ?? null
    if (isCellError(item)) return item
    if (isCellError(other)) return other
    const result = '+-*/^'.includes(op) ? evalBin(op, item, other) : compareScalars(op, item, other)
    return isGrid(result) ? { error: '#VALUE!' } : result
  })
  return { kind: 'grid', rows: lg.rows, cols: lg.cols, items }
}

function evalCall(name: string, args: Val[]): Val {
  const fn = name.toUpperCase()
  if (!FUNCTION_SET.has(fn)) return { error: '#NAME?' }
  if (fn === 'IF') return evalIf(args)
  if (fn === 'IFERROR') {
    const value = args[0] ?? { error: '#N/A' }
    const fallback = args[1] ?? null
    if (isGrid(value)) return value.items.some(isCellError) ? fallback : value
    return isCellError(value) ? fallback : value
  }
  if (fn === 'DATE') return evalDate(args)
  if (fn === 'TEXT') return evalText(args)
  if (fn === 'NA') return { error: '#N/A' }
  if (fn === 'CHOOSE') return evalChoose(args)
  if (fn === 'INDEX') return evalIndex(args)
  if (fn === 'AND' || fn === 'OR' || fn === 'NOT') return evalLogic(fn, args)
  if (fn === 'CONCAT') return evalConcat(args)
  if (fn === 'TRIM') return evalTrim(args[0])
  if (fn === 'SUMIF') return aggregateIf('sum', args[0], args[1], args[2] ?? args[0])
  if (fn === 'COUNTIF') return aggregateIf('count', args[0], args[1], args[0])
  if (fn === 'SUMIFS') return reduceCriteria('sum', args.slice(1), args[0])
  if (fn === 'COUNTIFS') return reduceCriteria('count', args, args[0])
  if (fn === 'AVERAGEIFS') return reduceCriteria('sum', args.slice(1), args[0], true)
  if (fn === 'SUMPRODUCT') return evalSumProduct(args)
  const numbers = collectNumbers(args, fn === 'COUNT' || fn === 'COUNTA' ? 'count' : 'math')
  if (isCellError(numbers)) return numbers
  switch (fn) {
    case 'SUM': return sum(numbers)
    case 'AVERAGE': return numbers.length === 0 ? { error: '#DIV/0!' } : sum(numbers) / numbers.length
    case 'MIN': return numbers.length === 0 ? 0 : Math.min(...numbers)
    case 'MAX': return numbers.length === 0 ? 0 : Math.max(...numbers)
    case 'COUNT': return numbers.length
    case 'COUNTA': return countA(args)
    case 'ABS': return unaryNumber(args, value => Math.abs(value))
    case 'INT': return unaryNumber(args, value => Math.floor(value))
    case 'SQRT': return unaryNumber(args, value => value < 0 ? { error: '#NUM!' } : Math.sqrt(value))
    case 'ROUND': return roundTo(args, 'round')
    case 'ROUNDUP': return roundTo(args, 'up')
    case 'ROUNDDOWN': return roundTo(args, 'down')
    case 'MOD': return evalMod(args)
    case 'POWER': return evalBin('^', args[0] ?? { error: '#N/A' }, args[1] ?? { error: '#N/A' })
    case 'STDEV': return evalStdev(numbers)
    default: return { error: '#NAME?' }
  }
}

function evalIf(args: Val[]): Val {
  const cond = args[0]
  const yes = args[1] ?? false
  const no = args[2] ?? false
  if (isGrid(cond) || isCellError(cond)) return isCellError(cond) ? cond : { error: '#VALUE!' }
  const truth = truthy(cond)
  if (isCellError(truth)) return truth
  return truth ? yes : no
}

function evalChoose(args: Val[]): CellData {
  const index = asNumber(scalarOf(args[0] ?? { error: '#VALUE!' }))
  if (isCellError(index)) return index
  const choice = Math.trunc(index)
  if (choice < 1 || choice >= args.length) return { error: '#VALUE!' }
  const selected = args[choice]
  return isGrid(selected) ? { error: '#VALUE!' } : selected ?? { error: '#VALUE!' }
}

/** 年度经营案例只用 TEXT(日期, "m/d")。其他格式不冒充 Excel 的完整格式引擎。 */
function evalText(args: Val[]): CellData {
  const value = scalarOf(args[0] ?? { error: '#VALUE!' })
  const format = scalarOf(args[1] ?? { error: '#VALUE!' })
  if (isCellError(value)) return value
  if (isCellError(format)) return format
  const picture = excelText(format).trim().toLowerCase()
  if (picture !== 'm/d') return { error: '#VALUE!' }
  const serial = asNumber(value)
  if (isCellError(serial)) return serial
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000
  const date = new Date(utc)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

function evalDate(args: Val[]): CellData {
  const parts = args.map(asNumber)
  if (parts.some(isCellError)) return parts.find(isCellError) ?? { error: '#VALUE!' }
  const [year, month, day] = parts as number[]
  if (year === undefined || month === undefined || day === undefined) return { error: '#VALUE!' }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return { error: '#NUM!' }
  // Excel 的 DATE 会把溢出的月、日进位。案例里 12 月区间的上界写成 DATE(2025,13,1)。
  return excelDateSerial(year, month, day)
}

function evalIndex(args: Val[]): CellData {
  const grid = args[0]
  if (!isGrid(grid)) return isCellError(grid) ? grid : grid ?? { error: '#VALUE!' }
  const row = asNumber(args[1] ?? { error: '#VALUE!' })
  if (isCellError(row)) return row
  const col = args[2] === undefined ? 1 : asNumber(args[2])
  if (isCellError(col)) return col
  const r = Math.trunc(row)
  const c = Math.trunc(col)
  if (r < 1 || c < 1 || r > grid.rows || c > grid.cols) return { error: '#REF!' }
  return grid.items[(r - 1) * grid.cols + (c - 1)] ?? null
}

function evalLogic(fn: string, args: Val[]): CellData {
  if (fn === 'NOT') {
    const truth = truthy(scalarOf(args[0] ?? { error: '#VALUE!' }))
    if (isCellError(truth)) return truth
    return !truth
  }
  const flags: boolean[] = []
  for (const arg of args) {
    const items = isGrid(arg) ? arg.items : [arg]
    for (const item of items) {
      if (item === null || item === '') continue
      const truth = truthy(item)
      if (isCellError(truth)) return truth
      flags.push(truth)
    }
  }
  if (flags.length === 0) return { error: '#VALUE!' }
  return fn === 'AND' ? flags.every(Boolean) : flags.some(Boolean)
}

function evalConcat(args: Val[]): CellData {
  let text = ''
  for (const arg of args) {
    const items = isGrid(arg) ? arg.items : [arg]
    for (const item of items) {
      if (isCellError(item)) return item
      text += excelText(item)
    }
  }
  return text
}

function evalTrim(value: Val | undefined): CellData {
  const scalar = scalarOf(value ?? '')
  if (isCellError(scalar)) return scalar
  return excelText(scalar).replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ')
}

function aggregateIf(kind: 'sum' | 'count', range: Val | undefined, criteria: Val | undefined, sumRange: Val | undefined): CellData {
  return reduceCriteria(kind, [range ?? { error: '#VALUE!' }, criteria ?? { error: '#VALUE!' }], sumRange)
}

function reduceCriteria(kind: 'sum' | 'count', pairs: Val[], sumRange: Val | undefined, average = false): CellData {
  if (pairs.length < 2 || pairs.length % 2 !== 0) return { error: '#VALUE!' }
  const grids: Grid[] = []
  const tests: CellData[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    const grid = asGrid(pairs[i] ?? { error: '#VALUE!' })
    const criterion = scalarOf(pairs[i + 1] ?? { error: '#VALUE!' })
    if (isCellError(grid)) return grid
    if (isCellError(criterion)) return criterion
    grids.push(grid)
    tests.push(criterion)
  }
  const values = asGrid(sumRange ?? { error: '#VALUE!' })
  if (isCellError(values)) return values
  const length = grids[0]?.items.length ?? 0
  if (grids.some(grid => grid.items.length !== length) || values.items.length !== length) return { error: '#VALUE!' }
  let total = 0
  let count = 0
  for (let i = 0; i < length; i++) {
    if (!grids.every((grid, index) => matchesCriteria(grid.items[i] ?? null, tests[index]!))) continue
    if (kind === 'count') { count++; continue }
    const item = values.items[i] ?? null
    if (isCellError(item)) return item
    if (typeof item !== 'number') continue
    total += item
    count++
  }
  if (kind === 'count') return count
  if (average) return count === 0 ? { error: '#DIV/0!' } : total / count
  return total
}

function evalSumProduct(args: Val[]): CellData {
  if (args.length === 0) return { error: '#VALUE!' }
  const grids = args.map(asGrid)
  if (grids.some(isCellError)) return grids.find(isCellError) ?? { error: '#VALUE!' }
  const shaped = grids as Grid[]
  const length = shaped[0]!.items.length
  if (shaped.some(grid => grid.items.length !== length)) return { error: '#VALUE!' }
  let total = 0
  for (let i = 0; i < length; i++) {
    let product = 1
    for (const grid of shaped) {
      const number = asNumber(grid.items[i] ?? null)
      if (isCellError(number)) return number
      product *= number
    }
    total += product
  }
  return total
}

function evalStdev(numbers: number[]): CellData {
  if (numbers.length < 2) return { error: '#DIV/0!' }
  const mean = sum(numbers) / numbers.length
  const square = numbers.reduce((total, value) => total + (value - mean) ** 2, 0)
  return Math.sqrt(square / (numbers.length - 1))
}

function roundTo(args: Val[], mode: 'round' | 'up' | 'down'): CellData {
  const number = asNumber(scalarOf(args[0] ?? { error: '#VALUE!' }))
  const digits = asNumber(scalarOf(args[1] ?? 0))
  if (isCellError(number)) return number
  if (isCellError(digits)) return digits
  const factor = 10 ** Math.trunc(digits)
  const scaled = number * factor
  const rounded = mode === 'up' ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
    : mode === 'down' ? Math.sign(scaled) * Math.floor(Math.abs(scaled))
      : Math.round(scaled)
  return rounded / factor
}

function evalMod(args: Val[]): CellData {
  const number = asNumber(scalarOf(args[0] ?? { error: '#VALUE!' }))
  const divisor = asNumber(scalarOf(args[1] ?? { error: '#VALUE!' }))
  if (isCellError(number)) return number
  if (isCellError(divisor)) return divisor
  if (divisor === 0) return { error: '#DIV/0!' }
  return number - divisor * Math.floor(number / divisor)
}

function unaryNumber(args: Val[], fn: (value: number) => CellData): CellData {
  const number = asNumber(scalarOf(args[0] ?? { error: '#VALUE!' }))
  if (isCellError(number)) return number
  return fn(number)
}

function collectNumbers(args: Val[], mode: 'math' | 'count'): number[] | CellError {
  const numbers: number[] = []
  for (const arg of args) {
    const items = isGrid(arg) ? arg.items : [arg]
    for (const item of items) {
      if (isCellError(item)) return item
      if (typeof item === 'number') numbers.push(item)
      else if (typeof item === 'boolean' && mode === 'math') numbers.push(item ? 1 : 0)
      else if (mode === 'math' && !isGrid(arg) && item !== null) {
        const number = asNumber(item)
        if (isCellError(number)) return number
        numbers.push(number)
      }
    }
  }
  return numbers
}

function countA(args: Val[]): number {
  let count = 0
  for (const arg of args) {
    const items = isGrid(arg) ? arg.items : [arg]
    for (const item of items) if (item !== null && item !== '') count++
  }
  return count
}

function matchesCriteria(value: CellData, criteria: CellData): boolean {
  if (isCellError(value) || isCellError(criteria)) return false
  if (typeof criteria === 'string') {
    const op = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(criteria)
    if (op) {
      const raw = op[2] ?? ''
      const target = numericText(raw)
      const current = typeof value === 'number' || typeof value === 'boolean' ? (value === true ? 1 : value === false ? 0 : value) : value
      if (typeof target === 'number' && typeof current === 'number') return compareNumber(op[1]!, current, target)
      return compareNumber(op[1]!, excelText(value).toLowerCase(), String(target).toLowerCase())
    }
    if (/[*?]/.test(criteria)) {
      const pattern = criteria.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(excelText(value))
    }
    if (typeof value === 'number' && numericText(criteria) === value) return true
    return excelText(value).toLowerCase() === criteria.toLowerCase()
  }
  if (typeof criteria === 'number') return typeof value === 'number' && Math.abs(value - criteria) <= TOLERANCE
  if (typeof criteria === 'boolean') return value === criteria
  return value === null || value === ''
}

function compareNumber(op: string, left: number | string, right: number | string): boolean {
  if (op === '=') return left === right
  if (op === '<>') return left !== right
  if (op === '<') return left < right
  if (op === '>') return left > right
  if (op === '<=') return left <= right
  return left >= right
}

function numericText(value: string): number | string {
  if (value.trim() === '') return value
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}

function compareScalars(op: string, left: CellData, right: CellData): CellData {
  if (isCellError(left)) return left
  if (isCellError(right)) return right
  const ln = typeof left === 'number' || typeof left === 'boolean' ? (left === true ? 1 : left === false ? 0 : left) : null
  const rn = typeof right === 'number' || typeof right === 'boolean' ? (right === true ? 1 : right === false ? 0 : right) : null
  if (ln !== null && rn !== null) return compareNumber(op, ln, rn)
  return compareNumber(op, excelText(left).toLowerCase(), excelText(right).toLowerCase())
}

function truthy(value: CellData): boolean | CellError {
  if (isCellError(value)) return value
  if (value === null || value === '' || value === false || value === 0) return false
  if (value === true) return true
  if (typeof value === 'number') return value !== 0
  const upper = value.toUpperCase()
  if (upper === 'TRUE') return true
  if (upper === 'FALSE') return false
  return { error: '#VALUE!' }
}

function negate(value: CellData): CellData {
  if (isCellError(value)) return value
  const number = asNumber(value === null ? 0 : value)
  if (isCellError(number)) return number
  return -number
}

function asNumber(value: unknown): number | CellError {
  if (isGrid(value)) return { error: '#VALUE!' }
  if (isCellError(value)) return value
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'string') {
    const number = Number(value)
    return Number.isFinite(number) ? number : { error: '#VALUE!' }
  }
  return { error: '#VALUE!' }
}

function scalarOf(value: Val): CellData {
  if (isGrid(value)) return { error: '#VALUE!' }
  return value
}

function asGrid(value: Val): Grid | CellError {
  if (isCellError(value)) return value
  if (isGrid(value)) return value
  return { kind: 'grid', rows: 1, cols: 1, items: [value] }
}

function mapGrid(grid: Grid, fn: (item: CellData) => CellData): Grid {
  return { kind: 'grid', rows: grid.rows, cols: grid.cols, items: grid.items.map(fn) }
}

function isGrid(value: unknown): value is Grid {
  return typeof value === 'object' && value !== null && 'kind' in value && (value as Grid).kind === 'grid'
}

function excelText(value: CellScalar): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    const rounded = Math.round(value)
    if (Math.abs(value - rounded) < 1e-10) return String(rounded)
    return String(value)
  }
  return value
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function sameValue(left: CellScalar | undefined, right: CellData, tolerance: number): boolean {
  if (left === undefined) return false
  if (isCellError(right)) return false
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) <= tolerance
  if (typeof left === 'boolean' || typeof right === 'boolean') return left === right
  return excelText(left ?? null) === excelText(right)
}

function canonicalSheet(name: string, names: Map<string, string>): string {
  const found = names.get(name.toLowerCase())
  if (found) return found
  names.set(name.toLowerCase(), name)
  return name
}

function resolveSheet(name: string | undefined, names: Map<string, string>): string | undefined {
  if (!name) return undefined
  return names.get(name.toLowerCase())
}

function canonicalAddress(address: string): string {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(address.trim())
  if (!match) return address.trim().toUpperCase()
  return `${match[1]!.toUpperCase()}${match[2]}`
}

function key(sheet: string, address: string): string {
  return `${sheet}!${address}`
}

function displayRef(id: string): string {
  return id
}

function colIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function indexToCol(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function visitRefs(ast: Ast, sheet: string, visit: (ref: RefAst) => void): void {
  switch (ast.t) {
    case 'ref':
      visit({ ...ast.ref, sheet: ast.ref.sheet ?? sheet })
      return
    case 'range': {
      const owner = ast.a.sheet ?? ast.b.sheet ?? sheet
      const c1 = Math.min(colIndex(ast.a.col), colIndex(ast.b.col))
      const c2 = Math.max(colIndex(ast.a.col), colIndex(ast.b.col))
      const r1 = Math.min(ast.a.row, ast.b.row)
      const r2 = Math.max(ast.a.row, ast.b.row)
      for (let row = r1; row <= r2; row++) {
        for (let col = c1; col <= c2; col++) visit({ sheet: owner, col: indexToCol(col), row })
      }
      return
    }
    case 'bin':
      visitRefs(ast.l, sheet, visit)
      visitRefs(ast.r, sheet, visit)
      return
    case 'un':
      visitRefs(ast.x, sheet, visit)
      return
    case 'call':
      for (const arg of ast.args) visitRefs(arg, sheet, visit)
      return
    default:
      return
  }
}

function parseFormula(input: string): Ast {
  const tokens = tokenize(input)
  let i = 0
  const peek = () => tokens[i]
  const take = () => tokens[i++]
  function parseCmp(): Ast {
    let left = parseConcat()
    while (peek()?.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { s: string }).s)) {
      const op = (take() as { s: string }).s
      left = { t: 'bin', op, l: left, r: parseConcat() }
    }
    return left
  }
  function parseConcat(): Ast {
    let left = parseAdd()
    while (peek()?.k === 'op' && (peek() as { s: string }).s === '&') {
      take()
      left = { t: 'bin', op: '&', l: left, r: parseAdd() }
    }
    return left
  }
  function parseAdd(): Ast {
    let left = parseMul()
    while (peek()?.k === 'op' && ['+', '-'].includes((peek() as { s: string }).s)) {
      const op = (take() as { s: string }).s
      left = { t: 'bin', op, l: left, r: parseMul() }
    }
    return left
  }
  function parseMul(): Ast {
    let left = parsePow()
    while (peek()?.k === 'op' && ['*', '/'].includes((peek() as { s: string }).s)) {
      const op = (take() as { s: string }).s
      left = { t: 'bin', op, l: left, r: parsePow() }
    }
    return left
  }
  function parsePow(): Ast {
    const left = parseUnary()
    if (peek()?.k === 'op' && (peek() as { s: string }).s === '^') {
      take()
      return { t: 'bin', op: '^', l: left, r: parsePow() }
    }
    return left
  }
  function parseUnary(): Ast {
    if (peek()?.k === 'op' && (peek() as { s: string }).s === '+') { take(); return parseUnary() }
    if (peek()?.k === 'op' && (peek() as { s: string }).s === '-') return { t: 'un', op: '-', x: (take(), parseUnary()) }
    return parsePrimary()
  }
  function parsePrimary(): Ast {
    const token = take()
    if (!token) throw new Error('公式不完整')
    if (token.k === 'num') return { t: 'num', n: token.n }
    if (token.k === 'str') return { t: 'str', s: token.s }
    if (token.k === 'cell') return parseRef(token)
    if (token.k === 'lp') {
      const inner = parseCmp()
      if (take()?.k !== 'rp') throw new Error('缺少右括号')
      return inner
    }
    if (token.k === 'id') {
      const upper = token.s.toUpperCase()
      if (upper === 'TRUE') return { t: 'bool', v: true }
      if (upper === 'FALSE') return { t: 'bool', v: false }
      if (peek()?.k === 'lp') {
        take()
        const args: Ast[] = []
        if (peek()?.k !== 'rp') {
          args.push(parseCmp())
          while (peek()?.k === 'comma') { take(); args.push(parseCmp()) }
        }
        if (take()?.k !== 'rp') throw new Error('函数缺少右括号')
        return { t: 'call', name: upper, args }
      }
      return { t: 'err', code: '#NAME?' }
    }
    throw new Error('无法解析公式')
  }
  function parseRef(token: Extract<Tok, { k: 'cell' }>): Ast {
    const first: RefAst = { sheet: token.sheet, col: token.col, row: token.row }
    if (peek()?.k !== 'colon') return { t: 'ref', ref: first }
    take()
    const next = take()
    if (next?.k !== 'cell') throw new Error('区域缺少结束单元格')
    const second: RefAst = { sheet: next.sheet ?? first.sheet, col: next.col, row: next.row }
    if (!first.sheet && second.sheet) first.sheet = second.sheet
    return { t: 'range', a: first, b: second }
  }
  const ast = parseCmp()
  if (i !== tokens.length) throw new Error('公式有多余内容')
  return ast
}

function tokenize(input: string): Tok[] {
  const source = input
  const tokens: Tok[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '"') {
      let text = ''
      i++
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') { text += '"'; i += 2; continue }
          break
        }
        text += source[i++]
      }
      if (source[i] !== '"') throw new Error('字符串没有结束')
      i++
      tokens.push({ k: 'str', s: text })
      continue
    }
    if (ch === "'") {
      let name = ''
      i++
      while (i < source.length) {
        if (source[i] === "'") {
          if (source[i + 1] === "'") { name += "'"; i += 2; continue }
          break
        }
        name += source[i++]
      }
      if (source[i] !== "'" || source[i + 1] !== '!') throw new Error('工作表名没有结束')
      i += 2
      const cell = readCell(source, i)
      if (!cell) throw new Error('工作表后面没有单元格')
      tokens.push({ k: 'cell', sheet: name, col: cell.col, row: cell.row })
      i = cell.end
      continue
    }
    const two = source.slice(i, i + 2)
    if (two === '>=' || two === '<=' || two === '<>') { tokens.push({ k: 'op', s: two }); i += 2; continue }
    if ('+-*/^&=<>(),:'.includes(ch)) {
      const kind = ch === '(' ? 'lp' : ch === ')' ? 'rp' : ch === ',' ? 'comma' : ch === ':' ? 'colon' : 'op'
      if (kind === 'op') tokens.push({ k: 'op', s: ch })
      else tokens.push({ k: kind })
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)/.exec(source.slice(i))
      if (!match) throw new Error('数字无效')
      tokens.push({ k: 'num', n: Number(match[1]) })
      i += match[1]!.length
      continue
    }
    if (ch === '$') {
      const absolute = readCell(source, i)
      if (!absolute) throw new Error('绝对引用无效')
      tokens.push({ k: 'cell', col: absolute.col, row: absolute.row })
      i = absolute.end
      continue
    }
    if (/[A-Za-z_\u0080-\uFFFF]/.test(ch)) {
      const cell = readCell(source, i)
      const word = readWord(source, i)
      if (source[word.end] === '!') {
        const after = readCell(source, word.end + 1)
        if (!after) throw new Error('工作表后面没有单元格')
        tokens.push({ k: 'cell', sheet: word.text, col: after.col, row: after.row })
        i = after.end
        continue
      }
      // C$72 这种「列相对、行绝对」里，$ 会让单元格比单词更长。整段仍是一个引用。
      if (cell && cell.end >= word.end) {
        tokens.push({ k: 'cell', col: cell.col, row: cell.row })
        i = cell.end
        continue
      }
      if (!word.text) throw new Error('无法识别的符号')
      tokens.push({ k: 'id', s: word.text })
      i = word.end
      continue
    }
    throw new Error(`无法识别的符号 ${ch}`)
  }
  return tokens
}

function readCell(source: string, index: number): { col: string; row: number; end: number } | null {
  let i = index
  if (source[i] === '$') i++
  const colStart = i
  while (i < source.length && /[A-Za-z]/.test(source[i]!)) i++
  const col = source.slice(colStart, i)
  if (!col || col.length > 3) return null
  if (source[i] === '$') i++
  const rowStart = i
  while (i < source.length && /[0-9]/.test(source[i]!)) i++
  if (i === rowStart) return null
  return { col: col.toUpperCase(), row: Number(source.slice(rowStart, i)), end: i }
}

function readWord(source: string, index: number): { text: string; end: number } {
  let i = index
  if (source[i] === '$') return { text: '', end: index }
  while (i < source.length && /[A-Za-z0-9_\u0080-\uFFFF.]/.test(source[i]!)) i++
  return { text: source.slice(index, i), end: i }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * 从 xlsx 包读出单元格。共享公式、图表缓存不在本读取范围内。
 * 年度经营案例的工作表使用 `x:` 前缀；港口和实验案例使用默认命名空间。读取前去掉元素前缀。
 */
export function readXlsxCells(bytes: Uint8Array): CellInput[] {
  const cells: CellInput[] = []
  const files = unzip(bytes)
  const workbook = stripElementPrefixes(textFile(files, 'xl/workbook.xml'))
  const rels = textFile(files, 'xl/_rels/workbook.xml.rels')
  const relMap = new Map<string, string>()
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const attr = tagAttrs(tag)
    if (attr.Id && attr.Target) relMap.set(attr.Id, attr.Target)
  }
  const shared = sharedStrings(files)
  for (const tag of workbook.match(/<sheet\b[^>]*>/g) ?? []) {
    const attr = tagAttrs(tag)
    const name = attr.name
    const target = attr['r:id'] ? relMap.get(attr['r:id']) : undefined
    if (!name || !target) continue
    const path = target.replace(/^\/+/, '').replace(/^xl\//, '')
    const xml = stripElementPrefixes(textFile(files, `xl/${path}`))
    for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = tagAttrs(`<c ${match[1]}>`)
      const address = attr.r
      if (!address) continue
      const inner = match[2] ?? ''
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      const inline = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1] ?? '')).join('')
      const input: CellInput = { sheet: name, address }
      if (formula !== undefined) input.formula = decodeXml(formula)
      const cached = cellValue(attr.t, raw, inline, shared)
      if (formula !== undefined) {
        if (cached !== undefined) input.cachedValue = cached
      } else if (cached !== undefined) input.value = cached
      else if (inline) input.value = inline
      if (input.formula !== undefined || input.value !== undefined || input.cachedValue !== undefined) cells.push(input)
    }
  }
  return cells
}

function cellValue(type: string | undefined, raw: string | undefined, inline: string, shared: string[]): CellScalar | undefined {
  if (type === 'inlineStr') return inline
  if (raw === undefined) return inline ? inline : undefined
  const text = decodeXml(raw)
  if (type === 's') return shared[Number(text)] ?? text
  if (type === 'b') return text === '1'
  if (type === 'str') return text
  const number = Number(text)
  return Number.isFinite(number) ? number : text
}

function stripElementPrefixes(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1')
}

function sharedStrings(files: Map<string, string>): string[] {
  const xml = stripElementPrefixes(files.get('xl/sharedStrings.xml') ?? '')
  if (!xml) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
    [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1] ?? '')).join(''),
  )
}

function tagAttrs(tag: string): Record<string, string> {
  const attr: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) attr[match[1]!] = decodeXml(match[2]!)
  return attr
}

function textFile(files: Map<string, string>, path: string): string {
  return files.get(path) ?? ''
}

function unzip(bytes: Uint8Array): Map<string, string> {
  return unzipSyncText(bytes)
}

function unzipSyncText(bytes: Uint8Array): Map<string, string> {
  const parts = unzipSync(bytes)
  const files = new Map<string, string>()
  for (const [name, data] of Object.entries(parts)) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) files.set(name, strFromU8(data))
  }
  return files
}
