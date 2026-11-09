import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { getOfficeBusinessRoot } from './office-catalog'

/**
 * Read-only previews of bundled Word / Excel case samples.
 *
 * The client names a catalog case, never a path. The host copies that case's sample into a
 * private temporary folder for one workspace + chat (or the empty home) and marks it read-only.
 * The Office preview panel may open exactly those copies, nothing else outside the workspace.
 */
export const OFFICE_CASE_PREVIEW_DIR = 'selection-office-cases'

export interface OfficeCasePreviewSample {
  caseId: string
  title: string
  revision: string
  /** Read-only temporary copy the preview panel opens. */
  path: string
  bytes: Buffer
}

export interface OfficeCasePreviewOptions {
  /** Defaults to the bundled office-business folder. */
  root?: string
  /** Defaults to the OS temp folder. */
  tempRoot?: string
}

function realTemp(tempRoot = tmpdir()): string {
  try { return realpathSync(tempRoot) } catch { return resolve(tempRoot) }
}

/** One folder per workspace + scope. Hashed so ids never become path segments. */
export function officeCasePreviewScopeDir(workspaceId: string, scopeId: string, tempRoot?: string): string {
  const key = createHash('sha256').update(`${workspaceId}\0${scopeId}`).digest('hex').slice(0, 32)
  return join(realTemp(tempRoot), OFFICE_CASE_PREVIEW_DIR, key)
}

interface SampleCase { id: string; title: string; revision: string; dir: string; sampleFile: string; sha256?: string }

/** Word / Excel cases that ship a sample file. Folder comes from `selection.assetDir` (the copy in this repo). */
export function officeCaseSamples(root: string): SampleCase[] {
  const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8')) as { cases?: unknown }
  if (!Array.isArray(catalog.cases)) throw new Error('Office 案例目录无效。')
  const out: SampleCase[] = []
  for (const raw of catalog.cases as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object' || (raw.mode !== 'word' && raw.mode !== 'excel')) continue
    const { id, title, revision, sampleFile } = raw
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || typeof title !== 'string'
      || typeof revision !== 'string' || !/^[A-Za-z0-9._-]+$/.test(revision)) continue
    if (typeof sampleFile !== 'string' || !/^[^/\\]+\.(docx|xlsx)$/i.test(sampleFile) || sampleFile.includes('..')) continue
    const selection = raw.selection && typeof raw.selection === 'object' ? raw.selection as Record<string, unknown> : {}
    const dir = typeof selection.assetDir === 'string' ? selection.assetDir : `cases/${id}`
    if (dir.includes('..') || /^[/\\]/.test(dir) || /^[A-Za-z]:/.test(dir)) continue
    const sha256 = typeof selection.exampleSha256 === 'string' && /^[0-9a-f]{64}$/.test(selection.exampleSha256) ? selection.exampleSha256 : undefined
    out.push({ id, title, revision, dir, sampleFile, ...(sha256 ? { sha256 } : {}) })
  }
  return out
}

/** Named after the case so the panel header reads 「中国现制咖啡市场调研报告.docx」, not example.docx. */
function sampleName(item: SampleCase): string {
  const ext = item.sampleFile.slice(item.sampleFile.lastIndexOf('.')).toLowerCase()
  const title = item.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80)
  return `${title || item.id}${ext}`
}

function samplePath(scopeDir: string, item: SampleCase): string {
  return join(scopeDir, `${item.id}-${item.revision}`, sampleName(item))
}

function sourcePath(root: string, item: SampleCase): string {
  const file = resolve(root, item.dir, item.sampleFile)
  const inside = relative(root, file)
  if (!inside || inside.startsWith('..') || inside.split(sep).includes('..')) throw new Error('Office 案例样例路径无效。')
  return file
}

async function materialize(root: string, scopeDir: string, item: SampleCase): Promise<OfficeCasePreviewSample> {
  const bytes = await readFile(sourcePath(root, item))
  if (item.sha256 && createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Office 案例样例校验失败。')
  const path = samplePath(scopeDir, item)
  const existing = await readFile(path).catch(() => undefined)
  if (!existing || !existing.equals(bytes)) {
    await mkdir(join(scopeDir, `${item.id}-${item.revision}`), { recursive: true, mode: 0o700 })
    // A stale or tampered copy is replaced from the bundled sample.
    await chmod(path, 0o600).catch(() => {})
    await writeFile(path, bytes, { mode: 0o600 })
  }
  await chmod(path, 0o444)
  return { caseId: item.id, title: item.title, revision: item.revision, path, bytes }
}

/** Copy the named case's sample into the scope's read-only folder and return it. */
export async function prepareOfficeCasePreview(workspaceId: string, scopeId: string, caseId: string, options: OfficeCasePreviewOptions = {}): Promise<OfficeCasePreviewSample> {
  if (typeof caseId !== 'string' || !/^[a-z0-9-]+$/.test(caseId)) throw new Error('Office 案例不存在。')
  const root = options.root ?? getOfficeBusinessRoot()
  const item = officeCaseSamples(root).find(entry => entry.id === caseId)
  if (!item) throw new Error('Office 案例不存在或没有样例文件。')
  return materialize(root, officeCasePreviewScopeDir(workspaceId, scopeId, options.tempRoot), item)
}

/**
 * The sample a path names when it is this scope's case copy. `undefined` for any other path,
 * so the normal workspace checks still apply to everything else.
 */
export async function matchOfficeCasePreview(workspaceId: string, scopeId: string, path: string, options: OfficeCasePreviewOptions = {}): Promise<OfficeCasePreviewSample | undefined> {
  if (typeof path !== 'string' || !path) return undefined
  const scopeDir = officeCasePreviewScopeDir(workspaceId, scopeId, options.tempRoot)
  const wanted = resolve(path)
  if (!wanted.startsWith(scopeDir + sep)) return undefined
  const root = options.root ?? getOfficeBusinessRoot()
  const item = officeCaseSamples(root).find(entry => samplePath(scopeDir, entry) === wanted)
  return item ? materialize(root, scopeDir, item) : undefined
}

/** True for any path inside the case-preview temp area, for any scope. */
export function isOfficeCasePreviewPath(path: string, tempRoot?: string): boolean {
  return typeof path === 'string' && resolve(path).startsWith(join(realTemp(tempRoot), OFFICE_CASE_PREVIEW_DIR) + sep)
}

/** Remove a scope's copies when its chat closes. */
export async function removeOfficeCasePreviews(workspaceId: string, scopeId: string, tempRoot?: string): Promise<void> {
  const dir = officeCasePreviewScopeDir(workspaceId, scopeId, tempRoot)
  await chmodTree(dir)
  await rm(dir, { recursive: true, force: true })
}

async function chmodTree(dir: string) {
  // Read-only files are fine to unlink on POSIX, but Windows needs the bit cleared first.
  if (process.platform !== 'win32') return
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await chmodTree(full)
    else await chmod(full, 0o600).catch(() => {})
  }
}
