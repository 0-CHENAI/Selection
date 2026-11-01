/**
 * `xlsx_recalculate` 会话工具的宿主实现（#711 G2）。
 * 包装 xlsxRecalculate：OfficeCLI computedValue 写回缓存 → 装了 Excel 的 macOS（AppleScript）/ Windows（COM）再 CalculateFull →
 * TypeScript 只补未求值格子；随后用 checks.json 或关键单元格双读，经 assertExcelDelivery 判定是否可以交付。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cellRef, readXlsxCells, recalculateWorkbook, isCellError, type CellInput, type CellScalar, type CheckSpec } from '../office-render-poc/formula.ts'
import type { NativeCapabilities } from '../office-render-poc/native-plan.ts'
import { scrubbedEnv } from '../office-template/font-diagnostics.ts'
import { assertExcelDelivery, type DualReadCell, type ExcelDeliveryCode } from './delivery-gate.ts'
import { xlsxRecalculate, type OfficeComputed } from './xlsx-recalculate.ts'

export interface XlsxToolArgs {
  path: string
  key_cells?: string[]
  visual_review?: 'not-needed' | 'reviewed'
  blank_page?: boolean
}

export interface XlsxToolDeps {
  platform?: NodeJS.Platform
  officecliBinary?: string
  excelInstalled?: boolean
  checks?: CheckSpec[]
  runOfficecli?: (binary: string, file: string) => Promise<string>
  excelCalculateFull?: (bytes: Uint8Array) => Promise<Uint8Array>
}

export interface XlsxToolResult {
  path: string
  sha256: string
  ready: boolean
  code?: ExcelDeliveryCode
  message: string
  ran: string[]
  notes: string[]
  unevaluatedFilledByTypeScript: number
  checks?: { passed: boolean; failures: Array<{ ref: string; expected: unknown; actual: unknown }> }
  dualRead: Array<DualReadCell & { ok: boolean }>
  errorCells: Array<{ ref: string; error: string }>
}

const exec = (file: string, args: string[], timeout: number) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { timeout, maxBuffer: 256 * 1024 * 1024, env: { ...scrubbedEnv(), OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message).slice(0, 500)))
    else resolve(String(stdout))
  })
})

export function parseOfficecliComputed(json: string): Record<string, OfficeComputed> {
  const data = JSON.parse(json) as { data?: { results?: Array<{ path?: string; format?: Record<string, unknown> }> } }
  const out: Record<string, OfficeComputed> = {}
  for (const item of data.data?.results ?? []) {
    const match = /^\/(.+)\/([A-Za-z]+\d+)$/.exec(item.path ?? '')
    if (!match) continue
    const ref = cellRef(match[1]!, match[2]!)
    const format = item.format ?? {}
    const raw = format.computedValue
    if (format.evaluated !== true || raw === undefined || raw === null) { out[ref] = 'unevaluated'; continue }
    const text = String(raw)
    if (/^#(?:DIV\/0!|VALUE!|NAME\?|REF!|N\/A|NUM!|NULL!)$/.test(text)) { out[ref] = 'unevaluated'; continue }
    if (/^(TRUE|FALSE)$/i.test(text) && format.type === 'Boolean') out[ref] = /^TRUE$/i.test(text)
    else if (text.trim() !== '' && Number.isFinite(Number(text)) && format.type !== 'String') out[ref] = Number(text)
    else out[ref] = text
  }
  return out
}

/** macOS：AppleScript 打开副本、CalculateFull、保存。只退出由本次调用启动的 Excel。 */
export function macCalculateFullScript(file: string): string {
  const path = file.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return [
    'set wasRunning to application "Microsoft Excel" is running',
    'tell application "Microsoft Excel"',
    `  set wb to open workbook workbook file name (POSIX file "${path}" as text)`,
    '  calculate full',
    '  save wb',
    '  close wb saving no',
    '  if not wasRunning then quit',
    'end tell',
  ].join('\n')
}

/** Windows：独立的 COM 实例，结束后只退出这个实例。 */
export function windowsCalculateFullScript(file: string): string {
  const path = file.replaceAll("'", "''")
  return [
    "$ErrorActionPreference = 'Stop'",
    '$excel = New-Object -ComObject Excel.Application',
    '$excel.Visible = $false; $excel.DisplayAlerts = $false',
    'try {',
    `  $wb = $excel.Workbooks.Open('${path}')`,
    '  $excel.CalculateFull()',
    '  $wb.Save(); $wb.Close($false)',
    '} finally { $excel.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }',
  ].join('\n')
}

export function detectExcel(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'darwin') return existsSync('/Applications/Microsoft Excel.app')
  if (platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
    return roots.some(root => ['Microsoft Office\\root\\Office16\\EXCEL.EXE', 'Microsoft Office\\Office16\\EXCEL.EXE'].some(rel => existsSync(join(root, rel))))
  }
  return false
}

async function nativeCalculateFull(platform: NodeJS.Platform, bytes: Uint8Array): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'selection-xlsx-'))
  const file = join(dir, 'workbook.xlsx')
  try {
    writeFileSync(file, bytes)
    if (platform === 'darwin') await exec('/usr/bin/osascript', ['-e', macCalculateFullScript(file)], 120_000)
    else if (platform === 'win32') await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsCalculateFullScript(file)], 120_000)
    else throw new Error('当前平台没有 Excel')
    return readFileSync(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function same(a: CellScalar, b: CellScalar): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6
  return a === b
}

function parseRef(raw: string): { sheet: string; address: string } | undefined {
  const match = /^'?(.+?)'?!\$?([A-Za-z]+)\$?(\d+)$/.exec(raw.trim())
  return match ? { sheet: match[1]!, address: `${match[2]!.toUpperCase()}${match[3]}` } : undefined
}

export async function runXlsxRecalculateTool(bytes: Uint8Array, args: XlsxToolArgs, deps: XlsxToolDeps = {}): Promise<{ bytes: Uint8Array; result: Omit<XlsxToolResult, 'path' | 'sha256'> }> {
  const platform = deps.platform ?? process.platform
  const notes: string[] = []
  const excel = deps.excelInstalled ?? detectExcel(platform)
  const capabilities: NativeCapabilities = {
    platform, electronPrintToPdf: false, electronCapturePage: false, officecliHtml: !!deps.officecliBinary,
    officecliFormula: !!deps.officecliBinary, exporterPdfPlugin: false, word: false, powerpoint: false, excel,
  }
  const runOfficecli = deps.runOfficecli ?? ((binary: string, file: string) => exec(binary, ['query', file, 'cell:has(formula)', '--json'], 180_000))
  // OfficeCLI 结果按输入缓存：CalculateFull 失败退回时不再重复启动 OfficeCLI。
  let officecliResult: Promise<Record<string, OfficeComputed>> | undefined
  const officecli = deps.officecliBinary ? (_cells: CellInput[]) => (officecliResult ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-xlsx-'))
    try {
      const file = join(dir, 'workbook.xlsx')
      writeFileSync(file, bytes)
      return parseOfficecliComputed(await runOfficecli(deps.officecliBinary!, file))
    } catch (error) {
      notes.push(`OfficeCLI 求值失败，改由 TypeScript 求值器补算：${error instanceof Error ? error.message : String(error)}`)
      return {}
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })()) : undefined
  const calculateFull = deps.excelCalculateFull ?? ((input: Uint8Array) => nativeCalculateFull(platform, input))
  let recalculated
  try {
    recalculated = await xlsxRecalculate({ bytes, checks: deps.checks, capabilities, officecli, excelCalculateFull: calculateFull })
  } catch (error) {
    if (!excel) throw error
    notes.push(`Excel CalculateFull 失败，已退回 OfficeCLI + TypeScript：${error instanceof Error ? error.message : String(error)}`)
    recalculated = await xlsxRecalculate({ bytes, checks: deps.checks, capabilities: { ...capabilities, excel: false }, officecli })
  }
  const written = recalculated.bytes
  const cells = readXlsxCells(written)
  // 双读：缓存值（OfficeCLI / Excel 写回）与独立的 TypeScript 全量求值比对。只在声明了关键单元格时才做。
  const independent = args.key_cells?.length ? recalculateWorkbook(cells.map(cell => cell.formula ? { sheet: cell.sheet, address: cell.address, formula: cell.formula } : cell), []) : { values: {} as Record<string, unknown> }
  const errorCells = Object.entries(recalculated.values).filter(([, value]) => isCellError(value)).map(([ref, value]) => ({ ref, error: (value as { error: string }).error })).slice(0, 50)
  const dualRead: Array<DualReadCell & { ok: boolean }> = []
  for (const raw of args.key_cells ?? []) {
    const parsed = parseRef(raw)
    const cell = parsed ? cells.find(item => item.sheet === parsed.sheet && item.address.toUpperCase() === parsed.address) : undefined
    const ref = parsed ? cellRef(parsed.sheet, parsed.address) : raw
    const computedValue = independent.values[ref] as CellScalar | { error: string } | undefined
    const computed: CellScalar = computedValue === undefined ? null : typeof computedValue === 'object' && computedValue !== null ? computedValue.error : computedValue
    const cached = cell?.cachedValue ?? null
    dualRead.push({ ref, formula: cell?.formula ?? '', cached, computed, ok: !!cell?.formula && same(cached, computed) })
  }
  const checks = deps.checks?.length ? recalculated.checks : null
  const gate = assertExcelDelivery({
    recalculated: true,
    checks,
    dualRead,
    regionReviewed: args.visual_review === 'reviewed' || args.visual_review === 'not-needed',
    blankPage: args.blank_page,
  })
  const message = gate.ok ? '已重算并通过核对，可以交付。' : `${gate.message}。修正后重新调用 xlsx_recalculate。`
  return {
    bytes: written,
    result: {
      ready: gate.ok,
      code: gate.ok ? undefined : gate.code,
      message,
      ran: recalculated.ran,
      notes,
      unevaluatedFilledByTypeScript: recalculated.unevaluatedFilledByTypeScript,
      checks: checks ? { passed: checks.passed, failures: checks.failures.slice(0, 50) } : undefined,
      dualRead,
      errorCells,
    },
  }
}

/** 工作簿里有没有公式。没有公式的 .xlsx 不要求重算。 */
export function workbookHasFormulas(bytes: Uint8Array): boolean {
  return readXlsxCells(bytes).some(cell => cell.formula !== undefined)
}
