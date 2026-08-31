import type {
  ElectronAPI,
  SkillImportDecision,
  SkillImportPreview,
} from '../../../shared/types'

export type SkillFileImportApi = Pick<
  ElectronAPI,
  'previewSkillFileImport' | 'importSkillFile'
>

export type SkillFilePayload =
  | { kind: 'markdown'; content: string }
  | { kind: 'zip'; zipBase64: string }

export interface PreparedSkillFileImport {
  payload: SkillFilePayload
  preview: SkillImportPreview
}

export interface SkillFilePickerGuard {
  current: boolean
}

interface SkillFilePickerCancelTarget {
  addEventListener(type: 'cancel', listener: EventListener): void
  removeEventListener(type: 'cancel', listener: EventListener): void
}

export type McpJsonImportApi = Pick<ElectronAPI, 'importMcpJson'>

export type SkillFileImportResult =
  | { status: 'imported'; slug: string }
  | { status: 'skipped'; slug: string }

const MAX_SKILL_MARKDOWN_BYTES = 2 * 1024 * 1024
const MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024
const BASE64_CHUNK_BYTES = 0x8000

export function isSupportedSkillImportFile(file: Pick<File, 'name'>): boolean {
  return /\.(?:md|zip)$/i.test(file.name)
}

export function getDroppedSkillImportFile(files: ArrayLike<File>): File {
  if (files.length === 0) {
    throw new Error('Drop a SKILL.md or skill Zip to import')
  }
  if (files.length > 1) {
    throw new Error('Drop one SKILL.md or skill Zip at a time')
  }

  const file = files[0]
  if (!file || !isSupportedSkillImportFile(file)) {
    throw new Error('Only SKILL.md and skill Zip files can be imported')
  }
  return file
}

function hasMcpServerConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const server = value as Record<string, unknown>
  return ['command', 'url', 'serverUrl'].some(key =>
    typeof server[key] === 'string' && server[key].trim().length > 0,
  )
}

export function validateMcpImportJsonInput(value: string): void {
  if (!value.trim()) throw new Error('The MCP JSON is empty')

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('The MCP configuration is not valid JSON')
  }

  if (Array.isArray(parsed)) {
    if (parsed.some(hasMcpServerConfig)) return
    throw new Error('No MCP servers were found in this JSON')
  }

  if (hasMcpServerConfig(parsed)) return
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  const servers = record?.mcpServers ?? record?.servers ?? record?.mcp
  if (
    servers
    && typeof servers === 'object'
    && !Array.isArray(servers)
    && Object.values(servers).some(hasMcpServerConfig)
  ) return

  throw new Error('No MCP servers were found in this JSON')
}

export function beginMcpJsonImport(
  api: McpJsonImportApi,
  workspaceId: string,
  json: string,
  onAccepted: () => void,
): ReturnType<McpJsonImportApi['importMcpJson']> {
  validateMcpImportJsonInput(json)
  onAccepted()
  return api.importMcpJson(workspaceId, json)
}

export function openSkillFilePicker(
  input: Pick<HTMLInputElement, 'click' | 'value'>,
  guard: SkillFilePickerGuard,
): boolean {
  if (guard.current) return false

  guard.current = true
  input.value = ''
  try {
    input.click()
    return true
  } catch (error) {
    guard.current = false
    throw error
  }
}

export function releaseSkillFilePicker(guard: SkillFilePickerGuard): void {
  guard.current = false
}

export function listenForSkillFilePickerCancel(
  target: SkillFilePickerCancelTarget,
  onCancel: () => void,
): () => void {
  let active = true
  const handleCancel: EventListener = () => {
    if (!active) return
    active = false
    target.removeEventListener('cancel', handleCancel)
    onCancel()
  }
  target.addEventListener('cancel', handleCancel)

  return () => {
    if (!active) return
    active = false
    target.removeEventListener('cancel', handleCancel)
  }
}

function encodeSkillZip(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

export async function prepareSkillFileImport(
  api: SkillFileImportApi,
  workspaceId: string,
  file: File,
): Promise<PreparedSkillFileImport> {
  if (!isSupportedSkillImportFile(file)) {
    throw new Error('Only SKILL.md and skill Zip files can be imported')
  }

  const isZip = file.name.toLowerCase().endsWith('.zip')
  if (file.size > (isZip ? MAX_SKILL_ZIP_BYTES : MAX_SKILL_MARKDOWN_BYTES)) {
    throw new Error(isZip ? 'Skill zip exceeds the 20 MB limit' : 'SKILL.md exceeds the 2 MB limit')
  }

  const payload = isZip
    ? { kind: 'zip' as const, zipBase64: encodeSkillZip(new Uint8Array(await file.arrayBuffer())) }
    : { kind: 'markdown' as const, content: await file.text() }
  const preview = await api.previewSkillFileImport(workspaceId, payload)

  return { payload, preview }
}

export async function confirmSkillFileImport(
  api: SkillFileImportApi,
  workspaceId: string,
  prepared: PreparedSkillFileImport,
  decision: SkillImportDecision,
): Promise<SkillFileImportResult> {
  const result = await api.importSkillFile(workspaceId, prepared.payload, decision)

  return {
    status: result.skipped ? 'skipped' : 'imported',
    slug: result.slug,
  }
}
