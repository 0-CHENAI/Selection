/**
 * SaaS 指标 CLI。参数与 metrics_calculator.py 相同，由 Bun 执行。
 */
import { metricsJson, metricsText, type MetricsArgs } from '../metrics.ts'
import { hasFlag, parseFloatFlag, parseIntFlag, scalePercent, takeFlag, type CliResult } from './args.ts'

export function runMetricsCli(argv: readonly string[]): CliResult {
  const parsed = parse(argv)
  if (!parsed.ok) return { exitCode: 2, stdout: '', stderr: `${parsed.message}\n` }
  const stdout = parsed.json ? metricsJson(parsed.args) : metricsText(parsed.args)
  return { exitCode: 0, stdout, stderr: '' }
}

function parse(argv: readonly string[]): { ok: true; json: boolean; args: MetricsArgs } | { ok: false; message: string } {
  const json = hasFlag(argv, '--json')
  let rest = json.rest
  const mrr = readFloat(rest, '--mrr')
  rest = mrr.rest
  if (!mrr.present) return { ok: false, message: 'metrics: --mrr is required (interactive mode is not available)' }
  if (mrr.error || mrr.value === undefined) return { ok: false, message: mrr.error ?? 'metrics: invalid --mrr' }
  const mrrLast = readFloat(rest, '--mrr-last'); rest = mrrLast.rest
  const customers = readInt(rest, '--customers'); rest = customers.rest
  const churned = readInt(rest, '--churned'); rest = churned.rest
  const newCustomers = readInt(rest, '--new-customers'); rest = newCustomers.rest
  const sm = readFloat(rest, '--sm-spend'); rest = sm.rest
  const margin = readFloat(rest, '--gross-margin'); rest = margin.rest
  const expansion = readFloat(rest, '--expansion-mrr'); rest = expansion.rest
  const churnedMrr = readFloat(rest, '--churned-mrr'); rest = churnedMrr.rest
  const contraction = readFloat(rest, '--contraction-mrr'); rest = contraction.rest
  const profit = readFloat(rest, '--profit-margin'); rest = profit.rest
  const unknown = rest.find(token => token.startsWith('--'))
  if (unknown) return { ok: false, message: `metrics: unknown option ${unknown}` }
  if (rest.length > 0) return { ok: false, message: `metrics: unexpected argument ${rest[0]}` }
  for (const item of [mrrLast, sm, margin, expansion, churnedMrr, contraction, profit]) {
    if (item.error) return { ok: false, message: item.error }
  }
  for (const item of [customers, churned, newCustomers]) {
    if (item.error) return { ok: false, message: item.error }
  }
  const gross = margin.present ? margin.value ?? 70 : 70
  return {
    ok: true,
    json: json.present,
    args: {
      mrr: mrr.value,
      mrrLast: mrrLast.value ?? null,
      customers: customers.value ?? null,
      churned: churned.value ?? null,
      newCustomers: newCustomers.value ?? null,
      smSpend: sm.value ?? null,
      grossMargin: scalePercent(gross),
      expansionMrr: expansion.value ?? 0,
      churnedMrr: churnedMrr.value ?? 0,
      contractionMrr: contraction.value ?? 0,
      profitMargin: profit.present ? profit.value ?? null : null,
    },
  }
}

function readFloat(argv: readonly string[], name: string): { rest: string[]; present: boolean; value?: number; error?: string } {
  const taken = takeFlag(argv, name)
  if (taken.error) return { rest: taken.rest, present: true, error: `metrics: ${taken.error}` }
  if (!taken.present || taken.value === undefined) return { rest: taken.rest, present: false }
  const value = parseFloatFlag(taken.value)
  if (value === null) return { rest: taken.rest, present: true, error: `metrics: invalid number for ${name}: ${taken.value}` }
  return { rest: taken.rest, present: true, value }
}

function readInt(argv: readonly string[], name: string): { rest: string[]; present: boolean; value?: number; error?: string } {
  const taken = takeFlag(argv, name)
  if (taken.error) return { rest: taken.rest, present: true, error: `metrics: ${taken.error}` }
  if (!taken.present || taken.value === undefined) return { rest: taken.rest, present: false }
  const value = parseIntFlag(taken.value)
  if (value === null) return { rest: taken.rest, present: true, error: `metrics: invalid integer for ${name}: ${taken.value}` }
  return { rest: taken.rest, present: true, value }
}

if (import.meta.main) {
  const result = runMetricsCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
