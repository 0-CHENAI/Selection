/**
 * 数据体检 CLI。参数名与 data_quality_checker.py 相同。
 * 进度写到 stderr，报告 JSON 写到 stdout 或 --output。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { auditFile } from '../data-quality.ts'
import { parseIntFlag, takeFlag, type CliResult } from './args.ts'

export function runDataQualityCli(argv: readonly string[]): CliResult {
  const output = takeFlag(argv, '--output')
  const outputShort = takeFlag(output.rest, '-o')
  const ids = takeFlag(outputShort.rest, '--id-columns')
  const idsShort = takeFlag(ids.rest, '-id')
  const dates = takeFlag(idsShort.rest, '--date-columns')
  const datesShort = takeFlag(dates.rest, '-dc')
  const sample = takeFlag(datesShort.rest, '--sample')
  const sampleShort = takeFlag(sample.rest, '-s')
  const encoding = takeFlag(sampleShort.rest, '--encoding')
  const encodingShort = takeFlag(encoding.rest, '-e')
  const positional = encodingShort.rest.filter(token => !token.startsWith('-'))
  const unknown = encodingShort.rest.find(token => token.startsWith('-'))
  if (unknown) return { exitCode: 2, stdout: '', stderr: `data-quality: unknown option ${unknown}\n` }
  const input = positional[0]
  if (!input) return { exitCode: 2, stdout: '', stderr: 'data-quality: input file is required\n' }
  if (positional.length > 1) return { exitCode: 2, stdout: '', stderr: `data-quality: unexpected argument ${positional[1]}\n` }
  const sampleRaw = sample.value ?? sampleShort.value
  const sampleCount = sampleRaw === undefined ? undefined : parseIntFlag(sampleRaw)
  if (sampleRaw !== undefined && sampleCount === null) return { exitCode: 2, stdout: '', stderr: 'data-quality: --sample requires an integer\n' }
  let report
  try {
    report = auditFile(input, {
      idColumns: (ids.value ?? idsShort.value)?.split(',').map(item => item.trim()).filter(Boolean),
      sample: sampleCount ?? undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ENOENT')) return { exitCode: 1, stdout: '', stderr: `错误：文件不存在 — ${input}\n` }
    return { exitCode: 1, stdout: '', stderr: `错误：无法读取文件 — ${message}\n` }
  }
  void dates
  void datesShort
  void encoding
  void encodingShort
  const json = `${JSON.stringify(report, null, 2)}\n`
  const destination = output.value ?? outputShort.value
  const stderr = [`开始质检：${report.rows} 行 × ${report.columns} 列\n`]
  if (destination) {
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, json)
    stderr.push(`报告已保存到 ${destination}\n`)
  }
  stderr.push(`质检完成：总分 ${report.overall_score}/100（${report.grade}）\n`)
  return { exitCode: 0, stdout: destination ? '' : json, stderr: stderr.join('') }
}

if (import.meta.main) {
  const result = runDataQualityCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
