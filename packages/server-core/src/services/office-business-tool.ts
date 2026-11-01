/**
 * office_business 的宿主实现。计算在进程内完成，不启动 Python。
 * 读和写都限制在会话工作区。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
import { flushOfficecliResident, workspacePath } from './office-template/service.ts'

export interface OfficeBusinessSession {
  workspaceRoot: string
  canWrite: boolean
  /** OfficeCLI 可执行文件。XLSX 数据体检用它读单元格缓存值 */
  officecliBinary?: string
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
  const input = workspacePath(session.workspaceRoot, args.path, /\.(csv|tsv|json|xlsx)$/i)
  let tempDir: string | undefined
  let source = input.absolute
  if (/\.xlsx$/i.test(input.absolute)) {
    const csv = xlsxSheetToCsv(session.officecliBinary, input.absolute, args.sheet, args.range)
    tempDir = mkdtempSync(join(tmpdir(), 'selection-data-quality-'))
    source = join(tempDir, `${basename(input.absolute, extname(input.absolute))}${args.sheet ? `-${args.sheet.replace(/[\\/:*?"<>|]/g, '_')}` : ''}.csv`)
    writeFileSync(source, csv)
  } else if (args.sheet || args.range) {
    throw new Error('sheet 和 range 只用于 XLSX。')
  }
  try {
    const argv = [source]
    if (args.id_columns) argv.push('--id-columns', args.id_columns)
    if (args.sample !== undefined) argv.push('--sample', String(args.sample))
    if (args.output) {
      if (!session.canWrite) throw new Error('当前是只读模式，数据体检不能把报告写到文件。去掉 output，只看返回正文。')
      argv.push('--output', workspacePath(session.workspaceRoot, args.output, /\.json$/i, true).absolute)
    }
    return finish('data-quality', runDataQualityCli(argv))
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  }
}

/** 用 OfficeCLI 的 text 视图读一个工作表的缓存值，转成 CSV。不改原文件 */
export function xlsxSheetToCsv(binary: string | undefined, file: string, sheet?: string, range?: string): string {
  if (!binary) throw new Error('这个环境没有 OfficeCLI，不能直接读 XLSX。请先把数据表另存为 CSV 再体检。')
  const argv = ['view', file, 'text']
  if (range) argv.push('--range', sheet ? `${sheet}!${range}` : range)
  flushOfficecliResident(binary, file)
  const run = spawnSync(binary, argv, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' } })
  if (run.error) throw new Error(`OfficeCLI 读取 XLSX 失败：${run.error.message}`)
  if (run.status !== 0) throw new Error(`OfficeCLI 读取 XLSX 失败：${(run.stderr || run.stdout || '').trim().slice(0, 500)}`)
  return officecliTextToCsv(run.stdout, sheet, Boolean(range))
}

const ROW_LINE = /^\[\/(.+)\/row\[(\d+)\]\]\s?(.*)$/
const CELL = /^([A-Z]{1,3})(\d+)=(.*)$/

function columnIndex(letters: string): number {
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

/** 解析 `view text` 输出。表头取区域首行，或第一行至少两个非空单元格的行 */
export function officecliTextToCsv(text: string, sheet?: string, firstRowIsHeader = false): string {
  const rows = new Map<string, Array<string[]>>()
  const order: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = ROW_LINE.exec(line)
    if (!match) continue
    const name = match[1]!
    if (!rows.has(name)) { rows.set(name, []); order.push(name) }
    const cells: string[] = []
    for (const part of match[3]!.split('\t')) {
      const cell = CELL.exec(part)
      if (!cell) continue
      cells[columnIndex(cell[1]!)] = cell[3]!
    }
    rows.get(name)!.push(Array.from(cells, value => value ?? ''))
  }
  const target = sheet ?? order[0]
  if (!target || !rows.has(target)) {
    throw new Error(sheet ? `XLSX 里没有工作表「${sheet}」。现有：${order.join('、') || '无'}` : 'XLSX 里没有读到单元格。')
  }
  const all = rows.get(target)!
  const filled = (row: string[]) => row.filter(value => value.trim() !== '').length
  const headerAt = firstRowIsHeader ? all.findIndex(row => filled(row) > 0) : all.findIndex(row => filled(row) >= 2)
  if (headerAt < 0) throw new Error(`工作表「${target}」没有可当表头的行。请用 range 指定数据区域。`)
  const header = all[headerAt]!
  const first = header.findIndex(value => value.trim() !== '')
  let last = header.length - 1
  while (last > first && header[last]!.trim() === '') last--
  const body = all.slice(headerAt + 1).filter(row => filled(row.slice(first, last + 1)) > 0)
  const quote = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const line = (row: string[]) => Array.from({ length: last - first + 1 }, (_, i) => quote((row[first + i] ?? '').trim())).join(',')
  const names = Array.from({ length: last - first + 1 }, (_, i) => header[first + i]!.trim() || `列${i + 1}`)
  return [names.map(quote).join(','), ...body.map(line)].join('\n') + '\n'
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
