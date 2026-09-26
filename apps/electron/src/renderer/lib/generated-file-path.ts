import { isAbsolutePath } from './drafts'

function isWindowsRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

function hasWindowsBase(baseDir?: string | null): boolean {
  return !!baseDir && (/^[A-Za-z]:[\\/]/.test(baseDir) || baseDir.includes('\\'))
}

/**
 * Normalize a file path coming from generated markdown / mention links
 * so it can be opened on Windows and under Chinese workspace folders.
 */
export function normalizeGeneratedFilePath(path: string, windows = isWindowsRuntime()): string {
  let p = path.trim()
  if (!p) return p

  if (p.includes('%')) {
    try {
      p = decodeURIComponent(p)
    } catch {
      // keep raw when encoding is invalid
    }
  }

  if (/^file:/i.test(p)) {
    p = p.replace(/\\/g, '/')
    const host = p.match(/^file:\/\/([^/]+)(?:\/|$)/i)?.[1]
    // Keep the third slash of file:///Users/...: it is the POSIX root.
    p = p.replace(/^file:\/\//i, '')
    // Keep the slash after localhost for POSIX paths; /C:/ is handled below.
    p = p.replace(/^localhost(?=\/)/i, '')
    if (host && host.toLowerCase() !== 'localhost' && !/^[A-Za-z]:$/.test(host)) {
      p = `//${p}`
    }
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
  }

  // Git Bash / MSYS tools commonly print C:\foo as /c/foo. Chromium treats
  // that as a POSIX absolute path, which makes Windows search a non-existent
  // /c directory and fall back to a misleading workspace-wide closest match.
  if (windows) {
    p = p.replace(/^\/([A-Za-z])(?=[\\/])/, (_match, drive: string) => `${drive.toUpperCase()}:`)
  }

  p = p.replace(/^\/([A-Za-z]:[\\/])/, '$1')
  if (p !== '/' && !/^[A-Za-z]:[\\/]$/.test(p)) p = p.replace(/[\\/]+$/, '')
  return p
}

export function joinBaseAndRel(baseDir: string, rel: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(baseDir) || baseDir.includes('\\')
  const sep = windows ? '\\' : '/'
  const base = baseDir.replace(/[\\/]+$/, '')
  const cleaned = rel.replace(/^\.[\\/]/, '').replace(/^[\\/]+/, '')
  const relNorm = windows ? cleaned.replace(/\//g, '\\') : cleaned.replace(/\\/g, '/')
  return `${base}${sep}${relNorm}`
}

function workspaceBaseName(baseDir: string): string {
  return baseDir.replace(/[\\/]+$/, '').split(/[/\\]/).pop() || ''
}

function sameFolderName(a: string, b: string, windows: boolean): boolean {
  if (!a || !b) return false
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Paths to try when opening a generated link.
 * First is the literal join; a second candidate drops a duplicated workspace folder
 * (`巡察工作/skills/a.md` under `…\巡察工作`). Caller should prefer a candidate
 * that exists rather than always stripping (workspace named `skills` is common).
 */
export function listGeneratedFilePathCandidates(path: string, baseDir?: string | null): string[] {
  const normalized = normalizeGeneratedFilePath(path, hasWindowsBase(baseDir) || isWindowsRuntime())
  if (isAbsolutePath(normalized) || normalized.startsWith('~/') || normalized.startsWith('\\\\')) {
    return [normalized]
  }
  if (!baseDir) return [normalized]

  const joined = joinBaseAndRel(baseDir, normalized)
  const candidates = [joined]

  const windows = /^[A-Za-z]:[\\/]/.test(baseDir) || baseDir.includes('\\')
  const relUnix = normalized.replace(/\\/g, '/')
  const baseName = workspaceBaseName(baseDir)
  const first = relUnix.split('/')[0] || ''
  if (sameFolderName(baseName, first, windows)) {
    const rest = relUnix.split('/').slice(1).filter(Boolean).join('/')
    if (rest) {
      const alt = joinBaseAndRel(baseDir, rest)
      if (!pathsLikelySame(alt, joined)) candidates.push(alt)
    }
  }

  return candidates
}

export function resolveGeneratedFilePath(path: string, baseDir?: string | null): string {
  return listGeneratedFilePathCandidates(path, baseDir)[0]
    ?? normalizeGeneratedFilePath(path, hasWindowsBase(baseDir) || isWindowsRuntime())
}

/**
 * Generated files live in the selected working directory when one exists;
 * otherwise the session folder is the agent's cwd and must be tried before the
 * much broader workspace root.
 */
export function generatedFileBaseDir(opts: {
  workingDirectory?: string | null
  sessionFolderPath?: string | null
  workspaceRootPath?: string | null
}): string | undefined {
  return opts.workingDirectory
    || opts.sessionFolderPath
    || opts.workspaceRootPath
    || undefined
}

export function generatedFileBaseDirs(opts: {
  workingDirectory?: string | null
  sessionFolderPath?: string | null
  workspaceRootPath?: string | null
}): string[] {
  const dirs = [opts.workingDirectory, opts.sessionFolderPath, opts.workspaceRootPath]
  return dirs.filter((dir): dir is string => !!dir)
    .filter((dir, index, all) => all.findIndex((other) => pathsLikelySame(other, dir)) === index)
}

export type GeneratedFileSearchHit = {
  type: string
  name: string
  path: string
  relativePath?: string
}

export type GeneratedFileOpenPick = {
  path: string
  type: 'file' | 'directory'
}

export type SearchGeneratedFiles = (
  basePath: string,
  query: string,
) => Promise<GeneratedFileSearchHit[]>

export type StatGeneratedPath = (
  path: string,
) => Promise<GeneratedFileOpenPick | null>

function isOpenableHit(hit: GeneratedFileSearchHit): hit is GeneratedFileSearchHit & {
  type: GeneratedFileOpenPick['type']
} {
  return hit.type === 'file' || hit.type === 'directory'
}

function splitParentAndName(resolved: string): { parentDir: string; fileName: string } | null {
  const lastSlash = Math.max(resolved.lastIndexOf('/'), resolved.lastIndexOf('\\'))
  if (lastSlash < 0 || lastSlash >= resolved.length - 1) return null
  const parentDir = lastSlash === 0
    ? (resolved[0] === '/' ? '/' : resolved.slice(0, 1))
    : resolved.slice(0, lastSlash)
  return {
    parentDir,
    fileName: resolved.slice(lastSlash + 1),
  }
}

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() || ''
}

/**
 * Nearest ancestor whose last segment is ASCII. Used when search under a
 * Chinese workspace folder fails on Windows but `D:\selection` still works.
 */
export function asciiContainingDir(dir: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(dir) || dir.includes('\\')
  const sep = windows ? '\\' : '/'
  const trimmed = dir.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  let lastAscii = -1
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && /^[\x00-\x7F]+$/.test(parts[i])) lastAscii = i
  }
  if (lastAscii < 0) return null
  // Avoid searching an entire Windows drive (`D:`).
  if (windows && lastAscii === 0) return null
  const ancestor = parts.slice(0, lastAscii + 1).join(sep)
  if (!ancestor || pathsLikelySame(ancestor, trimmed)) return null
  return ancestor
}

function pickFromHits(
  hits: GeneratedFileSearchHit[],
  candidates: string[],
): GeneratedFileOpenPick | null {
  const exact = hits.filter(isOpenableHit).find((m) =>
    candidates.some((candidate) => pathsLikelySame(candidate, m.path)))
  return exact ? { path: exact.path, type: exact.type } : null
}

async function probeCandidate(
  resolved: string,
  searchFiles: SearchGeneratedFiles,
): Promise<GeneratedFileOpenPick | null> {
  if (!isAbsolutePath(resolved)) return null
  const parts = splitParentAndName(resolved)
  if (!parts) return null
  const matches = await searchFiles(parts.parentDir, parts.fileName)
  const entries = matches.filter(isOpenableHit).filter((m) =>
    m.name === parts.fileName || m.name.toLowerCase() === parts.fileName.toLowerCase())
  const exact = entries.find((m) => pathsLikelySame(m.path, resolved))
  if (exact) return { path: exact.path, type: exact.type }
  return null
}

/**
 * Choose an on-disk path for a generated markdown file or directory link.
 * Prefers a candidate that searchFiles can see; last resorts search the
 * workspace (and its ASCII ancestor) when a parent-dir probe fails.
 * Only exact candidate paths are accepted: a same-named file on another
 * Windows drive or in another folder must never replace a missing target.
 */
export async function resolveOpenableGeneratedPath(opts: {
  requestedPath: string
  baseDir?: string | null
  baseDirs?: string[]
  statPath?: StatGeneratedPath
  searchFiles: SearchGeneratedFiles
}): Promise<GeneratedFileOpenPick> {
  const bases = [opts.baseDir, ...(opts.baseDirs ?? [])]
  const candidates = bases.flatMap((base) => listGeneratedFilePathCandidates(opts.requestedPath, base))
    .filter((candidate, index, all) => all.findIndex((other) => pathsLikelySame(other, candidate)) === index)

  if (opts.statPath) {
    try {
      for (const candidate of candidates) {
        // The server checks the exact path and applies the same access rules as
        // shell:openFile. A denied or missing target must not trigger fuzzy search.
        const hit = await opts.statPath(candidate)
        if (hit) return hit
      }
      throw new Error('File not found: ' + opts.requestedPath)
    } catch (error) {
      // Older servers may not advertise their channels during handshake.
      // Search remains a compatibility path only when this RPC is unavailable.
      if (!(error instanceof Error && 'code' in error
        && (error as Error & { code?: string }).code === 'CHANNEL_NOT_FOUND')) throw error
    }
  }

  for (const resolved of candidates) {
    try {
      const hit = await probeCandidate(resolved, opts.searchFiles)
      if (hit) return hit
    } catch {
      // Parent missing or search failed — try the next candidate.
    }
  }

  const fileName = fileNameOf(normalizeGeneratedFilePath(opts.requestedPath))
  if (fileName) {
    const roots: string[] = []
    const addRoot = (dir?: string | null) => {
      if (!dir) return
      if (!roots.some((r) => pathsLikelySame(r, dir))) roots.push(dir)
    }
    for (const base of bases) {
      addRoot(base)
      if (base) addRoot(asciiContainingDir(base))
    }

    for (const root of roots) {
      try {
        const hits = await opts.searchFiles(root, fileName)
        const picked = pickFromHits(hits, candidates)
        if (picked) return picked
      } catch {
        // Try the next broader root.
      }
    }
  }

  throw new Error('File not found: ' + opts.requestedPath)
}

export function pathsLikelySame(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
  const left = norm(a)
  const right = norm(b)
  if (left === right) return true
  // Windows paths are case-insensitive; POSIX stays case-sensitive.
  const looksWindows = /^[A-Za-z]:\//.test(left) || /^[A-Za-z]:\//.test(right)
  return looksWindows && left.toLowerCase() === right.toLowerCase()
}
