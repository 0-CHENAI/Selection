/**
 * Office 会话工具的宿主实现：office_template、office_template_write、xlsx_recalculate，以及交付前守卫。
 * 功能对齐 dsh-desktop 588412b 的 template-tool.js / docx-workflow.js / template-writer.js：
 * - 只在当前会话所选案例与 revision 上工作；复制中选择变化即作废。
 * - 案例复制到会话 data 目录 `office-templates/<id>-<uuid>/`（与 dsh 相同的目录名，放在不生成文件卡片的位置），逐文件 sha256 校验；
 *   Excel 的可编辑工作簿另放工作区；原件只读、永不覆盖。
 * - 写入只产生新文件（O_EXCL），路径限制在工作区内，拒绝符号链接逃逸。
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { OfficeDocumentState } from '@craft-agent/shared/protocol/office'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import type { OfficeTemplate } from '../office-catalog.ts'
import { applyPageSetupExtension, type PageSetupExtension } from '../excel-delivery/page-setup.ts'
import { runXlsxRecalculateTool, workbookHasFormulas, type XlsxToolArgs, type XlsxToolDeps, type XlsxToolResult } from '../excel-delivery/xlsx-tool.ts'
import type { CheckSpec } from '../office-render-poc/formula.ts'
import {
  formatLayoutDiagnostics,
  prepareDocxSource,
  validateDocxAgainstTemplate,
  writeDocxFromTemplate,
  DocxPlanError,
  type DocxEditPlan,
  type DocxProfile,
  type LayoutDiagnostic,
  type NativeParagraph,
} from './docx-layout.ts'
import { fontWarningsFor, type FontWarning } from './font-diagnostics.ts'
import { OOXML_MAX_BYTES } from './ooxml-package.ts'

const MAX_CASE_FILES = 200
const MAX_CASE_BYTES = 128 * 1024 * 1024
const RECORD_FILE = 'office-deliveries.json'

export interface OfficeToolSession {
  /** 会话工作区根目录（项目目录或工作区目录）。 */
  workspaceRoot: string
  /** 会话存储目录，用于记录重算结果。 */
  storageDir: string
  /** 读当前会话的 Office 选择。每次调用都重新读，用于检测复制中途的变化。 */
  office: () => OfficeDocumentState | null | undefined
  templates: () => OfficeTemplate[]
  /** office-business 技能根目录（含 catalog.json 与 cases/）。 */
  businessRoot: string
  /** 安全模式下禁止写文件。 */
  canWrite: boolean
  fonts?: string[]
  xlsx?: XlsxToolDeps
}

interface CatalogCase { id: string; sampleFile?: string | null; selection?: { assetDir?: string; exampleSha256?: string } }

interface DeliveryRecords { xlsx: Record<string, { sha256: string; ready: boolean; code?: string; message: string; at: number }> }

/** 直接调用 OfficeCLI 可执行文件（不经 shell 包装）。不可用时返回 undefined，由 TypeScript 求值器补算。 */
export function officecliExecutable(): string | undefined {
  const path = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
  return path && !/\.(cmd|bat)$/i.test(path) ? path : undefined
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function catalogCase(root: string, id: string): CatalogCase | undefined {
  const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8')) as { cases?: CatalogCase[] }
  return catalog.cases?.find(item => item.id === id)
}

function caseDir(root: string, entry: CatalogCase): string {
  const asset = entry.selection?.assetDir ?? `cases/${entry.id}`
  if (isAbsolute(asset) || asset.includes('..')) throw new Error('案例目录无效')
  return join(root, asset)
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** 工作区内的常规路径。拒绝 `..`、符号链接与工作区外路径。 */
export function workspacePath(rootInput: string, raw: unknown, extension: RegExp, create = false): { absolute: string; relative: string } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1024) throw new Error('请给出工作区内的文件路径（不超过 1024 字符）')
  const root = realpathSync(rootInput)
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
  const rel = relative(root, candidate)
  if (!within(root, candidate) || rel.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('文件必须在当前会话的工作区内')
  if (!extension.test(candidate)) throw new Error(`文件扩展名不符合要求：${raw}`)
  let current = root
  for (const part of rel.split(/[\\/]/).slice(0, -1)) {
    current = join(current, part)
    if (!existsSync(current)) {
      if (!create) throw new Error(`目录不存在：${relative(root, current)}`)
      mkdirSync(current, { mode: 0o700 })
    }
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('路径中不能有符号链接或非目录')
  }
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) throw new Error('不能写入符号链接')
  return { absolute: candidate, relative: rel.split(sep).join('/') }
}

function selected(session: OfficeToolSession, templateId: unknown): { state: OfficeDocumentState; template: OfficeTemplate } {
  const state = session.office()
  if (!state?.templateId || !state.revision) throw new Error('当前会话没有选中 Word / Excel 案例。先在 Office 首页点击案例卡片，把案例附到输入框，再调用 office_template。')
  if (typeof templateId === 'string' && templateId !== state.templateId) throw new Error(`当前选中的案例是 ${state.templateId}，不是 ${templateId}。`)
  const template = session.templates().find(item => item.id === state.templateId)
  if (!template || template.revision !== state.revision || template.mode !== state.mode) throw new Error('所选案例已更新，需要重新选择。')
  return { state, template }
}

function profileFor(dir: string): DocxProfile | null {
  const path = join(dir, 'generation.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as DocxProfile : null
}

function listCaseFiles(dir: string): string[] {
  const files: string[] = []
  let total = 0
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) { walk(path); continue }
      files.push(relative(dir, path).split(sep).join('/'))
      total += stat.size
      if (files.length > MAX_CASE_FILES || total > MAX_CASE_BYTES) throw new Error('案例目录超出复制上限')
    }
  }
  walk(dir)
  return files
}

/** 宿主持有的模板原件（只读）。 */
export function templateSourceFor(session: OfficeToolSession, template: OfficeTemplate): { bytes: Uint8Array; profile: DocxProfile | null; dir: string; entry: CatalogCase } {
  const entry = catalogCase(session.businessRoot, template.id)
  if (!entry || !template.sampleFile) throw new Error('这个案例没有原生模板文件（Selection 样例按 recipe 用 OfficeCLI 生成），不能用 office_template。')
  const dir = caseDir(session.businessRoot, entry)
  const bytes = readFileSync(join(dir, template.sampleFile))
  if (bytes.byteLength > OOXML_MAX_BYTES) throw new Error('模板文件超过 64 MB')
  if (entry.selection?.exampleSha256 && sha256(bytes) !== entry.selection.exampleSha256) throw new Error('案例原件与目录登记的 sha256 不一致，已停止')
  return { bytes, profile: template.mode === 'word' ? profileFor(dir) : null, dir, entry }
}

export interface PrepareResult {
  template_id: string
  revision: string
  mode: 'word' | 'excel'
  workspace_path: string
  design_path: string
  files: Array<{ workspace_path: string; sha256: string }>
  guide: string
  skill: string
  editing_tool: string
  editable_paragraphs: NativeParagraph[]
  sample_extensions: string[]
  /** 只读参考副本目录（会话 data 目录，不生成文件卡片）。 */
  reference_dir: string
}

function uniqueWorkspaceFile(root: string, base: string, extension: string): string {
  const safe = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'office'
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? `${safe}${extension}` : `${safe}-${index}${extension}`
    if (!existsSync(join(root, name))) return name
  }
  throw new Error('无法在工作区里找到可用的文件名')
}

export async function prepareOfficeTemplate(session: OfficeToolSession, args: { template_id?: unknown }): Promise<PrepareResult> {
  if (!session.canWrite) throw new Error('office_template 需要工作区写权限，当前是只读模式。')
  const { state, template } = selected(session, args.template_id)
  const source = templateSourceFor(session, template)
  const root = realpathSync(session.workspaceRoot)
  // 参考副本放在会话 data 目录（不生成文件卡片）；Excel 的可编辑工作簿放进工作区。
  const scratch = join(session.storageDir, 'data', 'office-templates')
  const directoryName = `${template.id}-${randomUUID()}`
  const target = join(scratch, directoryName)
  const files: Array<{ workspace_path: string; sha256: string }> = []
  const extensions: string[] = []
  let workbook: string | undefined
  try {
    mkdirSync(scratch, { recursive: true, mode: 0o700 })
    if (lstatSync(scratch).isSymbolicLink()) throw new Error('office-templates 不能是符号链接')
    mkdirSync(target, { mode: 0o700 })
    for (const file of listCaseFiles(source.dir)) {
      const from = join(source.dir, file)
      const to = join(target, file)
      mkdirSync(dirname(to), { recursive: true, mode: 0o700 })
      const expected = sha256(readFileSync(from))
      copyFileSync(from, to, constants.COPYFILE_EXCL)
      const actual = sha256(readFileSync(to))
      if (actual !== expected) throw new Error(`复制校验失败：${file}`)
      files.push({ workspace_path: to, sha256: actual })
    }
    const live = session.office()
    if (live?.templateId !== state.templateId || live?.revision !== state.revision || realpathSync(session.workspaceRoot) !== root) {
      throw new Error('复制过程中案例选择或工作区发生变化，本次副本已作废，请重新调用 office_template。')
    }
    const sample = join(target, template.sampleFile)
    let paragraphs: NativeParagraph[] = []
    let workspacePathOut = sample
    if (template.mode === 'word') {
      const prepared = prepareDocxSource(source.bytes, source.profile)
      if (source.profile?.issuerHeader) writeFileSync(sample, prepared.bytes)
      paragraphs = prepared.paragraphs
      files.find(file => file.workspace_path === sample)!.sha256 = sha256(readFileSync(sample))
    } else {
      let bytes: Uint8Array = readFileSync(sample)
      const extensionPath = join(session.businessRoot, 'extensions', template.id, 'page-setup.json')
      if (existsSync(extensionPath)) {
        bytes = applyPageSetupExtension(bytes, JSON.parse(readFileSync(extensionPath, 'utf8')) as PageSetupExtension)
        extensions.push(`页面设置样例扩展：A3、缩放为 1 页宽、按已用区域设打印区域（extensions/${template.id}/page-setup.json）`)
      }
      workbook = join(root, uniqueWorkspaceFile(root, template.title, '.xlsx'))
      writeFileSync(workbook, bytes, { flag: 'wx', mode: 0o600 })
      workspacePathOut = workbook
    }
    return {
      template_id: template.id,
      revision: template.revision,
      mode: template.mode,
      workspace_path: workspacePathOut,
      reference_dir: target,
      design_path: join(target, 'design.md'),
      files,
      guide: template.mode === 'word'
        ? '参考副本只读。按 editable_paragraphs 的段落 / run ID 调用 office_template_write：replacements 替换全部示例事实（含版头发文机关），additions 用 style_from 继承原段落样式，row_additions 克隆表格行，removals 只删 can_remove=true 的段落。输出写到工作区里新的 .docx。交付前宿主自动跑版式守卫，未通过不能完成。'
        : 'workspace_path 是工作区里的可编辑工作簿（案例原件不变）。用 OfficeCLI（officecli load_skill excel）改输入格，不覆盖公式和图表。交付前必须调用 xlsx_recalculate；未重算或核对不一致不能完成。',
      skill: template.mode === 'word' ? 'officecli-docx' : 'officecli-xlsx',
      editing_tool: template.mode === 'word' ? 'office_template_write' : 'officecli + xlsx_recalculate',
      editable_paragraphs: paragraphs,
      sample_extensions: extensions,
    }
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    if (workbook) rmSync(workbook, { force: true })
    throw error
  }
}

export interface TemplateWriteArgs extends DocxEditPlan { output_path?: unknown }

export async function writeOfficeTemplate(session: OfficeToolSession, args: TemplateWriteArgs): Promise<{ path: string; sha256: string; checks: string[]; font_warnings: FontWarning[] }> {
  if (!session.canWrite) throw new Error('office_template_write 需要工作区写权限，当前是只读模式。')
  const { template } = selected(session, undefined)
  if (template.mode !== 'word') throw new Error('office_template_write 只用于 Word 案例；Excel 用 OfficeCLI 改副本后调用 xlsx_recalculate。')
  const source = templateSourceFor(session, template)
  const output = workspacePath(session.workspaceRoot, args.output_path, /\.docx$/i, true)
  if (existsSync(output.absolute)) throw new Error(`输出文件已存在：${output.relative}。请换一个新的 .docx 路径，不覆盖已有文件。`)
  let written
  try {
    written = writeDocxFromTemplate(source.bytes, source.profile, args)
  } catch (error) {
    if (error instanceof DocxPlanError) throw new Error(`写入计划无效：${error.message}`)
    throw error
  }
  if (!written.report.ok) throw new Error(`${formatLayoutDiagnostics(output.relative, written.report)}\n未写入文件。`)
  const live = session.office()
  if (live?.templateId !== template.id || live.revision !== template.revision) throw new Error('写入过程中案例选择发生变化，请重新调用 office_template。')
  writeFileSync(output.absolute, written.bytes, { flag: 'wx', mode: 0o600 })
  return { path: output.relative, sha256: sha256(written.bytes), checks: written.report.checks, font_warnings: await fontWarningsFor(written.bytes, session.fonts).catch(() => []) }
}

// ── xlsx_recalculate ─────────────────────────────────────────────────────

function recordsPath(session: OfficeToolSession): string { return join(session.storageDir, 'data', RECORD_FILE) }

function readRecords(session: OfficeToolSession): DeliveryRecords {
  try { return JSON.parse(readFileSync(recordsPath(session), 'utf8')) as DeliveryRecords } catch { return { xlsx: {} } }
}

function writeRecords(session: OfficeToolSession, records: DeliveryRecords): void {
  mkdirSync(join(session.storageDir, 'data'), { recursive: true })
  writeFileSync(recordsPath(session), JSON.stringify(records, null, 2))
}

function caseChecks(session: OfficeToolSession): CheckSpec[] | undefined {
  const state = session.office()
  if (state?.mode !== 'excel' || !state.templateId) return undefined
  const entry = catalogCase(session.businessRoot, state.templateId)
  if (!entry) return undefined
  const path = join(caseDir(session.businessRoot, entry), 'checks.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as CheckSpec[] : undefined
}

/** OfficeCLI 1.0.157 会自动起常驻进程，set 后改动可能还没写盘；重算前先落盘并释放文件。 */
export function flushOfficecliResident(binary: string | undefined, file: string): void {
  if (!binary) return
  spawnSync(binary, ['close', file], { timeout: 30_000, windowsHide: true, env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' } })
}

export async function recalculateWorkspaceXlsx(session: OfficeToolSession, args: XlsxToolArgs): Promise<XlsxToolResult & { font_warnings: FontWarning[] }> {
  if (!session.canWrite) throw new Error('xlsx_recalculate 需要工作区写权限，当前是只读模式。')
  const file = workspacePath(session.workspaceRoot, args.path, /\.xlsx$/i)
  if (!existsSync(file.absolute) || !statSync(file.absolute).isFile()) throw new Error(`文件不存在：${file.relative}`)
  if (statSync(file.absolute).size > OOXML_MAX_BYTES) throw new Error('工作簿超过 64 MB')
  flushOfficecliResident(session.xlsx?.officecliBinary, file.absolute)
  const bytes = readFileSync(file.absolute)
  const { bytes: written, result } = await runXlsxRecalculateTool(bytes, args, { ...session.xlsx, checks: session.xlsx?.checks ?? caseChecks(session) })
  writeFileSync(file.absolute, written)
  const digest = sha256(written)
  const records = readRecords(session)
  records.xlsx[realpathSync(file.absolute)] = { sha256: digest, ready: result.ready, code: result.code, message: result.message, at: Date.now() }
  writeRecords(session, records)
  return { path: file.relative, sha256: digest, ...result, font_warnings: await fontWarningsFor(written, session.fonts).catch(() => []) }
}

// ── 交付前守卫 ────────────────────────────────────────────────────────────

export interface DeliveryIssue { path: string; kind: 'word-layout' | 'excel-recalc'; summary: string; detail: string; diagnostics?: LayoutDiagnostic[] }

/**
 * 交付前守卫。与 PPT 导出前硬门约定同一种格式：needs_revision → 问题清单。
 * - Word 案例：本轮改动的每个 .docx 都要对照所选模板通过七项版式检查。
 * - Excel 模式：本轮改动、含公式的 .xlsx 必须已用 xlsx_recalculate 重算并通过核对，且之后没有再被修改。
 */
export function officeDeliveryIssues(session: OfficeToolSession, changedPaths: string[]): DeliveryIssue[] {
  const state = session.office()
  if (!state) return []
  const issues: DeliveryIssue[] = []
  if (state.mode === 'word' && state.templateId) {
    const template = session.templates().find(item => item.id === state.templateId && item.revision === state.revision)
    if (!template?.sampleFile) return []
    const source = templateSourceFor(session, template)
    for (const path of changedPaths.filter(item => /\.docx$/i.test(item))) {
      if (!existsSync(path)) continue
      let report
      try {
        report = validateDocxAgainstTemplate(source.bytes, source.profile, readFileSync(path))
      } catch (error) {
        issues.push({ path, kind: 'word-layout', summary: '无法读取 Word 文件', detail: error instanceof Error ? error.message : String(error) })
        continue
      }
      if (!report.ok) issues.push({ path, kind: 'word-layout', summary: report.diagnostics.map(item => item.message).join('；'), detail: formatLayoutDiagnostics(path, report), diagnostics: report.diagnostics })
    }
  }
  if (state.mode === 'excel') {
    const records = readRecords(session)
    for (const path of changedPaths.filter(item => /\.xlsx$/i.test(item))) {
      if (!existsSync(path)) continue
      const bytes = readFileSync(path)
      let formulas = true
      try { formulas = workbookHasFormulas(bytes) } catch { /* 读不了就要求重算 */ }
      if (!formulas) continue
      const record = records.xlsx[realpathSync(path)]
      if (!record) { issues.push({ path, kind: 'excel-recalc', summary: '还没有调用 xlsx_recalculate', detail: `${path} 含公式，交付前必须调用 xlsx_recalculate 重算并核对。` }); continue }
      if (record.sha256 !== sha256(bytes)) { issues.push({ path, kind: 'excel-recalc', summary: '重算后文件又被修改', detail: `${path} 在 xlsx_recalculate 之后被改动，缓存值可能过期。请重新调用 xlsx_recalculate。` }); continue }
      if (!record.ready) issues.push({ path, kind: 'excel-recalc', summary: record.message, detail: `${path}：${record.message}` })
    }
  }
  return issues
}

export function formatDeliveryIssues(issues: DeliveryIssue[]): string {
  return [
    `needs_revision：${issues.length} 个 Office 文件未通过交付前检查，不能以「就绪」交付。修正后再提交。`,
    ...issues.map((issue, index) => `\n[${index + 1}] ${issue.detail}`),
  ].join('\n')
}
