import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isArtifactCardPath, isSessionScratchPath } from '@craft-agent/shared/utils/artifact-links'

type Fingerprint = { size: bigint; mtimeNs: bigint; ctimeNs: bigint }

// Windows wall-clock ticks can lead NTFS timestamps by more than 2 ms.
export const ARTIFACT_WRITE_CLOCK_SKEW_MS = process.platform === 'win32' ? 32 : 2

/** Tool, dependency and build cache directories are never user-facing deliverables. */
const IGNORED_SCAN_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.pnpm-store',
])

/** A turn-local filesystem ledger. Names come from the filesystem, never answer prose. */
export class ArtifactCandidateInventory {
  private before = new Map<string, Fingerprint>()
  private beforeCanonical = new Set<string>()
  private resolvedRoots: string[]
  private resolvedInternalRoot?: string
  readonly startedAt = Date.now()
  constructor(private roots: readonly string[], private workspaceRoot?: string) {
    this.resolvedRoots = roots.map(root => {
      try { return realpathSync(root) }
      catch { return resolve(root) }
    })
    this.resolvedInternalRoot = workspaceRoot ? (() => {
      try { return realpathSync(workspaceRoot) }
      catch { return resolve(workspaceRoot) }
    })() : undefined
    this.before = this.scan(this.beforeCanonical)
  }

  changed(): string[] {
    const after = this.scan()
    return [...after].filter(([path, file]) => {
      const old = this.before.get(path)
      return !old || old.size !== file.size || old.mtimeNs !== file.mtimeNs || old.ctimeNs !== file.ctimeNs
    }).map(([path]) => path)
  }

  existedAtStart(path: string): boolean {
    if (this.before.has(path) || this.beforeCanonical.has(path)) return true
    try {
      return this.beforeCanonical.has(realpathSync(path))
    } catch {
      return false
    }
  }

  covers(path: string): boolean {
    return this.resolvedRoots.some(base => {
      const location = relative(base, path)
      return location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location))
    })
  }

  /** Whether `path` lies in a scanned subtree (excluding caches, scratch, and sibling sessions). */
  tracks(path: string): boolean {
    if (!isArtifactCardPath(path) || isSessionScratchPath(path)) return false
    const resolvedSessionRoot = this.resolvedRoots[1]
    return this.resolvedRoots.some((base, index) => {
      const rel = relative(base, path)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
      const segments = rel.split(sep)
      const first = segments[0]!
      const dirs = segments.slice(0, -1)
      if (base === resolvedSessionRoot && (first === 'meta' || first === 'session.jsonl')) return false
      if (index === 0 && base === this.resolvedInternalRoot && (first === 'sessions' || first === 'artifacts')) return false
      if (dirs.some(dir => IGNORED_SCAN_DIRS.has(dir.toLowerCase()))) return false
      return true
    })
  }

  private scan(canonicalOut?: Set<string>): Map<string, Fingerprint> {
    const files = new Map<string, Fingerprint>()
    const visited = new Set<string>()
    const sessionRoot = this.roots[1] ? resolve(this.roots[1]) : undefined
    const internalRoot = this.workspaceRoot ? resolve(this.workspaceRoot) : undefined
    const walk = (directory: string, rawRoot: string, resolvedRoot: string) => {
      if (!existsSync(directory) || visited.has(directory)) return
      visited.add(directory)
      let entries: Dirent[]
      try { entries = readdirSync(directory, { withFileTypes: true }) }
      catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return
        throw error
      }
      for (const entry of entries) {
        if (directory === sessionRoot && (entry.name === 'meta' || entry.name === 'session.jsonl')) continue
        if (directory === internalRoot && (entry.name === 'sessions' || entry.name === 'artifacts')) continue
        if (entry.isDirectory() && IGNORED_SCAN_DIRS.has(entry.name.toLowerCase())) continue
        const path = join(directory, entry.name)
        if (isSessionScratchPath(path) || entry.isSymbolicLink()) continue
        if (entry.isDirectory()) { walk(path, rawRoot, resolvedRoot); continue }
        if (!entry.isFile() || !isArtifactCardPath(path)) continue
        try {
          const file = statSync(path, { bigint: true })
          files.set(path, { size: file.size, mtimeNs: file.mtimeNs, ctimeNs: file.ctimeNs })
          if (canonicalOut) {
            canonicalOut.add(resolvedRoot === rawRoot ? path : join(resolvedRoot, relative(rawRoot, path)))
          }
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
    }
    for (let i = 0; i < this.roots.length; i++) {
      const rawRoot = resolve(this.roots[i]!)
      walk(rawRoot, rawRoot, this.resolvedRoots[i]!)
    }
    return files
  }
}
