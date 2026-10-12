import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isArtifactCardPath, isSessionScratchPath } from '@craft-agent/shared/utils/artifact-links'

type Fingerprint = { size: bigint; mtimeNs: bigint; ctimeNs: bigint }

// Windows wall-clock ticks can lead NTFS timestamps by more than 2 ms.
export const ARTIFACT_WRITE_CLOCK_SKEW_MS = process.platform === 'win32' ? 32 : 2

/** A turn-local filesystem ledger. Names come from the filesystem, never answer prose. */
export class ArtifactCandidateInventory {
  private before = new Map<string, Fingerprint>()
  readonly startedAt = Date.now()
  constructor(private roots: readonly string[], private workspaceRoot?: string) {
    this.before = this.scan()
  }

  changed(): string[] {
    const after = this.scan()
    return [...after].filter(([path, file]) => {
      const old = this.before.get(path)
      return !old || old.size !== file.size || old.mtimeNs !== file.mtimeNs || old.ctimeNs !== file.ctimeNs
    }).map(([path]) => path)
  }

  existedAtStart(path: string): boolean {
    return this.before.has(path)
  }

  covers(path: string): boolean {
    return this.roots.some(root => {
      let base: string
      try { base = realpathSync(root) }
      catch { base = resolve(root) }
      const location = relative(base, path)
      return location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location))
    })
  }

  private scan(): Map<string, Fingerprint> {
    const files = new Map<string, Fingerprint>()
    const visited = new Set<string>()
    const sessionRoot = this.roots[1] ? resolve(this.roots[1]) : undefined
    const internalRoot = this.workspaceRoot ? resolve(this.workspaceRoot) : undefined
    const walk = (directory: string) => {
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
        // Dependency and Git internals are never user-facing deliverables.
        if (entry.isDirectory() && (entry.name.toLowerCase() === '.git' || entry.name.toLowerCase() === 'node_modules')) continue
        const path = join(directory, entry.name)
        if (isSessionScratchPath(path) || entry.isSymbolicLink()) continue
        if (entry.isDirectory()) { walk(path); continue }
        if (!entry.isFile() || !isArtifactCardPath(path)) continue
        try {
          const file = statSync(path, { bigint: true })
          files.set(path, { size: file.size, mtimeNs: file.mtimeNs, ctimeNs: file.ctimeNs })
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
    }
    for (const root of this.roots) walk(resolve(root))
    return files
  }
}
