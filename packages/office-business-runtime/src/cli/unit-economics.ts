/**
 * 单位经济 CLI。参数与 unit_economics_simulator.py 相同。
 */
import { isDirectCli } from './direct.ts'
import { unitEconomicsJson, unitEconomicsText, type UnitEconomicsArgs } from '../unit-economics.ts'
import { hasFlag, parseFloatFlag, parseIntFlag, scalePercent, takeFlag, type CliResult } from './args.ts'

export function runUnitEconomicsCli(argv: readonly string[]): CliResult {
  const parsed = parse(argv)
  if (!parsed.ok) return { exitCode: 2, stdout: '', stderr: `${parsed.message}\n` }
  return { exitCode: 0, stdout: parsed.json ? unitEconomicsJson(parsed.args) : unitEconomicsText(parsed.args), stderr: '' }
}

function parse(argv: readonly string[]): { ok: true; json: boolean; args: UnitEconomicsArgs } | { ok: false; message: string } {
  const json = hasFlag(argv, '--json')
  let rest = json.rest
  const mrr = read(rest, '--mrr', 'float'); rest = mrr.rest
  const growth = read(rest, '--growth', 'float'); rest = growth.rest
  const churn = read(rest, '--churn', 'float'); rest = churn.rest
  const cac = read(rest, '--cac', 'float'); rest = cac.rest
  const margin = read(rest, '--gross-margin', 'float'); rest = margin.rest
  const spend = read(rest, '--sm-spend', 'float'); rest = spend.rest
  const months = read(rest, '--months', 'int'); rest = months.rest
  if (!mrr.present || !growth.present || !churn.present) {
    return { ok: false, message: 'unit-economics: --mrr, --growth and --churn are required' }
  }
  for (const item of [mrr, growth, churn, cac, margin, spend, months]) {
    if (item.error) return { ok: false, message: item.error }
  }
  if (rest.some(token => token.startsWith('--'))) return { ok: false, message: `unit-economics: unknown option ${rest.find(token => token.startsWith('--'))}` }
  return {
    ok: true,
    json: json.present,
    args: {
      mrr: mrr.value ?? 0,
      monthlyGrowthPct: growth.value ?? 0,
      monthlyChurnPct: churn.value ?? 0,
      cac: cac.present ? cac.value ?? null : null,
      grossMargin: scalePercent(margin.present ? margin.value ?? 70 : 70),
      smSpendPct: scalePercent(spend.present ? spend.value ?? 30 : 30),
      months: months.present ? months.value ?? 12 : 12,
    },
  }
}

function read(argv: readonly string[], name: string, kind: 'float' | 'int'): { rest: string[]; present: boolean; value?: number; error?: string } {
  const taken = takeFlag(argv, name)
  if (taken.error) return { rest: taken.rest, present: true, error: `unit-economics: ${taken.error}` }
  if (!taken.present || taken.value === undefined) return { rest: taken.rest, present: false }
  const value = kind === 'int' ? parseIntFlag(taken.value) : parseFloatFlag(taken.value)
  if (value === null) return { rest: taken.rest, present: true, error: `unit-economics: invalid number for ${name}: ${taken.value}` }
  return { rest: taken.rest, present: true, value }
}

if (isDirectCli('unit-economics.ts')) {
  const result = runUnitEconomicsCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
