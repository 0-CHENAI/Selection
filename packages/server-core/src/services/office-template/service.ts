/**
 * Office 会话工具的宿主实现：office_template、office_template_write、xlsx_recalculate，以及交付前守卫。
 * 功能对齐 dsh-desktop 588412b 的 template-tool.js / docx-workflow.js / template-writer.js：
 * - 手选案例优先；普通聊天允许 catalog 标记的原生 Word 样式；复制中选择变化即作废。
 * - 案例复制到会话 data 目录 `office-templates/<id>-<uuid>/`（与 dsh 相同的目录名，放在不生成文件卡片的位置），逐文件 sha256 校验；
 *   Excel 的可编辑工作簿另放工作区；原件只读、永不覆盖。
 * - 写入只产生新文件（O_EXCL），路径限制在工作区内，拒绝符号链接逃逸。
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { OfficeDocumentState } from '@craft-agent/shared/protocol/office'
import { isSessionScratchPath } from '@craft-agent/shared/utils/artifact-links'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import type { OfficeTemplate } from '../office-catalog.ts'
import { applyPageSetupExtension, type PageSetupExtension } from '../excel-delivery/page-setup.ts'
import { runXlsxRecalculateTool, workbookHasFormulas, type XlsxToolArgs, type XlsxToolDeps, type XlsxToolResult } from '../excel-delivery/xlsx-tool.ts'
import type { CheckSpec } from '../office-render-poc/formula.ts'
import { normalizeCaseChecks } from '../excel-delivery/case-checks.ts'
import {
  formatLayoutDiagnostics,
  prepareDocxSource,
  inventoryDocx,
  validateDocxAgainstTemplate,
  writeDocxFromTemplate,
  DocxPlanError,
  type DocxEditPlan,
  type DocxProfile,
  type LayoutDiagnostic,
  type NativeParagraph,
} from './docx-layout.ts'
import { fontWarningsFor, type FontWarning } from './font-diagnostics.ts'
import { OOXML_MAX_BYTES, readOoxmlPackage } from './ooxml-package.ts'

const MAX_CASE_FILES = 200
const MAX_CASE_BYTES = 128 * 1024 * 1024
const RECORD_FILE = 'office-deliveries.json'

export interface OfficeToolSession {
  /** 会话工作区根目录（项目目录或工作区目录）。 */
  workspaceRoot: string
  /** Stable visible user-request ID; internal retries retain it. */
  taskId?: string
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

interface WordDeliveryRecord { taskId?: string; sha256: string; templateId: string; revision: string; sourceSha256: string; planSha256?: string; receipt?: WordWriteReceipt; sourceText?: BoundWordSource }
interface BoundWordSource { path: string; sha256: string }
interface WordPreparation { id: string; workspace: string; templateId: string; revision: string; templateSha256: string; content_mode: 'verbatim' | 'authored'; source?: BoundWordSource }
interface PreparationStore { active: Record<string, string>; items: Record<string, WordPreparation> }
interface PrepareArgs { template_id?: unknown; content_mode?: 'verbatim' | 'authored'; source_text_path?: string }
export interface WordWriteReceipt {
  path: string; sha256: string; checks: string[]; status: 'ready'; next_action: string
  content_check: { paragraphs: number; serialized_text: 'passed'; source_lines?: number; source_sha256?: string; source_order?: 'preserved' }
  tables: Array<{ table: number; rows: number; cells_per_row: number[] }>
  verified: string[]; unverified: string[]; environment_notes: string[]; reused: boolean
  preparation_id?: string
}
interface DeliveryRecords { word?: Record<string, WordDeliveryRecord>; xlsx: Record<string, { sha256: string; ready: boolean; code?: string; message: string; at: number }> }

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
  const lexicalRoot = resolve(rootInput)
  const requested = isAbsolute(raw) ? resolve(raw) : resolve(lexicalRoot, raw)
  // The selected root itself may be an OS alias (/tmp -> /private/tmp).
  // Normalize that trusted prefix only; child symlinks remain forbidden below.
  const candidate = within(lexicalRoot, requested) ? resolve(root, relative(lexicalRoot, requested)) : requested
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

/** Source inputs may live in the workspace or this session's exact data folder. */
function wordSource(session: OfficeToolSession, raw: string): { binding: BoundWordSource; bytes: Buffer } {
  const roots = [session.workspaceRoot, ...(isAbsolute(raw) && existsSync(join(session.storageDir, 'data')) ? [join(session.storageDir, 'data')] : [])]
  let reason = '文件不在允许的目录内'
  for (const root of roots) {
    if (isAbsolute(raw) && !within(resolve(root), resolve(raw)) && !within(realpathSync(root), resolve(raw))) continue
    try {
      const file = workspacePath(root, raw, /\.txt$/i)
      if (!statSync(file.absolute).isFile()) throw new Error('不是普通文件')
      if (statSync(file.absolute).size > 4 * 1024 * 1024) throw new Error('文件超过 4 MiB')
      const bytes = readFileSync(file.absolute)
      return { binding: { path: file.absolute, sha256: sha256(bytes) }, bytes }
    } catch (error) { reason = error instanceof Error ? error.message : String(error) }
  }
  throw new Error(`source_text_path 无效：${reason}。允许工作区 ${session.workspaceRoot} 或本会话 ${join(session.storageDir, 'data')} 内的普通 .txt 文件；优先直接使用原文路径，无需复制，也不要修改 output_path。`)
}

function preparationStore(session: OfficeToolSession): PreparationStore {
  const path = join(session.storageDir, 'data', 'office-word-preparations.json')
  if (!existsSync(path)) return { active: {}, items: {} }
  try {
    const store = JSON.parse(readFileSync(path, 'utf8')) as PreparationStore
    if (!store.active || !store.items || typeof store.active !== 'object' || typeof store.items !== 'object') throw new Error('invalid store')
    return store
  } catch { throw new Error('Word 准备记录损坏，不能跳过已绑定的原文检查。请恢复会话记录后重试。') }
}
function preparationKey(session: OfficeToolSession, template: OfficeTemplate): string {
  return JSON.stringify([realpathSync(session.workspaceRoot), template.id, session.taskId ?? null])
}
function persistPreparation(session: OfficeToolSession, preparation: WordPreparation): void {
  const store = preparationStore(session)
  store.items[preparation.id] = preparation
  store.active[JSON.stringify([preparation.workspace, preparation.templateId, session.taskId ?? null])] = preparation.id
  const path = join(session.storageDir, 'data', 'office-word-preparations.json')
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, JSON.stringify(store), { mode: 0o600 }); renameSync(temporary, path) }
  finally { rmSync(temporary, { force: true }) }
}
function getPreparation(session: OfficeToolSession, template: OfficeTemplate, sourceBytes: Uint8Array, id?: string): WordPreparation | undefined {
  const store = preparationStore(session)
  const selectedId = id ?? store.active[preparationKey(session, template)]
  if (!selectedId) return undefined
  const preparation = store.items[selectedId]
  if (!preparation || preparation.workspace !== realpathSync(session.workspaceRoot) || preparation.templateId !== template.id
    || preparation.revision !== template.revision || preparation.templateSha256 !== sha256(sourceBytes)
    || !['verbatim', 'authored'].includes(preparation.content_mode)
    || (preparation.content_mode === 'verbatim' && (typeof preparation.source?.path !== 'string' || !/^[a-f0-9]{64}$/.test(preparation.source?.sha256 ?? '')))
    || (preparation.content_mode === 'authored' && preparation.source !== undefined)) {
    throw new Error('preparation_id 无效或模板/工作区已变化，请重新调用 office_template 并明确 content_mode。')
  }
  return preparation
}
function newPreparation(session: OfficeToolSession, template: OfficeTemplate, bytes: Uint8Array, args: PrepareArgs): WordPreparation {
  if (args.content_mode === 'authored' && args.source_text_path !== undefined) throw new Error('content_mode=authored 不接受 source_text_path；原样转换请使用 verbatim。')
  if (args.content_mode === 'verbatim' && args.source_text_path === undefined) throw new Error('content_mode=verbatim 必须提供 source_text_path；输出路径无需修改。')
  const source = args.source_text_path !== undefined ? wordSource(session, args.source_text_path).binding : undefined
  return { id: randomUUID(), workspace: realpathSync(session.workspaceRoot), templateId: template.id, revision: template.revision,
    templateSha256: sha256(bytes), content_mode: source ? 'verbatim' : 'authored', ...(source ? { source } : {}) }
}
function boundSourceBytes(session: OfficeToolSession, source: BoundWordSource): Buffer {
  const current = wordSource(session, source.path)
  if (current.binding.sha256 !== source.sha256) throw new Error('source_text_path 原文在准备后已变化，请重新调用 office_template 绑定新版本，不能复用旧检查。')
  return current.bytes
}
function checkSourceText(bytes: Uint8Array, paragraphs: NativeParagraph[]): { source_lines: number; source_sha256: string; source_order: 'preserved' } {
  const normalize = (text: string) => text.replace(/\s+/gu, '')
  const lines = Buffer.from(bytes).toString('utf8').split(/\r?\n/).map(normalize).filter(Boolean)
  const text = normalize(paragraphs.map(p => p.text).join('\n'))
  let cursor = 0
  for (const [index, line] of lines.entries()) {
    const found = text.indexOf(line, cursor)
    if (found < 0) throw new Error(`原文完整性检查失败：第 ${index + 1} 个非空行缺失或顺序不符（仅忽略空白）。请只修正对应编辑项。原文：${JSON.stringify(line.slice(0, 1000))}`)
    cursor = found + line.length
  }
  return { source_order: 'preserved', source_lines: lines.length, source_sha256: sha256(bytes) }
}
function planDigest(plan: unknown): string {
  // Object-key order is not semantic; array order (especially insertions) is.
  return sha256(Buffer.from(JSON.stringify(plan, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)))
}
function tableSummary(paragraphs: NativeParagraph[]): WordWriteReceipt['tables'] {
  const tables = new Map<number, Map<number, number>>()
  for (const { location } of paragraphs) {
    if (location.kind !== 'table-cell') continue
    let rows = tables.get(location.table)
    if (!rows) { rows = new Map(); tables.set(location.table, rows) }
    rows.set(location.row, Math.max(rows.get(location.row) ?? 0, location.cell))
  }
  return [...tables].map(([table, rows]) => ({ table, rows: rows.size, cells_per_row: [...rows].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells) }))
}

function selected(session: OfficeToolSession, templateId: unknown, state = session.office()): { state: OfficeDocumentState; template: OfficeTemplate } {
  if (!state?.templateId) {
    // Only curated, native Word styles may be chosen by the model. An explicit
    // composer selection (including Excel mode) must never be silently replaced.
    const template = session.templates().find(item => item.id === templateId && item.autoSelect && item.mode === 'word')
    if (template && (!state || state.mode === 'word')) {
      return { state: { mode: 'word', templateId: template.id, revision: template.revision }, template }
    }
    throw new Error('当前会话没有选中 Word / Excel 案例。普通聊天新建 Word 请用精简指南中的 style-* 模板；其他案例先在输入框选中。')
  }
  if (!state.revision) throw new Error('所选案例已更新，需要重新选择。')
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
  preparation_id?: string
  content_contract?: { mode: 'verbatim' | 'authored'; source?: BoundWordSource }
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

export async function prepareOfficeTemplate(session: OfficeToolSession, args: PrepareArgs): Promise<PrepareResult> {
  if (!session.canWrite) throw new Error('office_template 需要工作区写权限，当前是只读模式。')
  const officeBefore = session.office() ?? null
  const selectionBefore = JSON.stringify(officeBefore)
  const { template } = selected(session, args.template_id, officeBefore)
  const source = templateSourceFor(session, template)
  const preparation = template.mode === 'word'
    ? (args.content_mode === undefined && args.source_text_path === undefined ? getPreparation(session, template, source.bytes) : undefined) ?? newPreparation(session, template, source.bytes, args)
    : undefined
  if (preparation?.source) boundSourceBytes(session, preparation.source)
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
    if (JSON.stringify(live ?? null) !== selectionBefore || realpathSync(session.workspaceRoot) !== root) {
      throw new Error('复制过程中案例选择或工作区发生变化，本次副本已作废，请重新调用 office_template。')
    }
    const sample = join(target, template.sampleFile)
    let paragraphs: NativeParagraph[] = []
    let workspacePathOut = sample
    if (template.mode === 'word') {
      const prepared = prepareDocxSource(source.bytes, source.profile)
      if (prepared.bytes !== source.bytes) writeFileSync(sample, prepared.bytes)
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
    if (preparation) persistPreparation(session, preparation)
    return {
      ...(preparation ? { preparation_id: preparation.id, content_contract: { mode: preparation.content_mode, source: preparation.source } } : {}),
      template_id: template.id,
      revision: template.revision,
      mode: template.mode,
      workspace_path: workspacePathOut,
      reference_dir: target,
      design_path: join(target, 'design.md'),
      files,
      guide: template.mode === 'word'
        ? '参考副本只读。按 editable_paragraphs 的段落 / run ID 调用 office_template_write：replacements 替换全部示例事实（含版头发文机关），additions 用 style_from 继承原段落样式，row_additions 克隆表格行，removals 只删 can_remove=true 的段落。输出写到工作区里新的 .docx，template_id 必须原样传回。location 标明正文或表格位置（table/row/cell 为 1 起始），不需要探查 XML。用 before_paragraph_id 可在指定段落之前插入（如表后第一标题之前）；after_paragraph_id 在段后插入，二选一。独立正文使用独立 additions。传回 preparation_id；准备时绑定的原文检查在重试时自动继承，不能靠漏传 source_text_path 跳过。改写/摘要任务请重新准备 content_mode=authored。章节名称可按任务调整；无需的可移除段落可删除。替换所有【占位符】，不虚构事实。宿主一次写入并检查版式；成功即交付，不再 validate、office_render、截图或模型复审。'
        : 'workspace_path 是工作区里的可编辑工作簿（案例原件不变）。按 OfficeCLI 路由的精简 Excel 指南批量改输入格，不覆盖公式和图表，不加载完整官方指南。完成全部修改后调用一次 xlsx_recalculate（visual_review=not-needed；仅用户要求视觉验收或有具体显示问题时检查相关区域）。未重算或核对不一致不能完成。',
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

export interface TemplateWriteArgs extends DocxEditPlan { output_path?: unknown; template_id?: unknown; source_text_path?: string; preparation_id?: string }

export async function writeOfficeTemplate(session: OfficeToolSession, args: TemplateWriteArgs): Promise<WordWriteReceipt> {
  if (!session.canWrite) throw new Error('office_template_write 需要工作区写权限，当前是只读模式。')
  const officeBefore = session.office() ?? null
  const selectionBefore = JSON.stringify(officeBefore)
  const { template } = selected(session, args.template_id, officeBefore)
  if (template.mode !== 'word') throw new Error('office_template_write 只用于 Word 案例；Excel 用 OfficeCLI 改副本后调用 xlsx_recalculate。')
  const source = templateSourceFor(session, template)
  let preparation = getPreparation(session, template, source.bytes, args.preparation_id)
  if (args.source_text_path !== undefined) {
    const supplied = wordSource(session, args.source_text_path)
    if (preparation?.source && (preparation.source.path !== supplied.binding.path || preparation.source.sha256 !== supplied.binding.sha256)) throw new Error('source_text_path 与准备阶段绑定的原文不一致；请重新调用 office_template 明确新任务。')
    if (!preparation?.source) {
      preparation = preparation ? { ...preparation, content_mode: 'verbatim', source: supplied.binding } : newPreparation(session, template, source.bytes, { source_text_path: args.source_text_path })
      persistPreparation(session, preparation) // Persist before plan validation: failed retries cannot omit the requirement.
    }
  }
  if (args.preparation_id && preparation) persistPreparation(session, preparation) // Explicit continuation also binds omission-safe retries in this request.
  const sourceText = preparation?.source ? boundSourceBytes(session, preparation.source) : undefined
  let output: ReturnType<typeof workspacePath>
  try {
    const requested = typeof args.output_path === 'string' ? resolve(session.workspaceRoot, args.output_path) : ''
    if (isSessionScratchPath(requested) || ['data', 'plans', 'long_responses'].some(folder => within(resolve(session.storageDir, folder), requested))) {
      throw new Error(`最终产物不能写入会话临时目录，请改用 ${join(session.storageDir, 'outputs')} 或当前项目目录`)
    }
    output = workspacePath(session.workspaceRoot, args.output_path, /\.docx$/i, true)
  }
  catch (error) { throw new Error(`output_path 无效：${error instanceof Error ? error.message : String(error)}。成品应位于工作区 ${session.workspaceRoot}，例如 report.docx；无需修改 source_text_path。`) }
  const planSha256 = planDigest({ replacements: args.replacements ?? [], additions: args.additions ?? [], row_additions: args.row_additions ?? [], removals: args.removals ?? [], sourceText: preparation?.source ?? null })
  if (existsSync(output.absolute)) {
    const existingRecords = readRecords(session)
    const previous = existingRecords.word?.[realpathSync(output.absolute)]
    if (previous?.receipt && previous.planSha256 === planSha256 && previous.templateId === template.id && previous.revision === template.revision
      && previous.sourceSha256 === sha256(source.bytes) && previous.sha256 === sha256(readFileSync(output.absolute))) {
      if (previous.taskId !== session.taskId) { previous.taskId = session.taskId; writeRecords(session, existingRecords) }
      return { ...previous.receipt, preparation_id: preparation?.id, reused: true }
    }
    throw new Error(`output_path 已存在：${output.relative}，内容或编辑计划与已通过检查的版本不一致。请指定新的 .docx 文件名，不覆盖已有文件。`)
  }
  let written
  try {
    written = writeDocxFromTemplate(source.bytes, source.profile, args)
  } catch (error) {
    if (error instanceof DocxPlanError) throw new Error(`写入计划无效：${error.message}`)
    throw error
  }
  if (!written.report.ok) throw new Error(`${formatLayoutDiagnostics(output.relative, written.report)}\n未写入文件。`)
  const live = session.office()
  if (JSON.stringify(live ?? null) !== selectionBefore) throw new Error('写入过程中案例选择发生变化，请重新调用 office_template。')
  const savedParagraphs = inventoryDocx(readOoxmlPackage(written.bytes), source.profile)
  if (template.autoSelect) {
    const placeholders = new Set(prepareDocxSource(source.bytes, source.profile).paragraphs.flatMap(p => p.text.match(/【[^】]+】/g) ?? []))
    const leftovers = savedParagraphs.filter(p => [...placeholders].some(token => p.text.includes(token)))
    if (leftovers.length) throw new Error(`仍有模板占位符未替换：${leftovers.map(p => p.id + ' ' + p.text).slice(0, 8).join('；')}。未写入文件。`)
  }
  const contentCheck: { paragraphs: number; serialized_text: 'passed'; source_lines?: number; source_sha256?: string; source_order?: 'preserved' } = { ...written.contentCheck }
  if (sourceText) Object.assign(contentCheck, checkSourceText(sourceText, savedParagraphs))
  writeFileSync(output.absolute, written.bytes, { flag: 'wx', mode: 0o600 })
  const receipt: WordWriteReceipt = {
    status: 'ready', next_action: '文件已保存。verified 列出的检查已针对本 sha256 完成，直接交付链接；无需重复读取或验证。unverified 是范围边界，不是待办。文件变化后检查失效。',
    path: output.relative, sha256: sha256(written.bytes), checks: written.report.checks, content_check: contentCheck,
    tables: tableSummary(savedParagraphs), verified: ['template-structure-and-styles', 'submitted-text-roundtrip', ...(sourceText ? ['source-text-coverage-and-order'] : [])],
    unverified: ['factual-accuracy', 'visual-pagination', ...(!sourceText ? ['source-text-coverage-no-bound-source'] : [])],
    environment_notes: (await fontWarningsFor(written.bytes, session.fonts).catch(() => [])).map(item => item.message), reused: false, preparation_id: preparation?.id,
  }
  const records = readRecords(session)
  records.word ??= {}
  records.word[realpathSync(output.absolute)] = { taskId: session.taskId, sha256: receipt.sha256, templateId: template.id, revision: template.revision, sourceSha256: sha256(source.bytes), planSha256, receipt, sourceText: preparation?.source }
  writeRecords(session, records)
  return receipt
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
  if (!existsSync(path)) return undefined
  const checks = normalizeCaseChecks(JSON.parse(readFileSync(path, 'utf8')), `${state.templateId}/checks.json`)
  return checks.length ? checks : undefined
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
 * - Word：仅对宿主写出的成品按其自身模板检查；同一文件/模板指纹复用写入结果，不将当前选择强套给外来文件。
 * - Excel 模式：本轮改动、含公式的 .xlsx 必须已用 xlsx_recalculate 重算并通过核对，且之后没有再被修改。
 */
export function officeDeliveryIssues(session: OfficeToolSession, changedPaths: string[]): DeliveryIssue[] {
  const state = session.office()
  const records = readRecords(session)
  const issues: DeliveryIssue[] = []
  let recordsChanged = false
  {
    for (const path of changedPaths.filter(item => /\.docx$/i.test(item))) {
      if (!existsSync(path)) continue
      const record = records.word?.[realpathSync(path)]
      if (!record) continue
      const template = session.templates().find(item => item.id === record.templateId && item.revision === record.revision)
      if (!template?.sampleFile) {
        issues.push({ path, kind: 'word-layout', summary: '模板已更新', detail: '无法核对该文件的模板版本，请重新准备模板。' })
        continue
      }
      let report
      let digest: string
      let sourceDigest: string
      try {
        const source = templateSourceFor(session, template)
        const bytes = readFileSync(path)
        digest = sha256(bytes)
        sourceDigest = sha256(source.bytes)
        if (record.sha256 === digest && record.sourceSha256 === sourceDigest) continue
        report = validateDocxAgainstTemplate(source.bytes, source.profile, bytes)
        if (record.sourceText && record.taskId === session.taskId) checkSourceText(boundSourceBytes(session, record.sourceText), inventoryDocx(readOoxmlPackage(bytes), source.profile))
      } catch (error) {
        issues.push({ path, kind: 'word-layout', summary: 'Word 或绑定原文检查未通过', detail: error instanceof Error ? error.message : String(error) })
        continue
      }
      if (!report.ok) issues.push({ path, kind: 'word-layout', summary: report.diagnostics.map(item => item.message).join('；'), detail: formatLayoutDiagnostics(path, report), diagnostics: report.diagnostics })
      else {
        if (record.taskId !== session.taskId) delete record.sourceText
        record.taskId = session.taskId
        delete record.receipt
        delete record.planSha256
        record.sha256 = digest
        record.sourceSha256 = sourceDigest
        recordsChanged = true
      }
    }
  }
  if (recordsChanged) writeRecords(session, records)
  if (state?.mode === 'excel') {
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
