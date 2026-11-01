/**
 * 技能将来调用的入口：Bun 执行本文件，stdout 为文本报告或 JSON。
 * 桌面会话走 office_business。本文件保留给开发对拍。
 */
import { floatNum, quickRatioJson, quickRatioText, type PyNum, type QuickRatioArgs } from '../quick-ratio.ts'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

const FLOAT = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i

export function runQuickRatioCli(argv: readonly string[]): CliResult {
  const parsed = parseArgs(argv)
  if (!parsed.ok) return { exitCode: 2, stdout: '', stderr: `${parsed.message}\n` }
  const args: QuickRatioArgs = {
    newMrr: parsed.newMrr,
    expansionMrr: parsed.expansion,
    churnedMrr: parsed.churned,
    contractionMrr: parsed.contraction,
  }
  const stdout = parsed.json ? quickRatioJson(args) : quickRatioText(args)
  return { exitCode: 0, stdout, stderr: '' }
}

function parseArgs(argv: readonly string[]):
  | { ok: true; json: boolean; newMrr: PyNum; expansion: PyNum; churned: PyNum; contraction: PyNum }
  | { ok: false; message: string } {
  let json = false
  let newMrr: PyNum | undefined
  let expansion: PyNum = { kind: 'int', value: 0 }
  let churned: PyNum | undefined
  let contraction: PyNum = { kind: 'int', value: 0 }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (token === '--json') {
      json = true
      continue
    }
    const flag = token.startsWith('--') ? token : ''
    if (!flag) return { ok: false, message: `quick-ratio: unexpected argument ${token}` }
    const eq = flag.indexOf('=')
    const name = eq === -1 ? flag : flag.slice(0, eq)
    let raw = eq === -1 ? undefined : flag.slice(eq + 1)
    if (raw === undefined) {
      const next = argv[index + 1]
      if (next === undefined || (next.startsWith('-') && !FLOAT.test(next.trim()))) {
        return { ok: false, message: `quick-ratio: ${name} requires a number` }
      }
      raw = next
      index += 1
    }
    const value = parseFloatArg(raw)
    if (value === null) return { ok: false, message: `quick-ratio: invalid number for ${name}: ${raw}` }
    const num = floatNum(value)
    if (name === '--new-mrr') newMrr = num
    else if (name === '--expansion') expansion = num
    else if (name === '--churned') churned = num
    else if (name === '--contraction') contraction = num
    else return { ok: false, message: `quick-ratio: unknown option ${name}` }
  }

  if (!newMrr || !churned) {
    return { ok: false, message: 'quick-ratio: --new-mrr and --churned are required' }
  }
  return { ok: true, json, newMrr, expansion, churned, contraction }
}

function parseFloatArg(raw: string): number | null {
  const text = raw.trim()
  if (!FLOAT.test(text)) return null
  const lower = text.toLowerCase()
  if (lower === 'nan' || lower === '+nan' || lower === '-nan') return Number.NaN
  if (lower === 'inf' || lower === '+inf' || lower === 'infinity' || lower === '+infinity') return Infinity
  if (lower === '-inf' || lower === '-infinity') return -Infinity
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

if (import.meta.main) {
  const result = runQuickRatioCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
