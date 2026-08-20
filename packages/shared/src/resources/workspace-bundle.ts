/**
 * Workspace Bundle — Whole-Workspace Export/Import
 *
 * Portable representation of an entire workspace directory:
 * - config.json (sanitized; new id/timestamps assigned on import)
 * - sources / skills / automations (via the ResourceBundle machinery —
 *   credentials and runtime auth state are stripped there)
 * - statuses/ and labels/ (config + icons)
 * - loose top-level files (theme.json, views.json, ...)
 * - sessions/ (optional, as raw file trees)
 *
 * Runtime state is never exported: events.jsonl, automations history and
 * retry queue stay behind (mirrors how automation import clears them).
 *
 * Import always creates a NEW workspace folder (unique slug suffix if the
 * name collides) — it never merges into an existing workspace.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import {
  type BundleFile,
  MAX_BUNDLE_SIZE_BYTES,
  collectDirectoryFiles,
  restoreFiles,
  validateBundleFile,
} from '../utils/bundle-files.ts'
import { resolveFsPath } from '../utils/paths.ts'
import {
  generateUniqueWorkspacePath,
  getWorkspaceSessionsPath,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from '../workspaces/storage.ts'
import {
  AUTOMATIONS_CONFIG_FILE,
  AUTOMATIONS_HISTORY_FILE,
  AUTOMATIONS_RETRY_QUEUE_FILE,
} from '../automations/constants.ts'
import { exportResources, importResources, validateResourceBundle } from './resource-bundle.ts'
import { isSafeResourceSlug } from './copy-between-workspaces.ts'

import type { WorkspaceConfig } from '../workspaces/types.ts'
import type {
  ImportBucketResult,
  ResourceBundle,
  ResourceImportDeps,
  ResourceImportResult,
} from './types.ts'

// ============================================================
// Types
// ============================================================

/** Discriminator so importers can reject session/resource bundles early */
export const WORKSPACE_BUNDLE_KIND = 'selection-workspace-bundle'

/**
 * A session exported as a raw file tree.
 * File-level (not SessionBundle) so import is a plain restore with no
 * SDK re-registration; session.jsonl travels as a regular file.
 */
export interface WorkspaceSessionEntry {
  /** Session directory name (session ID) */
  id: string
  /** All files in the session directory, including session.jsonl */
  files: BundleFile[]
}

export interface WorkspaceBundle {
  /** Bundle format version */
  version: 1
  /** Discriminator */
  kind: typeof WORKSPACE_BUNDLE_KIND
  /** When the bundle was created (Unix timestamp ms) */
  exportedAt: number
  /**
   * Workspace config without identity/timestamps.
   * Import assigns a fresh id, slug and createdAt/updatedAt.
   */
  config: Omit<WorkspaceConfig, 'id' | 'createdAt' | 'updatedAt'>
  /** Sources, skills, automations — same shape and sanitization as ResourceBundle */
  resources: ResourceBundle['resources']
  /** statuses/ directory (status config + icons); empty when absent */
  statuses: BundleFile[]
  /** labels/ directory (label config); empty when absent */
  labels: BundleFile[]
  /** Loose top-level files (theme.json, views.json, ...) — runtime logs excluded */
  files: BundleFile[]
  /** Sessions as raw file trees; present only when exported with includeSessions */
  sessions?: WorkspaceSessionEntry[]
}

export interface ExportWorkspaceOptions {
  /** Include the sessions/ directory (can be large). Default: false */
  includeSessions?: boolean
}

export interface ImportWorkspaceOptions {
  /** Override the workspace display name (folder still gets a unique suffix on collision) */
  name?: string
}

export interface WorkspaceImportResult {
  /** Absolute path of the newly created workspace folder */
  workspacePath: string
  /** Freshly assigned workspace id */
  workspaceId: string
  /** Per-resource-type import outcome */
  resources: ResourceImportResult
  /** Per-session restore outcome */
  sessions: ImportBucketResult
  warnings: string[]
}

// ============================================================
// Export
// ============================================================

/**
 * Top-level files that must NOT travel in a workspace bundle:
 * config/automations travel as structured data; logs and retry queues are runtime state.
 */
const SKIP_TOP_LEVEL_FILES = new Set([
  'config.json',
  AUTOMATIONS_CONFIG_FILE,
  AUTOMATIONS_HISTORY_FILE,
  AUTOMATIONS_RETRY_QUEUE_FILE,
  'events.jsonl',
])

/** Session subdirectories that are regenerable and skipped on export */
const SKIP_SESSION_DIRS = new Set(['tmp'])

/**
 * Export an entire workspace to a portable WorkspaceBundle.
 *
 * @param workspaceRootPath - Absolute path to the workspace root
 * @param options - Set includeSessions to also pack the sessions/ directory
 * @throws Error if the path is not a valid workspace (no readable config.json)
 */
export function exportWorkspace(
  workspaceRootPath: string,
  options: ExportWorkspaceOptions = {},
): { bundle: WorkspaceBundle; warnings: string[] } {
  workspaceRootPath = resolveFsPath(workspaceRootPath)

  const config = loadWorkspaceConfig(workspaceRootPath)
  if (!config) {
    throw new Error(`Not a valid workspace (no readable config.json): ${workspaceRootPath}`)
  }

  const warnings: string[] = []

  // Sources / skills / automations via the existing machinery (sanitization included)
  const resourceResult = exportResources(workspaceRootPath, {
    sources: 'all',
    skills: 'all',
    automations: 'all',
  })
  warnings.push(...resourceResult.warnings)

  // statuses/ and labels/ as plain file trees
  const statuses = collectOptionalDir(join(workspaceRootPath, 'statuses'))
  const labels = collectOptionalDir(join(workspaceRootPath, 'labels'))

  // Loose top-level files (theme.json, views.json, ...), excluding structured/runtime files
  const files = collectTopLevelFiles(workspaceRootPath)

  // Sessions (opt-in — potentially large)
  let sessions: WorkspaceSessionEntry[] | undefined
  if (options.includeSessions) {
    sessions = collectSessions(workspaceRootPath, warnings)
  }

  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...portableConfig } = config

  // Strip machine-local settings that are meaningless or harmful on another host:
  // - workingDirectory was expanded to an absolute path on export (leaks the
  //   exporter's home layout; points nowhere on the target machine)
  // - defaultLlmConnection references a connection that only exists locally
  if (portableConfig.defaults) {
    if (portableConfig.defaults.workingDirectory !== undefined) {
      delete portableConfig.defaults.workingDirectory
      warnings.push('Stripped defaults.workingDirectory (machine-local path)')
    }
    if (portableConfig.defaults.defaultLlmConnection !== undefined) {
      delete portableConfig.defaults.defaultLlmConnection
      warnings.push('Stripped defaults.defaultLlmConnection (machine-local reference)')
    }
  }

  const bundle: WorkspaceBundle = {
    version: 1,
    kind: WORKSPACE_BUNDLE_KIND,
    exportedAt: Date.now(),
    config: portableConfig,
    resources: resourceResult.bundle.resources,
    statuses,
    labels,
    files,
    sessions,
  }

  // Hard limit: an oversized bundle would be rejected by our own importer,
  // so exporting it anyway would produce a file nobody can use.
  const bundleSize = Buffer.byteLength(JSON.stringify(bundle))
  if (bundleSize > MAX_BUNDLE_SIZE_BYTES) {
    throw new Error(
      `Workspace bundle exceeds the ${MAX_BUNDLE_SIZE_BYTES / 1024 / 1024}MB size limit ` +
      `(actual: ${Math.ceil(bundleSize / 1024 / 1024)}MB). Try exporting without sessions.`,
    )
  }

  return { bundle, warnings }
}

function collectOptionalDir(dir: string): BundleFile[] {
  return existsSync(dir) ? collectDirectoryFiles(dir) : []
}

function collectTopLevelFiles(workspaceRootPath: string): BundleFile[] {
  const files: BundleFile[] = []
  for (const entry of readdirSync(workspaceRootPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue
    if (SKIP_TOP_LEVEL_FILES.has(entry.name)) continue
    try {
      const content = readFileSync(join(workspaceRootPath, entry.name))
      files.push({
        relativePath: entry.name,
        contentBase64: content.toString('base64'),
        size: content.byteLength,
      })
    } catch {
      // Skip unreadable files rather than failing the export
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return files
}

function collectSessions(workspaceRootPath: string, warnings: string[]): WorkspaceSessionEntry[] {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath)
  if (!existsSync(sessionsDir)) return []

  const entries: WorkspaceSessionEntry[] = []
  for (const dir of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue
    const sessionDir = join(sessionsDir, dir.name)
    const files = collectDirectoryFiles(sessionDir, { skipDirs: SKIP_SESSION_DIRS })
    if (!files.some(f => f.relativePath === 'session.jsonl')) {
      warnings.push(`Session '${dir.name}' has no session.jsonl, skipping`)
      continue
    }
    entries.push({ id: dir.name, files })
  }
  return entries
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate a WorkspaceBundle structure.
 * Returns { valid, errors } so callers get diagnostics.
 */
export function validateWorkspaceBundle(bundle: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: ['Bundle is not an object'] }
  }

  const b = bundle as Record<string, unknown>

  if (b.kind !== WORKSPACE_BUNDLE_KIND) {
    errors.push(`Not a workspace bundle (kind: ${String(b.kind)})`)
  }
  if (b.version !== 1) {
    errors.push(`Unsupported bundle version: ${String(b.version)}`)
  }
  if (typeof b.exportedAt !== 'number') {
    errors.push('Missing or invalid exportedAt')
  }

  if (!b.config || typeof b.config !== 'object') {
    errors.push('Missing or invalid config')
  } else {
    const cfg = b.config as Record<string, unknown>
    if (typeof cfg.name !== 'string') {
      errors.push('config.name must be a string')
    }
    errors.push(...validatePortableDefaults(cfg.defaults))
  }

  if (!b.resources || typeof b.resources !== 'object') {
    errors.push('Missing or invalid resources')
  } else {
    // Delegate to the resource bundle validator
    const resourceValidation = validateResourceBundle({
      version: 1,
      exportedAt: b.exportedAt,
      resources: b.resources,
    })
    errors.push(...resourceValidation.errors)
  }

  for (const field of ['statuses', 'labels', 'files'] as const) {
    const value = b[field]
    if (value === undefined) {
      errors.push(`Missing ${field} array`)
      continue
    }
    if (!Array.isArray(value)) {
      errors.push(`${field} must be an array`)
      continue
    }
    validateFiles(value as BundleFile[], field, errors)
  }

  // Top-level `files` must stay top-level: a nested path would let a bundle
  // overwrite the sanitized config.json or inject sources/automations that
  // bypass validation and sanitization.
  if (Array.isArray(b.files)) {
    for (const file of b.files as BundleFile[]) {
      if (!file || typeof file.relativePath !== 'string') continue
      if (file.relativePath.includes('/')) {
        errors.push(`files: only top-level files allowed, got '${file.relativePath}'`)
      } else if (SKIP_TOP_LEVEL_FILES.has(file.relativePath)) {
        errors.push(`files: '${file.relativePath}' is a reserved name and cannot be imported this way`)
      }
    }
  }

  if (b.sessions !== undefined) {
    if (!Array.isArray(b.sessions)) {
      errors.push('sessions must be an array')
    } else {
      const ids = new Set<string>()
      for (let i = 0; i < b.sessions.length; i++) {
        const prefix = `sessions[${i}]`
        const entry = b.sessions[i]
        if (!entry || typeof entry !== 'object') {
          errors.push(`${prefix}: not an object`)
          continue
        }
        const e = entry as Record<string, unknown>
        if (typeof e.id !== 'string' || !e.id || !isSafeResourceSlug(e.id)) {
          errors.push(`${prefix}: missing or unsafe id`)
          continue
        }
        if (ids.has(e.id as string)) {
          errors.push(`${prefix}: duplicate id '${String(e.id)}'`)
        }
        ids.add(e.id as string)
        if (!Array.isArray(e.files)) {
          errors.push(`${prefix}: files must be an array`)
        } else if (!(e.files as BundleFile[]).some(f => f?.relativePath === 'session.jsonl')) {
          errors.push(`${prefix}: missing session.jsonl`)
        } else {
          validateFiles(e.files as BundleFile[], prefix, errors)
        }
      }
    }
  }

  try {
    const size = Buffer.byteLength(JSON.stringify(bundle))
    if (size > MAX_BUNDLE_SIZE_BYTES) {
      errors.push(`Bundle size ${size} exceeds max ${MAX_BUNDLE_SIZE_BYTES}`)
    }
  } catch {
    errors.push('Bundle is not serializable')
  }

  return { valid: errors.length === 0, errors }
}

function validateFiles(files: BundleFile[], prefix: string, errors: string[]): void {
  const paths = new Set<string>()
  for (let j = 0; j < files.length; j++) {
    const file = files[j]
    if (!file || typeof file !== 'object') {
      errors.push(`${prefix}[${j}]: not an object`)
      continue
    }
    if (paths.has(file.relativePath)) {
      errors.push(`${prefix}[${j}]: duplicate path '${file.relativePath}'`)
    }
    paths.add(file.relativePath)
    const fileError = validateBundleFile(file)
    if (fileError) {
      errors.push(`${prefix}[${j}]: ${fileError}`)
    }
  }
}

/** Shallow type checks for the portable workspace defaults (catches malformed bundles early) */
function validatePortableDefaults(defaults: unknown): string[] {
  if (defaults === undefined) return []
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return ['config.defaults must be an object']
  }
  const errors: string[] = []
  const d = defaults as Record<string, unknown>
  for (const key of ['model', 'workingDirectory', 'defaultLlmConnection', 'colorTheme'] as const) {
    if (d[key] !== undefined && typeof d[key] !== 'string') {
      errors.push(`config.defaults.${key} must be a string`)
    }
  }
  if (d.permissionMode !== undefined && !['safe', 'ask', 'allow-all'].includes(d.permissionMode as string)) {
    errors.push(`config.defaults.permissionMode must be one of safe/ask/allow-all`)
  }
  if (d.enabledSourceSlugs !== undefined) {
    if (!Array.isArray(d.enabledSourceSlugs) || d.enabledSourceSlugs.some(s => typeof s !== 'string')) {
      errors.push('config.defaults.enabledSourceSlugs must be a string array')
    }
  }
  return errors
}

// ============================================================
// Import
// ============================================================

const noopDeps: ResourceImportDeps = {
  clearSourceCredentials: async () => {},
}

/**
 * Import a WorkspaceBundle as a NEW workspace under a parent directory.
 *
 * Never merges into an existing workspace: the folder gets a unique name
 * (numeric suffix on collision) and the config a fresh id + timestamps.
 *
 * @param targetParentDir - Directory under which the workspace folder is created
 * @param bundle - The validated WorkspaceBundle
 * @param options - Optional name override
 * @param deps - Credential cleanup hooks (no-op for a fresh workspace, injectable for tests)
 * @throws Error if the bundle is invalid
 */
export async function importWorkspace(
  targetParentDir: string,
  bundle: WorkspaceBundle,
  options: ImportWorkspaceOptions = {},
  deps: ResourceImportDeps = noopDeps,
): Promise<WorkspaceImportResult> {
  targetParentDir = resolveFsPath(targetParentDir)

  const validation = validateWorkspaceBundle(bundle)
  if (!validation.valid) {
    throw new Error(`Invalid workspace bundle: ${validation.errors.join('; ')}`)
  }

  const warnings: string[] = []
  const name = options.name ?? bundle.config.name
  const workspacePath = generateUniqueWorkspacePath(name, targetParentDir)
  const workspaceId = `ws_${randomUUID().slice(0, 8)}`
  const now = Date.now()

  mkdirSync(workspacePath, { recursive: true })

  try {
    // config.json — fresh identity, slug follows the actual folder name
    const config: WorkspaceConfig = {
      ...bundle.config,
      id: workspaceId,
      name,
      slug: basename(workspacePath),
      createdAt: now,
      updatedAt: now,
    }
    saveWorkspaceConfig(workspacePath, config)

    // statuses/ and labels/
    if (bundle.statuses.length > 0) {
      restoreFiles(join(workspacePath, 'statuses'), bundle.statuses)
    }
    if (bundle.labels.length > 0) {
      restoreFiles(join(workspacePath, 'labels'), bundle.labels)
    }

    // Loose top-level files (theme.json, views.json, ...)
    if (bundle.files.length > 0) {
      restoreFiles(workspacePath, bundle.files)
    }

    // Sources / skills / automations (fresh workspace → overwrite mode, no conflicts)
    const resources = await importResources(
      workspacePath,
      { version: 1, exportedAt: bundle.exportedAt, resources: bundle.resources },
      'overwrite',
      deps,
    )

    // Sessions as raw file trees
    const sessions = restoreSessions(workspacePath, bundle.sessions ?? [], warnings)

    return { workspacePath, workspaceId, resources, sessions, warnings }
  } catch (err) {
    // Roll back: a partially imported folder with a config.json would be
    // auto-discovered as a valid workspace on next launch.
    rmSync(workspacePath, { recursive: true, force: true })
    throw err
  }
}

function restoreSessions(
  workspacePath: string,
  entries: WorkspaceSessionEntry[],
  warnings: string[],
): ImportBucketResult {
  const result: ImportBucketResult = { imported: [], skipped: [], failed: [], warnings: [] }
  if (entries.length === 0) return result

  const sessionsDir = getWorkspaceSessionsPath(workspacePath)
  mkdirSync(sessionsDir, { recursive: true })

  for (const entry of entries) {
    try {
      if (!isSafeResourceSlug(entry.id)) {
        result.failed.push({ id: entry.id, error: 'Unsafe session id' })
        continue
      }
      const targetDir = join(sessionsDir, entry.id)
      restoreFiles(targetDir, entry.files)
      rewriteSessionWorkspacePath(targetDir, workspacePath, warnings, entry.id)
      result.imported.push(entry.id)
    } catch (err) {
      result.failed.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return result
}

/**
 * Best-effort rewrite of workspaceRootPath in the session.jsonl header so the
 * restored session points at the new workspace instead of the old machine's path.
 */
function rewriteSessionWorkspacePath(
  sessionDir: string,
  workspacePath: string,
  warnings: string[],
  sessionId: string,
): void {
  const sessionFile = join(sessionDir, 'session.jsonl')
  try {
    const raw = readFileSync(sessionFile, 'utf-8')
    const newlineIndex = raw.indexOf('\n')
    // A session created and immediately exported can consist of only the header line
    const firstLine = newlineIndex === -1 ? raw : raw.slice(0, newlineIndex)
    const rest = newlineIndex === -1 ? '\n' : raw.slice(newlineIndex)
    const header = JSON.parse(firstLine) as Record<string, unknown>
    if (typeof header.workspaceRootPath !== 'string') return
    header.workspaceRootPath = workspacePath
    writeFileSync(sessionFile, JSON.stringify(header) + rest, 'utf-8')
  } catch (err) {
    warnings.push(`Session '${sessionId}': could not rewrite workspaceRootPath (${err})`)
  }
}

// ============================================================
// File-based read (for IPC handlers: path comes from a user-picked dialog)
// ============================================================

/**
 * Read, size-check, parse and validate a workspace bundle from disk.
 * Throws with a descriptive message on any failure.
 */
export function readWorkspaceBundleFile(path: string): WorkspaceBundle {
  const size = statSync(path).size
  if (size > MAX_BUNDLE_SIZE_BYTES) {
    throw new Error(
      `Bundle file exceeds the ${MAX_BUNDLE_SIZE_BYTES / 1024 / 1024}MB size limit ` +
      `(actual: ${Math.ceil(size / 1024 / 1024)}MB)`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw new Error(`Bundle file is not valid JSON: ${err instanceof Error ? err.message : err}`)
  }

  const validation = validateWorkspaceBundle(parsed)
  if (!validation.valid) {
    throw new Error(`Invalid workspace bundle: ${validation.errors.join('; ')}`)
  }
  return parsed as WorkspaceBundle
}

/** Lightweight summary for confirmation dialogs (counts only, no payload) */
export function summarizeWorkspaceBundle(bundle: WorkspaceBundle): {
  name: string
  exportedAt: number
  counts: { sources: number; skills: number; automations: number; sessions: number }
} {
  return {
    name: bundle.config.name,
    exportedAt: bundle.exportedAt,
    counts: {
      sources: bundle.resources.sources?.length ?? 0,
      skills: bundle.resources.skills?.length ?? 0,
      automations: bundle.resources.automations?.length ?? 0,
      sessions: bundle.sessions?.length ?? 0,
    },
  }
}
