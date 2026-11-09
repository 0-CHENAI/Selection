/**
 * Robust staged directory replace for Windows + non-ASCII (Chinese) paths.
 *
 * Electron on Windows has flaky `fs.cpSync` / `renameSync` when the path
 * contains Chinese segments (e.g. D:\selection\巡察工作\skills\...):
 * - cpSync may return without creating the destination under CJK parents
 * - renameSync often fails with ENOENT/EPERM under antivirus locks
 * - staging next to a Chinese parent can fail existence checks
 *
 * Strategy:
 * 1. Stage under OS temp (ASCII path, always writable)
 * 2. Manual readdir + copyFileSync (never fs.cpSync for skill/source trees)
 * 3. Finalize into destination with rename, or second manual copy if rename fails
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
  renameSync,
  statSync,
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  type Dirent,
} from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { resolveFsPath } from './paths.ts'

/** ASCII-only segment for temp folder names (avoids Windows-invalid chars / length). */
export function safeTempNameSegment(slug: string): string {
  const ascii = slug.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 32)
  return ascii.replace(/^_+|_+$/g, '') || 'res'
}

/**
 * Prefix absolute Windows paths with \\?\ so paths with Chinese segments
 * are not subject to the legacy 260-char MAX_PATH limit.
 */
export function winLongPath(p: string): string {
  if (process.platform !== 'win32') return p
  if (!p || p.startsWith('\\\\?\\')) return p
  const normalized = p.replace(/\//g, '\\')
  if (normalized.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${normalized.slice(2)}`
  }
  if (/^[A-Za-z]:\\/.test(normalized)) {
    return `\\\\?\\${normalized}`
  }
  return p
}

/** On Windows, prefer long-path form for fs ops involving CJK parents. */
function fsPath(p: string): string {
  return process.platform === 'win32' ? winLongPath(p) : p
}

function pathExists(p: string): boolean {
  try {
    return existsSync(fsPath(p)) || existsSync(p)
  } catch {
    return false
  }
}

function removeDir(p: string): void {
  if (!pathExists(p)) return
  try {
    rmSync(fsPath(p), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as fsRmOptions)
  } catch {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

/** Node 20+ supports maxRetries on rm; keep type loose for older typings */
type fsRmOptions = {
  recursive?: boolean
  force?: boolean
  maxRetries?: number
  retryDelay?: number
}

function errMessage(err: unknown): string {
  if (!err) return ''
  if (err instanceof Error) return err.message
  return String(err)
}

function ensureDir(p: string): void {
  const candidates = process.platform === 'win32' ? [fsPath(p), p] : [p]
  let lastErr: unknown
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true })
      if (pathExists(p)) return
    } catch (err) {
      lastErr = err
    }
  }
  if (!pathExists(p)) {
    throw new Error(`mkdir failed: ${p}${lastErr ? ` (${errMessage(lastErr)})` : ''}`)
  }
}

/**
 * Binary-safe file copy. Prefer copyFileSync; fall back to read+write
 * which is more reliable with some Windows/CJK path edge cases.
 */
function copyFileRobust(from: string, to: string): void {
  ensureDir(dirname(to))
  const fromCandidates = process.platform === 'win32' ? [fsPath(from), from] : [from]
  const toCandidates = process.platform === 'win32' ? [fsPath(to), to] : [to]

  let lastErr: unknown
  for (const src of fromCandidates) {
    for (const dest of toCandidates) {
      try {
        copyFileSync(src, dest)
        return
      } catch (err) {
        lastErr = err
      }
    }
  }

  // Last resort: buffer read/write
  try {
    const data = readFileSync(fromCandidates[0]!)
    ensureDir(dirname(to))
    const fd = openSync(toCandidates[0]!, 'w')
    try {
      writeSync(fd, data)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    throw new Error(
      `copyFile failed ${from} → ${to}: ${errMessage(err)}; prior: ${errMessage(lastErr)}`,
    )
  }
}

/**
 * Recursively copy a directory tree using readdir + copyFile.
 * Avoids fs.cpSync quirks with Chinese paths on Windows/Electron.
 */
export function copyDirRecursive(src: string, dest: string): void {
  if (!pathExists(src)) {
    throw new Error(`copyDirRecursive: source missing: ${src}`)
  }

  const st = statSync(pathExists(fsPath(src)) ? fsPath(src) : src)
  if (!st.isDirectory()) {
    copyFileRobust(src, dest)
    return
  }

  ensureDir(dest)

  let entries: Dirent[]
  try {
    const readPath = pathExists(fsPath(src)) ? fsPath(src) : src
    entries = readdirSync(readPath, { withFileTypes: true })
  } catch (err) {
    throw new Error(`copyDirRecursive: cannot read ${src}: ${errMessage(err)}`)
  }

  for (const entry of entries) {
    // Skip staging leftovers if re-copying partially
    if (entry.name.startsWith('.tmp-copy-') || entry.name.startsWith('.tmp-') || entry.name.startsWith('.selection-stage-')) {
      continue
    }
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    try {
      if (entry.isDirectory()) {
        copyDirRecursive(from, to)
      } else if (entry.isFile()) {
        copyFileRobust(from, to)
      } else if (entry.isSymbolicLink()) {
        // Skip symlinks — skill/source trees should be real files
        continue
      }
    } catch (err) {
      throw new Error(`copyDirRecursive: failed ${from} → ${to}: ${errMessage(err)}`)
    }
  }

  if (!pathExists(dest)) {
    throw new Error(`copyDirRecursive: destination missing after copy: ${dest}`)
  }
}

/**
 * Copy a directory tree into place via staging under OS temp (ASCII path).
 * Never stages under a Chinese parent — that was the root of the Windows failure.
 *
 * @param fromPath - Existing source directory
 * @param toPath - Final destination directory (will be replaced if present)
 */
export function stagedDirectoryReplace(fromPath: string, toPath: string): void {
  const from = resolveFsPath(fromPath)
  const to = resolveFsPath(toPath)
  const parentDir = dirname(to)

  if (!pathExists(from)) {
    throw new Error(`Source directory does not exist: ${fromPath}`)
  }
  const fromStatPath = pathExists(fsPath(from)) ? fsPath(from) : from
  if (!statSync(fromStatPath).isDirectory()) {
    throw new Error(`Source is not a directory: ${fromPath}`)
  }

  // Stage under system temp — pure ASCII on Windows (e.g. C:\Users\...\AppData\Local\Temp)
  const stageRoot = join(tmpdir(), `selection-stage-${randomUUID().replace(/-/g, '').slice(0, 12)}`)
  const tmpDir = join(stageRoot, 'content')

  try {
    ensureDir(tmpDir)
    copyDirRecursive(from, tmpDir)

    if (!pathExists(tmpDir)) {
      throw new Error(`Staging copy failed (temp dir missing): ${tmpDir} ← ${from}`)
    }
    const staged = readdirSync(pathExists(fsPath(tmpDir)) ? fsPath(tmpDir) : tmpDir)
    if (staged.length === 0) {
      throw new Error(`Staging copy failed (temp dir empty): ${tmpDir} ← ${from}`)
    }

    ensureDir(parentDir)
    removeDir(to)

    let lastRenameError = ''
    let placed = false

    // rename only works same-volume; D:\ workspace vs C:\ Temp often fails with EXDEV
    try {
      renameSync(fsPath(tmpDir), fsPath(to))
      placed = pathExists(to)
    } catch (renameErr) {
      lastRenameError = errMessage(renameErr)
      try {
        renameSync(tmpDir, to)
        placed = pathExists(to)
      } catch (renameErr2) {
        lastRenameError = `${lastRenameError}; ${errMessage(renameErr2)}`
      }
    }

    if (!placed) {
      // Cross-volume or CJK rename: manual copy into final path
      removeDir(to)
      copyDirRecursive(tmpDir, to)
    }

    if (!pathExists(to)) {
      throw new Error(
        `Copy finished but target is missing: ${toPath}` +
          (lastRenameError ? ` (rename: ${lastRenameError})` : ''),
      )
    }

    // Verify at least one file landed for real skill/source trees
    try {
      const finalEntries = readdirSync(pathExists(fsPath(to)) ? fsPath(to) : to)
      if (finalEntries.length === 0) {
        throw new Error(`Copy finished but target is empty: ${toPath}`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('target is empty')) throw err
      // readdir failure after exists is still a hard fail
      throw new Error(`Copy finished but cannot read target: ${toPath}: ${errMessage(err)}`)
    }
  } finally {
    removeDir(stageRoot)
  }
}

/**
 * Move a staged directory (already built at tmpDir) into toPath.
 * Used by resource-bundle import which builds content in-place under tmp.
 *
 * If tmpDir sits under a Chinese parent and rename fails, falls back to
 * copy via OS temp (ASCII) so the final tree still lands.
 */
export function finalizeStagedDirectory(tmpDir: string, toPath: string): void {
  const tmp = resolveFsPath(tmpDir)
  const to = resolveFsPath(toPath)
  const parentDir = dirname(to)

  if (!pathExists(tmp)) {
    throw new Error(`Staged directory missing: ${tmpDir}`)
  }

  ensureDir(parentDir)
  removeDir(to)

  let lastRenameError = ''
  let placed = false

  try {
    renameSync(fsPath(tmp), fsPath(to))
    placed = pathExists(to)
  } catch (renameErr) {
    lastRenameError = errMessage(renameErr)
    try {
      renameSync(tmp, to)
      placed = pathExists(to)
    } catch (renameErr2) {
      lastRenameError = `${lastRenameError}; ${errMessage(renameErr2)}`
    }
  }

  if (!placed) {
    // Build via OS temp then copy into final path (handles CJK + cross-volume)
    const bridge = join(tmpdir(), `selection-finalize-${randomUUID().replace(/-/g, '').slice(0, 12)}`)
    try {
      copyDirRecursive(tmp, bridge)
      removeDir(to)
      copyDirRecursive(bridge, to)
      removeDir(tmp)
    } finally {
      removeDir(bridge)
    }
  }

  if (!pathExists(to)) {
    throw new Error(
      `Finalize failed; target missing: ${toPath}` +
        (lastRenameError ? ` (rename: ${lastRenameError})` : ''),
    )
  }
}
