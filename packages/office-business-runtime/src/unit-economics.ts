/**
 * 单位经济 12 个月投影。与 unit_economics_simulator.py 的字段和文本对齐。
 */
import { pythonJsonStdout, type PyJson } from './json-python.ts'
import { pythonFixed, pythonRound } from './python-number.ts'

export interface UnitEconomicsArgs {
  mrr: number
  monthlyGrowthPct: number
  monthlyChurnPct: number
  cac: number | null
  /** 0–1。命令行大于 1 时由 CLI 除以 100。 */
  grossMargin: number
  smSpendPct: number
  months: number
}

export function simulateUnitEconomics(args: UnitEconomicsArgs): PyJson {
  const projections: PyJson[] = []
  let current = args.mrr
  let cumulativeSm = 0
  let cumulativeGross = 0
  const netRate = args.monthlyGrowthPct / 100 - args.monthlyChurnPct / 100
  for (let month = 1; month <= args.months; month += 1) {
    const revenue = current
    const gross = revenue * args.grossMargin
    const sm = revenue * args.smSpendPct
    cumulativeSm += sm
    cumulativeGross += gross
    projections.push({
      t: 'obj',
      entries: [
        ['month', { t: 'int', n: month }],
        ['mrr', float(current, 2)],
        ['arr', float(current * 12, 2)],
        ['monthly_revenue', float(revenue, 2)],
        ['gross_profit', float(gross, 2)],
        ['sm_spend', float(sm, 2)],
        ['net_profit', float(gross - sm, 2)],
        ['growth_rate_pct', float(netRate * 100, 2)],
      ],
    })
    current *= 1 + netRate
  }
  const finalMrr = projections.length === 0 ? args.mrr : floatValue(projections[projections.length - 1]!, 'mrr')
  const finalArr = projections.length === 0 ? args.mrr * 12 : floatValue(projections[projections.length - 1]!, 'arr')
  const totalRevenue = projections.reduce((sum, row) => sum + floatValue(row, 'monthly_revenue'), 0)
  const totalNet = projections.reduce((sum, row) => sum + floatValue(row, 'net_profit'), 0)
  return {
    t: 'obj',
    entries: [
      ['inputs', {
        t: 'obj',
        entries: [
          ['starting_mrr', { t: 'float', n: args.mrr }],
          ['monthly_growth_pct', { t: 'float', n: args.monthlyGrowthPct }],
          ['monthly_churn_pct', { t: 'float', n: args.monthlyChurnPct }],
          ['cac', args.cac === null ? null : { t: 'float', n: args.cac }],
          ['gross_margin', { t: 'float', n: args.grossMargin }],
          ['sm_spend_pct', { t: 'float', n: args.smSpendPct }],
        ],
      }],
      ['projections', { t: 'arr', items: projections }],
      ['summary', {
        t: 'obj',
        entries: [
          ['starting_mrr', { t: 'float', n: args.mrr }],
          ['ending_mrr', float(finalMrr, 2)],
          ['ending_arr', float(finalArr, 2)],
          ['mrr_growth_pct', float(args.mrr !== 0 ? ((finalMrr - args.mrr) / args.mrr) * 100 : 0, 2)],
          ['total_revenue_12m', float(totalRevenue, 2)],
          ['total_gross_profit_12m', float(cumulativeGross, 2)],
          ['total_sm_spend_12m', float(cumulativeSm, 2)],
          ['total_net_profit_12m', float(totalNet, 2)],
          ['avg_monthly_growth_pct', float(args.monthlyGrowthPct - args.monthlyChurnPct, 2)],
        ],
      }],
    ],
  }
}

export function unitEconomicsJson(args: UnitEconomicsArgs): string {
  return pythonJsonStdout(simulateUnitEconomics(args))
}

export function unitEconomicsText(args: UnitEconomicsArgs): string {
  const value = simulateUnitEconomics(args)
  if (!value || typeof value !== 'object' || value.t !== 'obj') return ''
  const inputs = objectOf(value, 'inputs')
  const summary = objectOf(value, 'summary')
  const projections = arrayOf(value, 'projections')
  const lines = [
    '',
    '='.repeat(70),
    'UNIT ECONOMICS SIMULATION - 12 MONTH PROJECTION',
    '='.repeat(70),
    '',
    '📊 INPUTS',
    `  Starting MRR: ${wholeMoney(num(inputs, 'starting_mrr'))}`,
    `  Monthly Growth: ${plainFloat(num(inputs, 'monthly_growth_pct'))}%`,
    `  Monthly Churn: ${plainFloat(num(inputs, 'monthly_churn_pct'))}%`,
  ]
  const cac = inputs.get('cac')
  if (cac !== null && cac !== undefined) lines.push(`  CAC: ${wholeMoney(num(inputs, 'cac'))}`)
  lines.push(
    `  Gross Margin: ${pythonFixed(num(inputs, 'gross_margin') * 100, 0)}%`,
    `  S&M Spend: ${pythonFixed(num(inputs, 'sm_spend_pct') * 100, 0)}% of revenue`,
    '',
    '📈 12-MONTH SUMMARY',
    `  Starting MRR: ${wholeMoney(num(summary, 'starting_mrr'))}`,
    `  Ending MRR: ${wholeMoney(num(summary, 'ending_mrr'))}`,
    `  Ending ARR: ${wholeMoney(num(summary, 'ending_arr'))}`,
    `  MRR Growth: ${signed1(num(summary, 'mrr_growth_pct'))}%`,
    `  Total Revenue: ${wholeMoney(num(summary, 'total_revenue_12m'))}`,
    `  Total Gross Profit: ${wholeMoney(num(summary, 'total_gross_profit_12m'))}`,
    `  Total S&M Spend: ${wholeMoney(num(summary, 'total_sm_spend_12m'))}`,
    `  Total Net Profit: ${wholeMoney(num(summary, 'total_net_profit_12m'))}`,
    '',
    '📅 MONTHLY PROJECTIONS',
    `${'Month'.padEnd(8, ' ')} ${'MRR'.padEnd(12, ' ')} ${'ARR'.padEnd(12, ' ')} ${'Revenue'.padEnd(12, ' ')} ${'Net Profit'.padEnd(12, ' ')}`,
    '-'.repeat(70),
  )
  const show = projections.length > 6
    ? [...projections.slice(0, 3), null, ...projections.slice(-3)]
    : projections
  for (const row of show) {
    if (!row) {
      lines.push('  ...')
      continue
    }
    const cells = objectEntries(row)
    lines.push(
      `${String(intOf(cells, 'month')).padEnd(8, ' ')}`
      + ` $${numField(numOf(cells, 'mrr'))}`
      + ` $${numField(numOf(cells, 'arr'))}`
      + ` $${numField(numOf(cells, 'monthly_revenue'))}`
      + ` $${numField(numOf(cells, 'net_profit'))}`,
    )
  }
  lines.push('', '='.repeat(70), '')
  return `${lines.join('\n')}\n`
}

function float(value: number, digits: number): PyJson {
  return { t: 'float', n: pythonRound(value, digits) }
}

function floatValue(row: PyJson, key: string): number {
  if (!row || typeof row !== 'object' || row.t !== 'obj') return 0
  const found = row.entries.find(([name]) => name === key)?.[1]
  return found && typeof found === 'object' && found.t === 'float' ? found.n : 0
}

function objectOf(root: Extract<PyJson, { t: 'obj' }>, key: string): Map<string, PyJson> {
  const found = root.entries.find(([name]) => name === key)?.[1]
  if (!found || typeof found !== 'object' || found.t !== 'obj') return new Map()
  return new Map(found.entries)
}

function arrayOf(root: Extract<PyJson, { t: 'obj' }>, key: string): PyJson[] {
  const found = root.entries.find(([name]) => name === key)?.[1]
  if (!found || typeof found !== 'object' || found.t !== 'arr') return []
  return [...found.items]
}

function objectEntries(row: PyJson): Map<string, PyJson> {
  return row && typeof row === 'object' && row.t === 'obj' ? new Map(row.entries) : new Map()
}

function num(map: Map<string, PyJson>, key: string): number {
  const value = map.get(key)
  return value && typeof value === 'object' && value.t === 'float' ? value.n : 0
}

function numOf(map: Map<string, PyJson>, key: string): number {
  return num(map, key)
}

function intOf(map: Map<string, PyJson>, key: string): number {
  const value = map.get(key)
  return value && typeof value === 'object' && value.t === 'int' ? value.n : 0
}

function plainFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

function signed1(value: number): string {
  const text = pythonFixed(value, 1)
  return text.startsWith('-') ? text : `+${text}`
}

function wholeMoney(value: number): string {
  const negative = value < 0
  const rounded = pythonFixed(Math.abs(value), 0)
  const grouped = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${negative ? '-' : ''}${grouped}`
}

function numField(value: number): string {
  const negative = value < 0
  const body = pythonFixed(Math.abs(value), 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${body}`.padEnd(11, ' ')
}
