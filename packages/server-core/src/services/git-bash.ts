import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { stat } from 'fs/promises'
import { clearGitBashPath, getGitBashPath } from '@craft-agent/shared/config'

/**
 * Basic file-name validation for Git Bash executable paths.
 * Accepts Windows-style and POSIX-style separators to support cross-platform tests.
 */
export function isGitBashExecutablePath(filePath: string): boolean {
  return /(?:^|[\\/])bash\.exe$/i.test(filePath.trim())
}

/**
 * Validate a user-provided Git Bash executable path.
 * Enforces bash.exe filename and existence on disk.
 */
export async function validateGitBashPath(filePath: string): Promise<{ valid: true; path: string } | { valid: false; error: string }> {
  const trimmedPath = filePath.trim()

  if (!isGitBashExecutablePath(trimmedPath)) {
    return { valid: false, error: 'Path must point to bash.exe' }
  }

  try {
    const info = await stat(trimmedPath)
    if (!info.isFile()) {
      return { valid: false, error: 'Path must point to a file' }
    }
    return { valid: true, path: trimmedPath }
  } catch {
    return { valid: false, error: 'File does not exist at the specified path' }
  }
}

/**
 * Check if a Git Bash path is usable without returning UI-facing errors.
 */
export async function isUsableGitBashPath(filePath: string): Promise<boolean> {
  const result = await validateGitBashPath(filePath)
  return result.valid
}

export function windowsGitBashSearchPaths(bundledPath?: string | null): string[] {
  return [
    bundledPath?.trim() || '',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean)
}

/**
 * Locate Git Bash for the Windows agent shell.
 * Bundled Portable/Git-for-Windows bash wins so machines without a system Git still work.
 * A persisted custom path is used when the user prefers system Git, or when no bundle is present.
 */
export async function detectGitBash(): Promise<{
  found: boolean
  path: string | null
  platform: 'win32' | 'darwin' | 'linux'
}> {
  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  if (platform !== 'win32') {
    return { found: true, path: null, platform }
  }

  const bundled = process.env.CRAFT_GIT_BASH?.trim() || null
  const persisted = getGitBashPath()?.trim() || null
  const preferSystem = process.env.CRAFT_PREFER_SYSTEM_GIT === '1'

  const tryPath = async (filePath: string | null): Promise<string | null> => {
    if (!filePath) return null
    if (await isUsableGitBashPath(filePath)) return filePath
    return null
  }

  const ordered = preferSystem
    ? [persisted, bundled, ...windowsGitBashSearchPaths()]
    : [bundled, persisted, ...windowsGitBashSearchPaths()]

  const seen = new Set<string>()
  for (const candidate of ordered) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    const usable = await tryPath(candidate)
    if (usable) {
      process.env.CLAUDE_CODE_GIT_BASH_PATH = usable
      return { found: true, path: usable, platform }
    }
  }

  if (persisted) clearGitBashPath()

  try {
    const result = execSync('where bash', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
    const firstPath = result.split(/\r?\n/)[0]?.trim()
    if (firstPath && firstPath.toLowerCase().includes('git') && await isUsableGitBashPath(firstPath)) {
      process.env.CLAUDE_CODE_GIT_BASH_PATH = firstPath
      return { found: true, path: firstPath, platform }
    }
  } catch {
    // where command failed
  }

  delete process.env.CLAUDE_CODE_GIT_BASH_PATH
  return { found: false, path: null, platform }
}
