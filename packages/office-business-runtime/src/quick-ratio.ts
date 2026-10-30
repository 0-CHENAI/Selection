/**
 * Quick Ratio 的 TypeScript 等价实现。
 * 评级文案与文本版式见包内 NOTICE（MIT，Abbas Mir，2026）。
 */
import { pythonJsonStdout, type PyJson } from './json-python.ts'
import { pythonFixed, pythonRound } from './python-number.ts'

/** argparse 省略可选参数时默认是整数 0；写在命令行上的数是 float。 */
export interface PyNum {
  kind: 'int' | 'float'
  value: number
}

export interface QuickRatioArgs {
  newMrr: PyNum
  expansionMrr: PyNum
  churnedMrr: PyNum
  contractionMrr: PyNum
}

export function floatNum(value: number): PyNum {
  return { kind: 'float', value }
}

export function quickRatioJson(args: QuickRatioArgs): string {
  return pythonJsonStdout(quickRatioValue(args))
}

/** 与 Python print(format_report()) 的 stdout 一致，含末尾额外换行。 */
export function quickRatioText(args: QuickRatioArgs): string {
  return `${formatReport(args)}\n`
}

function quickRatioValue(args: QuickRatioArgs): PyJson {
  const growth = add(args.newMrr, args.expansionMrr)
  const lost = add(args.churnedMrr, args.contractionMrr)
  const ratio = ratioOf(growth, lost)
  const verdict = statusOf(growth.value, lost.value, ratio.numeric)
  return {
    t: 'obj',
    entries: [
      ['quick_ratio', ratio.json],
      ['quick_ratio_display', ratio.display],
      ['status', verdict.status],
      ['interpretation', verdict.interpretation],
      ['components', {
        t: 'obj',
        entries: [
          ['growth_mrr', rounded(growth)],
          ['lost_mrr', rounded(lost)],
          ['new_mrr', rounded(args.newMrr)],
          ['expansion_mrr', rounded(args.expansionMrr)],
          ['churned_mrr', rounded(args.churnedMrr)],
          ['contraction_mrr', rounded(args.contractionMrr)],
        ],
      }],
      ['breakdown', {
        t: 'obj',
        entries: [
          ['new_mrr_pct', percent(growth, args.newMrr.value)],
          ['expansion_mrr_pct', percent(growth, args.expansionMrr.value)],
          ['churned_mrr_pct', percent(lost, args.churnedMrr.value)],
          ['contraction_mrr_pct', percent(lost, args.contractionMrr.value)],
        ],
      }],
    ],
  }
}

function formatReport(args: QuickRatioArgs): string {
  const growth = add(args.newMrr, args.expansionMrr)
  const lost = add(args.churnedMrr, args.contractionMrr)
  const ratio = ratioOf(growth, lost)
  const verdict = statusOf(growth.value, lost.value, ratio.numeric)
  const growthShown = shown(growth)
  const lostShown = shown(lost)
  const lines = [
    `\n${'='.repeat(70)}`,
    'QUICK RATIO ANALYSIS',
    '='.repeat(70),
    `\n⚡ QUICK RATIO: ${ratio.display}`,
    `   Status: ${verdict.status}`,
    `   ${verdict.interpretation}`,
    '\n📊 COMPONENTS',
    `  Growth MRR (New + Expansion): ${money(growthShown)}`,
    `    • New MRR: ${money(shown(args.newMrr))}`,
    `    • Expansion MRR: ${money(shown(args.expansionMrr))}`,
    `  Lost MRR (Churned + Contraction): ${money(lostShown)}`,
    `    • Churned MRR: ${money(shown(args.churnedMrr))}`,
    `    • Contraction MRR: ${money(shown(args.contractionMrr))}`,
    '\n📈 GROWTH BREAKDOWN',
    `  New customers: ${pct(percentNumber(growth, args.newMrr.value))}`,
    `  Expansion: ${pct(percentNumber(growth, args.expansionMrr.value))}`,
    '\n📉 LOSS BREAKDOWN',
    `  Churn: ${pct(percentNumber(lost, args.churnedMrr.value))}`,
    `  Contraction: ${pct(percentNumber(lost, args.contractionMrr.value))}`,
    '\n🎯 BENCHMARKS',
    '  < 1.0  = CRITICAL (losing revenue faster than gaining)',
    '  1-2    = WATCH (marginal growth)',
    '  2-4    = HEALTHY (good growth efficiency)',
    '  > 4    = EXCELLENT (strong, efficient growth)',
    `\n${'='.repeat(70)}\n`,
  ]
  return lines.join('\n')
}

function add(left: PyNum, right: PyNum): PyNum {
  const kind = left.kind === 'int' && right.kind === 'int' ? 'int' : 'float'
  return { kind, value: left.value + right.value }
}

function rounded(value: PyNum): PyJson {
  if (value.kind === 'int') return { t: 'int', n: value.value }
  return { t: 'float', n: pythonRound(value.value, 2) }
}

function shown(value: PyNum): number {
  return value.kind === 'int' ? value.value : pythonRound(value.value, 2)
}

function percent(total: PyNum, part: number): PyJson {
  if (!(total.value > 0)) return { t: 'int', n: 0 }
  return { t: 'float', n: pythonRound((part / total.value) * 100, 1) }
}

function percentNumber(total: PyNum, part: number): number {
  if (!(total.value > 0)) return 0
  return pythonRound((part / total.value) * 100, 1)
}

function ratioOf(growth: PyNum, lost: PyNum): { json: PyJson; display: string; numeric: number } {
  if (lost.value === 0) {
    if (growth.value > 0) return { json: null, display: '∞', numeric: Infinity }
    return { json: { t: 'int', n: 0 }, display: '0', numeric: 0 }
  }
  const numeric = growth.value / lost.value
  return { json: { t: 'float', n: numeric }, display: pythonFixed(numeric, 2), numeric }
}

function statusOf(growth: number, lost: number, ratio: number): { status: string; interpretation: string } {
  if (growth === 0 && lost === 0) {
    return {
      status: 'NO_DATA',
      interpretation: 'No revenue movement recorded - insufficient data to assess growth efficiency',
    }
  }
  if (lost === 0 && growth > 0) {
    return { status: 'EXCELLENT', interpretation: 'No revenue loss - perfect retention with growth' }
  }
  if (ratio >= 4) {
    return { status: 'EXCELLENT', interpretation: 'Strong, efficient growth - gaining revenue 4x faster than losing it' }
  }
  if (ratio >= 2) {
    return { status: 'HEALTHY', interpretation: 'Good growth efficiency - gaining revenue 2x+ faster than losing it' }
  }
  if (ratio >= 1) {
    return { status: 'WATCH', interpretation: 'Marginal growth - barely gaining more than losing' }
  }
  return { status: 'CRITICAL', interpretation: 'Losing revenue faster than gaining - growth is unsustainable' }
}

function money(value: number): string {
  const fixed = pythonFixed(value, 2)
  const negative = fixed.startsWith('-')
  const unsigned = negative ? fixed.slice(1) : fixed
  const [whole, frac] = unsigned.split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${negative ? '-' : ''}${grouped}.${frac ?? '00'}`
}

function pct(value: number): string {
  return `${pythonFixed(value, 1)}%`
}
