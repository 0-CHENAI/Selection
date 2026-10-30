import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { OfficeInjectionMarker } from '@craft-agent/core/types'
import {
  OFFICE_FILE_DELIVERY_SUFFIX,
  OFFICE_BUSINESS_SKILL_SLUGS,
  isOfficeBusinessSkill,
} from '@craft-agent/shared/skills/office-business-skills'
import { getBundledSkillsDir } from '@craft-agent/shared/skills'
import { getBundledOfficecliSkillsDir } from '@craft-agent/shared/utils/officecli'
import {
  OFFICE_FORMAT_UPDATED,
  OFFICE_INJECTION_SOURCE,
  OFFICE_REQUEST_MAX_BYTES,
  type OfficeDocumentMode,
  type OfficeDocumentState,
  type OfficePreview,
  type OfficeRequest,
  type OfficeTemplateSummary,
  type OfficeTemplatesResult,
} from '@craft-agent/shared/protocol/office'

export interface OfficeTemplate extends OfficeTemplateSummary {
  prompt?: string
}

export interface OfficeTranscriptMessage {
  id: string
  role: string
  content: string
  hidden?: boolean
  timestamp?: number
  officeInjection?: OfficeInjectionMarker
}

interface CatalogFile {
  cases?: unknown
  templates?: unknown
}

const MODE: Record<string, OfficeDocumentMode> = { word: 'word', excel: 'excel' }

export function getOfficeBusinessRoot(): string {
  const skills = getBundledSkillsDir()
  if (!skills) throw new Error('Office 案例目录不可用。')
  return realpathSync(join(skills, 'office-business'))
}

function readCatalog(root: string): CatalogFile {
  const path = join(root, 'catalog.json')
  return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile
}

function asSkills(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const skills = list.filter((item): item is string => typeof item === 'string' && isOfficeBusinessSkill(item))
  if (skills.length !== list.length) throw new Error('Office 案例绑定了未知的业务技能。')
  return skills
}

function safeRelative(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.includes('..') || isAbsolute(value)) return undefined
  return value
}

function parseTemplate(value: unknown): OfficeTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Office 案例目录无效。')
  const item = value as Record<string, unknown>
  const selection = item.selection && typeof item.selection === 'object' && !Array.isArray(item.selection)
    ? item.selection as Record<string, unknown>
    : undefined
  const mode = MODE[String(item.mode)]
  if (typeof item.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id) || !mode) throw new Error('Office 案例目录无效。')
  if (typeof item.title !== 'string' || typeof item.revision !== 'string' || !/^[A-Za-z0-9._-]+$/.test(item.revision)) throw new Error('Office 案例目录无效。')
  const source = safeRelative(item.source) ?? safeRelative(selection?.assetDir) ?? safeRelative(typeof selection?.recipe === 'string' ? selection.recipe.replace(/\/[^/]+$/, '') : undefined) ?? `cases/${item.id}`
  const sampleFile = item.sampleFile === null || item.sampleFile === undefined ? '' : item.sampleFile
  if (typeof sampleFile !== 'string' || sampleFile.includes('..') || sampleFile.includes('/') || sampleFile.includes('\\')) throw new Error('Office 案例目录无效。')
  const previewCount = typeof item.previewCount === 'number'
    ? item.previewCount
    : Array.isArray(item.previewPages) ? item.previewPages.length : 0
  if (!Number.isInteger(previewCount) || previewCount < 0 || previewCount > 500) throw new Error('Office 案例目录无效。')
  return {
    id: item.id,
    title: item.title,
    mode,
    revision: item.revision,
    category: typeof item.category === 'string' ? item.category : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
    businessSkills: asSkills(item.businessSkills ?? item.businessSkill),
    source,
    sampleFile,
    previewCount,
  }
}

export function listOfficeTemplates(root = getOfficeBusinessRoot()): OfficeTemplate[] {
  const catalog = readCatalog(root)
  const entries = Array.isArray(catalog.cases) ? catalog.cases : catalog.templates
  if (!Array.isArray(entries)) throw new Error('Office 案例目录无效。')
  const templates = entries.map(parseTemplate)
  const ids = new Set<string>()
  for (const template of templates) {
    if (ids.has(template.id)) throw new Error(`Office 案例重复：${template.id}`)
    ids.add(template.id)
  }
  return templates
}

export function officeFingerprint(state: Pick<OfficeDocumentState, 'mode' | 'templateId' | 'revision'> | null | undefined): string {
  if (!state?.mode) return ''
  const names: string[] = [state.mode]
  if (state.templateId && state.revision) names.push(`${state.templateId}@${state.revision}`)
  return names.join(':')
}

export function assertOfficeRequestBody(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length > OFFICE_REQUEST_MAX_BYTES) throw new Error('Office 请求超过 16 KB，已拒绝。')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Office 请求无法解析。')
  }
}

function templateById(templates: OfficeTemplate[], id: string): OfficeTemplate {
  const template = templates.find(item => item.id === id)
  if (!template) throw new Error('未知的 Office 案例。')
  return template
}

export function selectOfficeTemplate(templateId: string, revision: string, templates: OfficeTemplate[]): OfficeDocumentState {
  if (typeof templateId !== 'string' || typeof revision !== 'string') throw new Error('未知的 Office 案例。')
  const template = templateById(templates, templateId)
  if (template.revision !== revision) throw new Error('案例已更新，请刷新目录后重新选择。')
  return { mode: template.mode, templateId: template.id, revision: template.revision }
}

export function assertOfficeSelectionFresh(state: OfficeDocumentState, templates: OfficeTemplate[]): void {
  if (!state.templateId) return
  const template = templates.find(item => item.id === state.templateId)
  if (!template || template.revision !== state.revision || template.mode !== state.mode) {
    throw new Error('所选案例已更新，需要重新选择。')
  }
}

export function selectOfficeRequest(current: OfficeDocumentState | null | undefined, request: OfficeRequest, templates: OfficeTemplate[]): OfficeDocumentState {
  if (request?.mode !== 'word' && request?.mode !== 'excel') throw new Error('未知的文档模式。')
  if (request.templateId === undefined) {
    if (current?.mode === request.mode) return current
    return { mode: request.mode }
  }
  if (!request.revision) throw new Error('选择案例时必须带上 revision。')
  const selected = selectOfficeTemplate(request.templateId, request.revision, templates)
  return { ...selected, injectionFingerprint: current?.injectionFingerprint }
}

export function setOfficeDocumentMode(current: OfficeDocumentState | null | undefined, mode: OfficeDocumentMode | null): OfficeDocumentState | undefined {
  if (mode === null) return undefined
  if (mode !== 'word' && mode !== 'excel') throw new Error('未知的文档模式。')
  if (current && current.mode === mode) return current
  return { mode }
}

export function deselectOfficeTemplate(current: OfficeDocumentState | null | undefined): OfficeDocumentState | undefined {
  if (!current) return undefined
  return { mode: current.mode, injectionFingerprint: current.injectionFingerprint }
}

export function selectedOfficeTemplate(state: OfficeDocumentState | null | undefined, templates: OfficeTemplate[]): OfficeTemplate | undefined {
  if (!state?.templateId || !state.revision) return undefined
  return templates.find(item => item.id === state.templateId && item.mode === state.mode && item.revision === state.revision)
}

export function officeSelectionView(state: OfficeDocumentState | null | undefined, templates: OfficeTemplate[]): Pick<OfficeTemplatesResult, 'mode' | 'selectedTemplateId' | 'selectionExpired'> {
  const selected = selectedOfficeTemplate(state, templates)
  return {
    mode: state?.mode ?? null,
    selectedTemplateId: selected?.id ?? null,
    selectionExpired: !!state?.templateId && !selected,
  }
}

function safeOfficePath(root: string, asset: string): string {
  if (isAbsolute(asset) || asset.includes('..')) throw new Error('Office 预览路径无效。')
  const canonicalRoot = realpathSync(root)
  const path = resolve(canonicalRoot, asset)
  const within = relative(canonicalRoot, path)
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Office 预览路径无效。')
  return path
}

export function officeTemplatePreview(templateId: string, revision: string, page: number | undefined, templates: OfficeTemplate[], root = getOfficeBusinessRoot()): OfficePreview {
  const template = selectOfficeTemplate(templateId, revision, templates)
  const entry = templateById(templates, template.templateId!)
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) throw new Error('预览页码无效。')
  const relativePath = !entry.sampleFile
    ? entry.source
    : page === undefined || entry.previewCount === 0
      ? join('sources', entry.source, entry.sampleFile)
      : join('sources', entry.source, 'preview', `${page}.png`)
  if (page !== undefined && entry.previewCount > 0 && page > entry.previewCount) throw new Error('预览页码超出案例页数。')
  if (page !== undefined && entry.previewCount === 0) throw new Error('该案例还没有分页预览。')
  const path = safeOfficePath(root, relativePath)
  return { path: relativePath.split(sep).join('/'), available: existsSync(path), page }
}

export interface OfficeTemplatesCommand {
  endpoint?: unknown
  mode?: unknown
  templateId?: unknown
  revision?: unknown
  page?: unknown
}

export function executeOfficeTemplates(input: {
  raw: string
  office?: OfficeDocumentState | null
  sessionId?: string
  templates?: OfficeTemplate[]
  root?: string
}): { office?: OfficeDocumentState | null; clearPpt: boolean; result: OfficeTemplatesResult } {
  const payload = assertOfficeRequestBody(input.raw) as OfficeTemplatesCommand
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Office 请求无法解析。')
  const templates = input.templates ?? listOfficeTemplates(input.root)
  const root = input.root ?? getOfficeBusinessRoot()
  const endpoint = payload.endpoint
  if (endpoint === 'catalog' || (endpoint === 'state' && !input.sessionId)) {
    return { office: input.office, clearPpt: false, result: { ...officeSelectionView(undefined, templates), templates } }
  }
  if (endpoint !== 'state' && endpoint !== 'mode' && endpoint !== 'select' && endpoint !== 'deselect' && endpoint !== 'preview') {
    throw new Error('未知的 Office 操作。')
  }
  if (!input.sessionId) throw new Error('请选择一个进行中的会话。')
  let office = input.office
  let clearPpt = false
  let preview: OfficePreview | undefined
  if (endpoint === 'mode') {
    if (payload.mode !== null && payload.mode !== 'word' && payload.mode !== 'excel') throw new Error('未知的文档模式。')
    const mode: OfficeDocumentMode | null = payload.mode === 'excel' ? 'excel' : payload.mode === null ? null : 'word'
    office = setOfficeDocumentMode(office, mode)
    clearPpt = true
  } else if (endpoint === 'select') {
    if (typeof payload.templateId !== 'string' || typeof payload.revision !== 'string') throw new Error('未知的 Office 案例。')
    const selected = selectOfficeTemplate(payload.templateId, payload.revision, templates)
    office = { ...selected, injectionFingerprint: office?.injectionFingerprint }
    clearPpt = true
  } else if (endpoint === 'deselect') {
    office = deselectOfficeTemplate(office)
    clearPpt = true
  } else if (endpoint === 'preview') {
    if (typeof payload.templateId !== 'string' || typeof payload.revision !== 'string') throw new Error('未知的 Office 案例。')
    const page = payload.page === undefined ? undefined : payload.page
    if (page !== undefined && typeof page !== 'number') throw new Error('预览页码无效。')
    preview = officeTemplatePreview(payload.templateId, payload.revision, page, templates, root)
  }
  return {
    office,
    clearPpt,
    result: { ...officeSelectionView(office, templates), templates, ...(preview ? { preview } : {}) },
  }
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').trim()
}

function readText(path: string): string {
  return stripFrontmatter(readFileSync(path, 'utf8'))
}

function guidePath(slug: 'officecli-docx' | 'officecli-xlsx'): string {
  const bundled = getBundledOfficecliSkillsDir()
  const candidates = [
    bundled ? join(bundled, slug, 'SKILL.md') : '',
    join(import.meta.dir, '../../../../apps/electron/resources/officecli/1.0.157/skills', slug, 'SKILL.md'),
  ].filter(Boolean)
  const found = candidates.find(path => existsSync(path))
  if (!found) throw new Error('Office 基础技能不可用。')
  return found
}

function businessSkillPath(slug: string, skillsRoot?: string): string {
  if (!isOfficeBusinessSkill(slug)) throw new Error('所选业务技能不可用。')
  const canonical = join(getOfficeBusinessRoot(), 'business-skills', slug, 'SKILL.md')
  if (existsSync(canonical)) return canonical
  const root = skillsRoot ?? getBundledSkillsDir()
  const path = root ? join(root, slug, 'SKILL.md') : ''
  if (path && existsSync(path)) return path
  throw new Error('所选业务技能不可用。')
}

export function readBusinessSkillText(slug: string, skillsRoot?: string): string {
  const body = readText(businessSkillPath(slug, skillsRoot))
  if (body.includes('## 文件交付') || body.includes('## Selection 文件交付')) return body
  return `${body}\n\n${OFFICE_FILE_DELIVERY_SUFFIX}`
}

export function authoringSkillForMode(mode: OfficeDocumentMode | 'ppt' | null): { skill: string; allowOfficePptxAuthoring: boolean } {
  if (mode === 'ppt') return { skill: 'ppt-design', allowOfficePptxAuthoring: false }
  if (mode === 'word') return { skill: 'officecli-docx', allowOfficePptxAuthoring: false }
  if (mode === 'excel') return { skill: 'officecli-xlsx', allowOfficePptxAuthoring: false }
  return { skill: '', allowOfficePptxAuthoring: false }
}

export function buildOfficeInjection(state: OfficeDocumentState, templates: OfficeTemplate[], skillsRoot?: string): string {
  const guide = state.mode === 'word' ? 'office-docx' : 'office-xlsx'
  const slug = state.mode === 'word' ? 'officecli-docx' : 'officecli-xlsx'
  const label = state.mode === 'word' ? 'Word DOCX' : 'Excel XLSX'
  const foundation = readText(guidePath(slug))
  const parts = [
    `当前输出格式：${label}。`,
    `${guide} 指南（实现是 OfficeCLI 的 ${slug}，不搬入 python-docx 或 openpyxl 正文）：`,
    foundation,
    '方法要点：用 OfficeCLI 的路径修改工作区副本。案例原件只读。不要使用 python-docx 或 openpyxl。不要把 officecli-pptx 当作本次成稿技能，也不要改走 ppt-design。分册和参考资料只在需要时读取。预览在 Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`，否则用 Electron capturePage。PDF 再不行时用 OfficeCLI HTML 加 Electron printToPDF。',
  ]
  const template = selectedOfficeTemplate(state, templates)
  if (template) {
    const toolOrder = template.mode === 'word'
      ? `先调用 office_template(template_id="${template.id}")，再用 office_template_write 按返回的 editable_paragraphs 编排并替换内容，生成新的 DOCX。这两个工具在阶段 08 接入。接入前用 OfficeCLI 在工作区副本上按段落修改。`
      : `先调用 office_template(template_id="${template.id}")，再用 office-xlsx 处理返回的原生工作副本。重算交给 officeRender.recalc；未接入时不要把缓存值当成已重算结果。`
    parts.push([
      `当前界面所选 Office 案例：${template.title}。`,
      `selected_template_id: ${template.id}`,
      `selected_template_revision: ${template.revision}`,
      `${template.id}@${template.revision}`,
      toolOrder,
      '案例提供版式、章节、工作表与图表结构。当前用户材料提供全部事实、数值和结论；模板中的示例数据属于参考材料。本轮以及中途上传的文件是用户材料，不是新的案例模板。',
      template.businessSkills.length ? `业务方法使用 ${template.businessSkills.join('、')}。` : '',
    ].filter(Boolean).join('\n'))
    for (const skill of template.businessSkills) {
      parts.push(`<business_skill name="${skill}">\n${readBusinessSkillText(skill, skillsRoot)}\n</business_skill>`)
    }
  }
  return parts.join('\n\n')
}

export function reconcileOfficeInjection<T extends OfficeTranscriptMessage>(
  messages: readonly T[],
  fingerprint: string,
  createInjection: () => string,
): { messages: T[]; modelAddition?: string; changed: boolean } {
  const next = messages.map(message => ({ ...message }))
  let active = false
  let replaced = false
  for (const message of next) {
    if (message.officeInjection?.source !== OFFICE_INJECTION_SOURCE) continue
    if (fingerprint && message.officeInjection.fingerprint === fingerprint && message.officeInjection.status === 'active') {
      active = true
      continue
    }
    if (message.officeInjection.status !== 'active') continue
    message.content = OFFICE_FORMAT_UPDATED
    message.officeInjection = { ...message.officeInjection, status: 'replaced' }
    replaced = true
  }
  if (!fingerprint || active) {
    return { messages: next, modelAddition: replaced ? OFFICE_FORMAT_UPDATED : undefined, changed: replaced }
  }
  const text = createInjection()
  next.push({
    id: `office-${randomUUID()}`,
    role: 'user',
    content: text,
    hidden: true,
    timestamp: Date.now(),
    officeInjection: { source: OFFICE_INJECTION_SOURCE, fingerprint, status: 'active' },
  } as T)
  const modelAddition = [replaced ? OFFICE_FORMAT_UPDATED : undefined, text].filter(Boolean).join('\n\n')
  return { messages: next, modelAddition, changed: true }
}

export function projectOfficeModelContext(messages: readonly OfficeTranscriptMessage[]): string {
  return messages.filter(message => message.officeInjection).map(message => message.content).join('\n\n')
}

export function preserveOfficeInjection<T extends OfficeTranscriptMessage>(
  messages: readonly T[],
  office: OfficeDocumentState,
  templates: OfficeTemplate[],
  skillsRoot?: string,
): { messages: T[]; office: OfficeDocumentState } {
  const fingerprint = officeFingerprint(office)
  if (!fingerprint) return { messages: [...messages], office }
  const active = messages.some(message => message.officeInjection?.source === OFFICE_INJECTION_SOURCE && message.officeInjection.status === 'active' && message.officeInjection.fingerprint === fingerprint)
  if (active) return { messages: [...messages], office: { ...office, injectionFingerprint: fingerprint } }
  const restored = reconcileOfficeInjection(messages, fingerprint, () => buildOfficeInjection({ ...office, injectionFingerprint: fingerprint }, templates, skillsRoot))
  return { messages: restored.messages, office: { ...office, injectionFingerprint: fingerprint } }
}

export function planOfficeTurn<T extends OfficeTranscriptMessage>(input: {
  office?: OfficeDocumentState | null
  messages: readonly T[]
  request?: OfficeRequest
  ppt?: boolean
  templates?: OfficeTemplate[]
  skillsRoot?: string
}): { office?: OfficeDocumentState; clearPpt: boolean; messages: T[]; modelAddition?: string } {
  const templates = input.templates ?? listOfficeTemplates()
  if (input.ppt && input.request) throw new Error('同一会话不能同时选择 PPT 与 Word / Excel。')
  if (input.ppt) {
    const cleared = reconcileOfficeInjection(input.messages, '', () => '')
    return { office: undefined, clearPpt: false, messages: cleared.messages, modelAddition: cleared.modelAddition }
  }
  let office = input.request ? selectOfficeRequest(input.office, input.request, templates) : input.office
  if (!office) return { office: undefined, clearPpt: false, messages: [...input.messages] }
  assertOfficeSelectionFresh(office, templates)
  const fingerprint = officeFingerprint(office)
  const reconciled = reconcileOfficeInjection(input.messages, fingerprint, () => buildOfficeInjection(office!, templates, input.skillsRoot))
  office = { ...office, injectionFingerprint: fingerprint }
  return { office, clearPpt: true, messages: reconciled.messages, modelAddition: reconciled.modelAddition }
}

export function officeUserMaterialNote(names: readonly string[]): string | undefined {
  const clean = names.map(name => name.trim()).filter(Boolean)
  if (!clean.length) return undefined
  return [
    '本轮上传的文件是用户材料，不是案例模板，也不替换当前所选案例。',
    ...clean.map(name => `用户材料：${JSON.stringify(name)}`),
  ].join('\n')
}

export function officeAttachmentsKeepTemplate(names: readonly string[], state: OfficeDocumentState): OfficeDocumentState {
  // Names are intentionally unused for selection. Uploads never become the case.
  void names
  return { mode: state.mode, templateId: state.templateId, revision: state.revision, injectionFingerprint: state.injectionFingerprint }
}

export { OFFICE_BUSINESS_SKILL_SLUGS }
