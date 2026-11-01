/**
 * office_business 的宿主实现。计算在进程内完成，不启动 Python。
 * 读和写都限制在会话工作区。
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { OfficeBusinessArgs } from '@craft-agent/session-tools-core'
import {
  runDataQualityCli,
  runInfographicCli,
  runMetricsCli,
  runQuickRatioCli,
  runUnitEconomicsCli,
  validateMinutes,
  type InfographicConfig,
} from '@craft-agent/office-business-runtime'
import { workspacePath } from './office-template/service.ts'

export interface OfficeBusinessSession {
  workspaceRoot: string
  canWrite: boolean
}

export interface OfficeBusinessResult {
  command: OfficeBusinessArgs['command']
  exitCode: number
  stdout: string
  stderr: string
}

export function runOfficeBusiness(session: OfficeBusinessSession, args: OfficeBusinessArgs): OfficeBusinessResult {
  switch (args.command) {
    case 'validate-minutes':
      return validate(session, args)
    case 'metrics':
      return finish('metrics', runMetricsCli(metricsArgv(args)))
    case 'quick-ratio':
      return finish('quick-ratio', runQuickRatioCli(quickArgv(args)))
    case 'unit-economics':
      return finish('unit-economics', runUnitEconomicsCli(unitArgv(args)))
    case 'data-quality':
      return quality(session, args)
    case 'infographic':
      return graphic(session, args)
    default: {
      const unreachable: never = args
      throw new Error(`未知的办公计算：${String(unreachable)}`)
    }
  }
}

function finish(command: OfficeBusinessResult['command'], result: { exitCode: number; stdout: string; stderr: string }): OfficeBusinessResult {
  return { command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

function validate(session: OfficeBusinessSession, args: Extract<OfficeBusinessArgs, { command: 'validate-minutes' }>): OfficeBusinessResult {
  const markdown = args.markdown ?? readFileSync(workspacePath(session.workspaceRoot, args.path, /\.(md|txt)$/i).absolute, 'utf8')
  const report = validateMinutes(markdown)
  return { command: 'validate-minutes', exitCode: report.exitCode, stdout: `${report.text}\n`, stderr: '' }
}

function quality(session: OfficeBusinessSession, args: Extract<OfficeBusinessArgs, { command: 'data-quality' }>): OfficeBusinessResult {
  const input = workspacePath(session.workspaceRoot, args.path, /\.(csv|tsv|json)$/i)
  const argv = [input.absolute]
  if (args.id_columns) argv.push('--id-columns', args.id_columns)
  if (args.sample !== undefined) argv.push('--sample', String(args.sample))
  if (args.output) {
    if (!session.canWrite) throw new Error('当前是只读模式，数据体检不能把报告写到文件。去掉 output，只看返回正文。')
    argv.push('--output', workspacePath(session.workspaceRoot, args.output, /\.json$/i, true).absolute)
  }
  return finish('data-quality', runDataQualityCli(argv))
}

function graphic(session: OfficeBusinessSession, args: Extract<OfficeBusinessArgs, { command: 'infographic' }>): OfficeBusinessResult {
  if (!session.canWrite) throw new Error('当前是只读模式，不能写出信息图。')
  const output = workspacePath(session.workspaceRoot, args.output, /\.html$/i, true)
  const config = args.config
    ? { ...(args.config as InfographicConfig), output: output.absolute }
    : { ...readConfig(session.workspaceRoot, args.config_path), output: output.absolute }
  const argv = args.native_chart ? ['--native-chart'] : []
  return finish('infographic', runInfographicCli(argv, JSON.stringify(config)))
}

function readConfig(root: string, raw: string | undefined): InfographicConfig {
  const file = workspacePath(root, raw, /\.json$/i)
  const text = readFileSync(file.absolute, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('信息图配置不是有效的 JSON。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('信息图配置必须是对象。')
  const output = (parsed as { output?: unknown }).output
  if (typeof output === 'string') assertInside(root, output)
  return parsed as InfographicConfig
}

function assertInside(root: string, raw: string): void {
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
  const rel = relative(root, candidate)
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('信息图输出必须在当前工作区内。')
}

function metricsArgv(args: Extract<OfficeBusinessArgs, { command: 'metrics' }>): string[] {
  const argv = ['--mrr', String(args.mrr)]
  push(argv, '--mrr-last', args.mrr_last)
  push(argv, '--customers', args.customers)
  push(argv, '--churned', args.churned)
  push(argv, '--new-customers', args.new_customers)
  push(argv, '--sm-spend', args.sm_spend)
  push(argv, '--gross-margin', args.gross_margin)
  push(argv, '--expansion-mrr', args.expansion_mrr)
  push(argv, '--churned-mrr', args.churned_mrr)
  push(argv, '--contraction-mrr', args.contraction_mrr)
  push(argv, '--profit-margin', args.profit_margin)
  if ((args.format ?? 'json') === 'json') argv.push('--json')
  return argv
}

function quickArgv(args: Extract<OfficeBusinessArgs, { command: 'quick-ratio' }>): string[] {
  const argv = ['--new-mrr', String(args.new_mrr), '--churned', String(args.churned)]
  push(argv, '--expansion', args.expansion)
  push(argv, '--contraction', args.contraction)
  if ((args.format ?? 'json') === 'json') argv.push('--json')
  return argv
}

function unitArgv(args: Extract<OfficeBusinessArgs, { command: 'unit-economics' }>): string[] {
  const argv = ['--mrr', String(args.mrr), '--growth', String(args.growth), '--churn', String(args.churn)]
  push(argv, '--cac', args.cac)
  push(argv, '--gross-margin', args.gross_margin)
  push(argv, '--sm-spend', args.sm_spend)
  push(argv, '--months', args.months)
  if ((args.format ?? 'json') === 'json') argv.push('--json')
  return argv
}

function push(argv: string[], flag: string, value: number | undefined): void {
  if (value === undefined) return
  argv.push(flag, String(value))
}
