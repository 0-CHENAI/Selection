import { existsSync, readdirSync } from 'fs'
import { normalize, isAbsolute } from 'path'
import { homedir, tmpdir } from 'os'
import { realpath } from 'fs/promises'
import { getWorkspaceByNameOrId, type Workspace } from '@craft-agent/shared/config'
import {
  getWorkspaceSessionsPath,
  getWorkspaceSourcesPath,
  loadWorkspaceConfig,
} from '@craft-agent/shared/workspaces'
import { getWorkspaceProjectsPath, loadProjectConfig } from '@craft-agent/shared/projects'
import { getSessionFilePath, readSessionHeader } from '@craft-agent/shared/sessions'
import { loadSourceConfig } from '@craft-agent/shared/sources'
import { expandPath, isPathInside, normalizePathForComparison, resolveFsPath } from '@craft-agent/shared/utils'
import type { PlatformServices } from '../runtime/platform'

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
export function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

export function buildBackendHostRuntimeContext(platform: PlatformServices) {
  return {
    appRootPath: platform.appRootPath,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
  }
}

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 * Removes dangerous characters and limits length.
 */
export function sanitizeFilename(name: string): string {
  return name
    // Remove path separators and traversal patterns
    .replace(/[/\\]/g, '_')
    // Remove Windows-forbidden characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, '_')
    // Remove control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse multiple dots (prevent hidden files and extension tricks)
    .replace(/\.{2,}/g, '.')
    // Remove leading/trailing dots and spaces (Windows issues)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    // Limit length (200 chars is safe for all filesystems)
    .slice(0, 200)
    // Fallback if name is empty after sanitization
    || 'unnamed'
}

export const FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE =
  'Access denied: file path is outside allowed directories. Open files from the workspace folder, the session working directory, or an authorized Local Folder. Add that folder as a Local Folder or switch the working directory, then retry.'

export const FILE_ACCESS_MISSING_WORKSPACE_MESSAGE =
  'Access denied: workspace context is missing. Reopen the workspace window and try again.'

export interface WorkspaceAllowlistSources {
  getWorkspace(workspaceId: string): { rootPath: string } | null | undefined
  getDefaultWorkingDirectory(rootPath: string): string | undefined
  getProjectWorkingDirectories(rootPath: string): string[]
  getLocalFolderPaths(rootPath: string): string[]
  getSessionWorkingDirectories(rootPath: string): string[]
}

function listSubdirNames(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/** Read-only: session working directories, without listSessions' tmp cleanup or plan scans. */
export function listSessionWorkingDirectories(workspaceRootPath: string): string[] {
  const dirs: string[] = []
  for (const sessionId of listSubdirNames(getWorkspaceSessionsPath(workspaceRootPath))) {
    const header = readSessionHeader(getSessionFilePath(workspaceRootPath, sessionId))
    const workingDirectory = header?.workingDirectory
    if (typeof workingDirectory === 'string' && workingDirectory.trim()) {
      dirs.push(expandPath(workingDirectory))
    }
  }
  return dirs
}

/** Read-only: project working directories, without creating a projects folder. */
export function listProjectWorkingDirectories(workspaceRootPath: string): string[] {
  const dirs: string[] = []
  for (const slug of listSubdirNames(getWorkspaceProjectsPath(workspaceRootPath))) {
    const workingDirectory = loadProjectConfig(workspaceRootPath, slug)?.workingDirectory
    if (workingDirectory) dirs.push(workingDirectory)
  }
  return dirs
}

/** Read-only: Local Folder source paths, without creating a sources folder. */
export function listLocalFolderPaths(workspaceRootPath: string): string[] {
  const dirs: string[] = []
  for (const slug of listSubdirNames(getWorkspaceSourcesPath(workspaceRootPath))) {
    const config = loadSourceConfig(workspaceRootPath, slug)
    if (config?.type === 'local' && config.local?.path) {
      dirs.push(config.local.path)
    }
  }
  return dirs
}

/**
 * Normalize markdown / file:// / Windows drive paths before allowlist checks.
 * Mirrors the renderer generated-file-path rules so OPEN_FILE sees the same path.
 */
export function normalizeAccessibleFilePath(filePath: string, platform = process.platform): string {
  let value = filePath.trim()
  if (!value) return value
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value)
    } catch {
      // Keep the raw path when encoding is invalid.
    }
  }
  if (/^file:/i.test(value)) {
    value = value.replace(/\\/g, '/')
    value = value.replace(/^file:\/\/+/i, '')
    value = value.replace(/^localhost\//i, '')
    if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1)
  }
  if (platform === 'win32') {
    value = value.replace(/^\/([A-Za-z])(?=[\\/])/, (_match, drive: string) => `${drive.toUpperCase()}:`)
  }
  return value.replace(/^\/([A-Za-z]:[\\/])/, '$1')
}

function collectAllowlistStrings(collect: () => string[] | string | undefined): string[] {
  try {
    const value = collect()
    if (typeof value === 'string') return value.trim() ? [value] : []
    return (value ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

const liveWorkspaceAllowlistSources: WorkspaceAllowlistSources = {
  getWorkspace: workspaceId => getWorkspaceByNameOrId(workspaceId),
  getDefaultWorkingDirectory: rootPath => loadWorkspaceConfig(rootPath)?.defaults?.workingDirectory,
  getProjectWorkingDirectories: listProjectWorkingDirectories,
  getLocalFolderPaths: listLocalFolderPaths,
  getSessionWorkingDirectories: listSessionWorkingDirectories,
}

function pushUniqueDir(dirs: string[], value?: string | null): void {
  if (!value) return
  const resolved = resolveFsPath(value)
  if (!resolved) return
  const key = normalizePathForComparison(resolved)
  if (dirs.some(dir => normalizePathForComparison(dir) === key)) return
  dirs.push(resolved)
}

/**
 * Resolve allowed directories for a workspace: root, configured working
 * directory, project folders, Local Folders, and session working directories.
 * Returns an empty array if the workspace is unknown.
 */
export function getWorkspaceAllowedDirs(
  workspaceId?: string | null,
  sources?: WorkspaceAllowlistSources,
): string[] {
  const allowlistSources = sources ?? liveWorkspaceAllowlistSources
  if (!workspaceId) return []
  let workspace: { rootPath: string } | null | undefined
  try {
    workspace = allowlistSources.getWorkspace(workspaceId)
  } catch {
    return []
  }
  if (!workspace) return []

  const dirs: string[] = []
  pushUniqueDir(dirs, workspace.rootPath)
  for (const dir of collectAllowlistStrings(() => allowlistSources.getDefaultWorkingDirectory(workspace.rootPath))) {
    pushUniqueDir(dirs, dir)
  }
  for (const dir of collectAllowlistStrings(() => allowlistSources.getProjectWorkingDirectories(workspace.rootPath))) {
    pushUniqueDir(dirs, dir)
  }
  for (const dir of collectAllowlistStrings(() => allowlistSources.getLocalFolderPaths(workspace.rootPath))) {
    pushUniqueDir(dirs, dir)
  }
  for (const dir of collectAllowlistStrings(() => allowlistSources.getSessionWorkingDirectories(workspace.rootPath))) {
    pushUniqueDir(dirs, dir)
  }
  return dirs
}

export function resolveWorkspaceIdForFileAccess(
  ctx: { workspaceId?: string | null; webContentsId?: number | null },
  windowManager?: { getWorkspaceForWindow(webContentsId: number): string | null } | null,
): string | null {
  if (typeof ctx.workspaceId === 'string' && ctx.workspaceId.length > 0) {
    return ctx.workspaceId
  }
  const webContentsId = ctx.webContentsId
  if (webContentsId != null) {
    return windowManager?.getWorkspaceForWindow(webContentsId) ?? null
  }
  return null
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory, /tmp, and any additional dirs passed by the caller
 * (e.g. workspace root, workspace working directory).
 */
export async function validateFilePath(
  filePath: string,
  additionalAllowedDirs?: string[],
): Promise<string> {
  // Normalize the path to resolve . and .. components
  let normalizedPath = normalize(normalizeAccessibleFilePath(filePath))

  // Expand ~ to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }

  // Must be an absolute path
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }

  // Resolve symlinks to get the real path
  let realFilePath: string
  try {
    realFilePath = await realpath(normalizedPath)
  } catch {
    // File doesn't exist or can't be resolved - use normalized path
    realFilePath = normalizedPath
  }

  // Define allowed base directories
  const allowedDirs = [
    homedir(),
    tmpdir(),
    ...(additionalAllowedDirs ?? []),
  ].filter(Boolean)

  // Unicode-safe containment (handles Chinese paths + NFC/NFD differences on macOS)
  const isAllowed = allowedDirs.some(dir => isPathInside(dir, realFilePath))

  if (!isAllowed) {
    throw new Error(FILE_ACCESS_OUTSIDE_ALLOWED_MESSAGE)
  }

  // Block sensitive files even within allowed directories.
  // Use [\\/] to match both Unix / and Windows \ separators.
  const sensitivePatterns = [
    /\.ssh[\\/]/,
    /\.gnupg[\\/]/,
    /\.aws[\\/]credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realFilePath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realFilePath
}

export async function validateWorkspaceFilePath(
  filePath: string,
  workspaceId?: string | null,
): Promise<string> {
  try {
    return await validateFilePath(filePath, getWorkspaceAllowedDirs(workspaceId))
  } catch (error) {
    if (
      !workspaceId
      && error instanceof Error
      && error.message.startsWith('Access denied: file path is outside allowed directories')
    ) {
      throw new Error(FILE_ACCESS_MISSING_WORKSPACE_MESSAGE)
    }
    throw error
  }
}
