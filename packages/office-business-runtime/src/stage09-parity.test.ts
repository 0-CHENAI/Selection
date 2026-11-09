import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runDataQualityCli } from './cli/data-quality.ts'
import { runInfographicCli } from './cli/build-infographic.ts'
import { runMetricsCli } from './cli/metrics.ts'
import { runUnitEconomicsCli } from './cli/unit-economics.ts'
import { auditTable, type Cell, type Table } from './data-quality.ts'
import { buildInfographic, nativeChartCommands, stableAutoPalette } from './infographic.ts'

const root = join(import.meta.dir, '../../..')
const parity = join(root, 'scripts/fixtures/office-parity')

describe('saas metrics and unit economics', () => {
  const cases: Array<[string, string, string[]]> = [
    ['metrics/partial', 'metrics', ['--mrr', '50000', '--customers', '100', '--churned', '5']],
    ['metrics/full', 'metrics', ['--mrr', '48000', '--mrr-last', '42000', '--customers', '160', '--churned', '4', '--new-customers', '22', '--sm-spend', '18000', '--gross-margin', '72', '--expansion-mrr', '2000', '--churned-mrr', '3000', '--contraction-mrr', '500', '--profit-margin', '15']],
    ['metrics/critical', 'metrics', ['--mrr', '22000', '--mrr-last', '23500', '--customers', '80', '--churned', '9', '--new-customers', '6', '--sm-spend', '15000', '--gross-margin', '65']],
  ]
  for (const [id, kind, argv] of cases) {
    test(`${id} matches dsh stdout`, () => {
      const run = kind === 'metrics' ? runMetricsCli : runUnitEconomicsCli
      const text = run(argv)
      const json = run([...argv, '--json'])
      expect(text.exitCode).toBe(0)
      expect(text.stdout).toBe(readFileSync(join(parity, `${id}.text.stdout`), 'utf8'))
      expect(json.stdout).toBe(readFileSync(join(parity, `${id}.json.stdout`), 'utf8'))
    })
  }

  test('unit economics matches the documented example', () => {
    const argv = ['--mrr', '50000', '--growth', '10', '--churn', '3', '--cac', '2000']
    const text = runUnitEconomicsCli(argv)
    const json = runUnitEconomicsCli([...argv, '--json'])
    expect(text.stdout).toBe(readFileSync(join(parity, 'unit-economics/base.text.stdout'), 'utf8'))
    expect(json.stdout).toBe(readFileSync(join(parity, 'unit-economics/base.json.stdout'), 'utf8'))
    const explicit = runUnitEconomicsCli([...argv, '--gross-margin', '70', '--sm-spend', '30', '--months', '12', '--json'])
    expect(explicit.stdout).toBe(readFileSync(join(parity, 'unit-economics/explicit-defaults.json.stdout'), 'utf8'))
  })

  test('critical scenario LTV:CAC is 0.64', () => {
    const json = JSON.parse(runMetricsCli(['--mrr', '22000', '--mrr-last', '23500', '--customers', '80', '--churned', '9', '--new-customers', '6', '--sm-spend', '15000', '--gross-margin', '65', '--json']).stdout) as { LTV_CAC: number }
    expect(json.LTV_CAC).toBeCloseTo(0.64, 9)
  })
})

describe('dataset health audit', () => {
  test('defects.csv matches the python report', () => {
    const result = runDataQualityCli([join(parity, 'data-quality/defects.csv')])
    expect(result.exitCode).toBe(0)
    const actual = JSON.parse(result.stdout) as unknown
    const expected = JSON.parse(readFileSync(join(parity, 'data-quality/defects.json.stdout'), 'utf8')) as unknown
    expect(sameJson(actual, expected)).toBe(true)
    const report = actual as { overall_score: number; grade: string; dimensions: Record<string, { issues: unknown[] }> }
    expect(report.grade).toBe('C')
    expect(report.dimensions.missing_values?.issues.length).toBeGreaterThan(0)
    expect(report.dimensions.duplicates?.issues.length).toBeGreaterThan(0)
  })

  test('injected missing, duplicate and unit errors are all detected', () => {
    const table = portDetailWithDefects()
    const report = auditTable(table, { fileName: 'port-detail.csv' })
    const missing = report.dimensions.missing_values.issues
    const duplicates = report.dimensions.duplicates.issues[0] as { duplicate_rows?: number } | undefined
    const types = report.dimensions.type_consistency.issues
    expect(missing.some(issue => issue.column === '货物吨数' && issue.missing_count === 3)).toBe(true)
    expect(duplicates?.duplicate_rows).toBe(3)
    expect(types.some(issue => issue.column === '箱量TEU' && String(issue.suggestion).includes('混合了多种类型'))).toBe(true)
  })
})

describe('data viz', () => {
  test('named palette SVG matches the python infographic', () => {
    const config = JSON.parse(readFileSync(join(parity, 'infographic/comparison.config.json'), 'utf8')) as { output?: string }
    delete config.output
    const built = buildInfographic(config)
    const golden = readFileSync(join(parity, 'infographic/comparison.html'), 'utf8')
    expect(built.html).toBe(golden)
  })

  test('comparison prefers an OfficeCLI native column chart and still writes HTML', () => {
    const config = JSON.parse(readFileSync(join(parity, 'infographic/comparison.config.json'), 'utf8')) as { title?: string; type?: string; data?: unknown; output?: string }
    delete config.output
    const commands = nativeChartCommands(config)
    expect(commands[0]?.command).toContain('type=column')
    expect(commands[0]?.command).toContain('dataRange="图表!A1:')
    expect(commands[0]?.command.includes('.png')).toBe(false)
    const rendered = runInfographicCli(['--native-chart'], JSON.stringify({ ...config, output: join(mkdtempSync(join(tmpdir(), 'ig-')), 'chart.html') }))
    expect(rendered.exitCode).toBe(0)
    const body = JSON.parse(rendered.stdout) as { native_chart: Array<{ command: string }>; type: string }
    expect(body.type).toBe('comparison')
    expect(body.native_chart[0]?.command).toContain('officecli add')
  })

  test('auto palette is stable and not Python hash()', () => {
    const data = { categories: ['Q1'], series: [{ name: 'A', values: [1] }] }
    expect(stableAutoPalette(data)).toBe(stableAutoPalette(data))
  })
})

function portDetailWithDefects(): Table {
  const columns = ['作业编号', '日期', '流向', '货类', '航线', '泊位', '货物吨数', '作业小时', '等泊小时', '计划小时', '箱量TEU']
  const row = (id: string, tons: Cell, teu: Cell): Cell[] => [id, '2025-01-01', '进港', '集装箱货物', '东亚', '01号泊位', tons, 7, 2, 8, teu]
  const rows = [
    row('QL-1', 100, 10),
    row('QL-2', 110, 11),
    row('QL-3', 120, 12),
    row('QL-4', null, 13),
    row('QL-5', null, 14),
    row('QL-6', null, 15),
    row('QL-7', 130, '13吨'),
    row('QL-8', 140, '14吨'),
    row('QL-9', 150, '15吨'),
    row('QL-10', 160, 16),
  ]
  rows.push(rows[0]!, rows[1]!, rows[2]!)
  return {
    columns: columns.map((name, index) => ({ name, values: rows.map(item => item[index] ?? null) })),
  }
}

function sameJson(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) <= 1e-9
  if (Array.isArray(actual) && Array.isArray(expected)) return actual.length === expected.length && actual.every((item, index) => sameJson(item, expected[index]))
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const left = actual as Record<string, unknown>
    const right = expected as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) if (!sameJson(left[key], right[key])) return false
    return true
  }
  return actual === expected
}
