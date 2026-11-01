/**
 * 纪要结构校验的 Bun 入口。stdout 与 dsh `validate_minutes.py` 的报告逐行一致。
 * 用法行写的是本脚本，不把 Python 命令写进技能。
 */
import { readFileSync } from 'node:fs'
import { isDirectCli } from './direct.ts'
import { validateMinutes } from '../validate-minutes.ts'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

const USAGE = '用法：bun packages/office-business-runtime/src/cli/validate-minutes.ts 会议纪要.md'

export function runValidateMinutesCli(argv: readonly string[]): CliResult {
  if (argv.length !== 1 || !argv[0]) return { exitCode: 1, stdout: '', stderr: `${USAGE}\n` }
  let content: string
  try {
    content = readFileSync(argv[0], 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stdout: '', stderr: `${message}\n` }
  }
  const report = validateMinutes(content)
  return { exitCode: report.exitCode, stdout: `${report.text}\n`, stderr: '' }
}

if (isDirectCli('validate-minutes.ts')) {
  const result = runValidateMinutesCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
