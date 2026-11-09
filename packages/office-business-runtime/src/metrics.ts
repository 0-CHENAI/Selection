/**
 * SaaS 指标计算器。文本和 JSON 与 dsh 588412b 的 metrics_calculator.py 对齐。
 * 公式与文案见 saas-metrics-coach（MIT，Abbas Mir，2026）。
 */
import { pythonJsonStdout, type PyJson } from './json-python.ts'
import { pythonFixed, pythonRound } from './python-number.ts'

export interface MetricsArgs {
  mrr: number | null
  mrrLast: number | null
  customers: number | null
  churned: number | null
  newCustomers: number | null
  smSpend: number | null
  /** 已经按原脚本折成 0–1。命令行大于 1 时由 CLI 除以 100。 */
  grossMargin: number
  expansionMrr: number
  churnedMrr: number
  contractionMrr: number
  profitMargin: number | null
}

export function calculateMetrics(args: MetricsArgs): Extract<PyJson, { t: 'obj' }> {
  const entries: Array<readonly [string, PyJson]> = []
  const missing: string[] = []
  const put = (key: string, value: number, digits: number) => {
    entries.push([key, { t: 'float', n: pythonRound(value, digits) }])
  }
  const has = (key: string) => entries.some(([name]) => name === key)
  const get = (key: string) => {
    const found = entries.find(([name]) => name === key)?.[1]
    return found && typeof found === 'object' && found.t === 'float' ? found.n : undefined
  }

  if (args.mrr !== null) {
    put('MRR', args.mrr, 2)
    put('ARR', args.mrr * 12, 2)
  } else {
    missing.push('ARR/MRR — need current MRR')
  }

  if (args.mrr && args.customers) put('ARPA', args.mrr / args.customers, 2)
  else missing.push('ARPA — need MRR + customer count')

  if (args.mrr && args.mrrLast && args.mrrLast > 0) {
    put('MoM_Growth_Pct', ((args.mrr - args.mrrLast) / args.mrrLast) * 100, 2)
  } else {
    missing.push('MoM Growth — need last month MRR')
  }

  if (args.churned !== null && args.customers) put('Churn_Pct', (args.churned / args.customers) * 100, 2)
  else missing.push('Churn Rate — need churned + total customers')

  if (args.smSpend && args.newCustomers && args.newCustomers > 0) put('CAC', args.smSpend / args.newCustomers, 2)
  else missing.push('CAC — need S&M spend + new customers')

  const arpa = get('ARPA')
  const churnDec = (get('Churn_Pct') ?? 0) / 100
  if (arpa && churnDec > 0) put('LTV', (arpa / churnDec) * args.grossMargin, 2)
  else missing.push('LTV — need ARPA and churn rate')

  const ltv = get('LTV')
  const cac = get('CAC')
  if (ltv && cac && cac > 0) put('LTV_CAC', ltv / cac, 2)
  else missing.push('LTV:CAC — need both LTV and CAC')

  if (cac && arpa && arpa > 0) put('Payback_Months', cac / (arpa * args.grossMargin), 1)
  else missing.push('Payback Period — need CAC and ARPA')

  if (args.mrrLast && args.mrrLast > 0 && (args.expansionMrr || args.churnedMrr || args.contractionMrr)) {
    const nrr = ((args.mrrLast + args.expansionMrr - args.churnedMrr - args.contractionMrr) / args.mrrLast) * 100
    put('NRR_Pct', nrr, 2)
  } else if (has('Churn_Pct')) {
    put('NRR_Est_Pct', (1 - (get('Churn_Pct') ?? 0) / 100) * 100, 2)
    missing.push('NRR (accurate) — using churn-only estimate; provide expansion MRR for full NRR')
  }

  const mom = get('MoM_Growth_Pct')
  if (mom && args.profitMargin !== null) put('Rule_of_40', mom * 12 + args.profitMargin, 1)

  entries.push(['_missing', { t: 'arr', items: missing }])
  entries.push(['_gross_margin', { t: 'float', n: args.grossMargin }])
  return { t: 'obj', entries }
}

export function metricsJson(args: MetricsArgs): string {
  return pythonJsonStdout(calculateMetrics(args))
}

const LABELS: Array<readonly [string, string, string]> = [
  ['MRR', 'Monthly Recurring Revenue', '$'],
  ['ARR', 'Annual Recurring Revenue', '$'],
  ['ARPA', 'Avg Revenue Per Account/mo', '$'],
  ['MoM_Growth_Pct', 'MoM MRR Growth', '%'],
  ['Churn_Pct', 'Monthly Churn Rate', '%'],
  ['CAC', 'Customer Acquisition Cost', '$'],
  ['LTV', 'Customer Lifetime Value', '$'],
  ['LTV_CAC', 'LTV:CAC Ratio', ':1'],
  ['Payback_Months', 'CAC Payback Period', ' months'],
  ['NRR_Pct', 'NRR (Net Revenue Retention)', '%'],
  ['NRR_Est_Pct', 'NRR Estimate (churn-only)', '%'],
  ['Rule_of_40', 'Rule of 40 Score', ''],
]

export function metricsText(args: MetricsArgs): string {
  const value = calculateMetrics(args)
  const map = new Map(value.entries)
  const lines = ['='.repeat(54), '  SAAS METRICS CALCULATOR', '='.repeat(54), '']
  for (const [key, label, unit] of LABELS) {
    const raw = map.get(key)
    if (!raw || typeof raw !== 'object' || raw.t !== 'float') continue
    lines.push(`  ${label.padEnd(40, ' ')} ${formatMetric(raw.n, unit)}`)
  }
  const missing = map.get('_missing')
  if (missing && typeof missing === 'object' && missing.t === 'arr' && missing.items.length > 0) {
    lines.push('', '  Missing / estimated:')
    for (const item of missing.items) {
      if (typeof item === 'string') lines.push(`    - ${item}`)
    }
  }
  lines.push('='.repeat(54))
  return `\n${lines.join('\n')}\n`
}

function formatMetric(value: number, unit: string): string {
  if (unit === '$') return money(value)
  if (unit === '%') return `${trimFloat(value)}%`
  if (unit === ':1') return `${trimFloat(value)}:1`
  return `${trimFloat(value)}${unit}`
}

function trimFloat(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`
  return String(value)
}

function money(value: number): string {
  const fixed = pythonFixed(value, 2)
  const negative = fixed.startsWith('-')
  const unsigned = negative ? fixed.slice(1) : fixed
  const [whole, frac] = unsigned.split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${negative ? '-' : ''}${grouped}.${frac ?? '00'}`
}
