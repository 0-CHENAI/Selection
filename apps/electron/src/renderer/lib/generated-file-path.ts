import { isAbsolutePath } from './drafts'

/**
 * Normalize a file path coming from generated markdown / mention links
 * so it can be opened on Windows and under Chinese workspace folders.
 */
export function normalizeGeneratedFilePath(path: string): string {
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
    p = p.replace(/^file:\/\/+/i, '')
    // file://localhost/C:/foo or leftover /C:/foo
    p = p.replace(/^localhost\//i, '')
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
  }

  p = p.replace(/^\/([A-Za-z]:[\\/])/, '$1')
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
  const normalized = normalizeGeneratedFilePath(path)
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
  return listGeneratedFilePathCandidates(path, baseDir)[0] ?? normalizeGeneratedFilePath(path)
}

export type GeneratedFileSearchHit = {
  type: string
  name: string
  path: string
  relativePath?: string
}

export type GeneratedFileOpenPick = {
  path: string
  closestMatchRelativePath?: string
}

export type SearchGeneratedFiles = (
  basePath: string,
  query: string,
) => Promise<GeneratedFileSearchHit[]>

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

function pathEndsWithSuffix(absPath: string, suffix: string): boolean {
  const left = absPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const right = suffix.replace(/\\/g, '/').replace(/^\/+/, '')
  // A bare filename is too weak to pick among several same-named hits.
  if (!right || !right.includes('/')) return false
  if (pathsLikelySame(left, right)) return true
  if (left.endsWith(`/${right}`)) return true
  const looksWindows = /^[A-Za-z]:\//.test(left) || /^[A-Za-z]:\//.test(right)
  return looksWindows && left.toLowerCase().endsWith(`/${right.toLowerCase()}`)
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
  requestedPath: string,
  candidates: string[],
): GeneratedFileOpenPick | null {
  const files = hits.filter((m) => m.type === 'file')
  if (files.length === 0) return null

  const requestedName = fileNameOf(normalizeGeneratedFilePath(requestedPath))
  const named = requestedName
    ? files.filter((m) => m.name === requestedName || m.name.toLowerCase() === requestedName.toLowerCase())
    : files
  const pool = named.length > 0 ? named : files

  const suffixes = [normalizeGeneratedFilePath(requestedPath), ...candidates]

  for (const suffix of suffixes) {
    const match = pool.find((m) => pathEndsWithSuffix(m.path, suffix))
    if (match) {
      const exactCandidate = candidates.some((c) => pathsLikelySame(c, match.path))
      return exactCandidate
        ? { path: match.path }
        : { path: match.path, closestMatchRelativePath: match.relativePath }
    }
  }

  if (pool.length === 1) {
    const only = pool[0]!
    const exact = candidates.some((c) => pathsLikelySame(c, only.path))
    return exact
      ? { path: only.path }
      : { path: only.path, closestMatchRelativePath: only.relativePath }
  }

  return null
}

async function probeCandidate(
  resolved: string,
  searchFiles: SearchGeneratedFiles,
): Promise<GeneratedFileOpenPick | null> {
  if (!isAbsolutePath(resolved)) return null
  const parts = splitParentAndName(resolved)
  if (!parts) return null
  const matches = await searchFiles(parts.parentDir, parts.fileName)
  const files = matches.filter((m) => m.type === 'file' && (
    m.name === parts.fileName || m.name.toLowerCase() === parts.fileName.toLowerCase()
  ))
  const exact = files.find((m) => pathsLikelySame(m.path, resolved))
  if (exact) return { path: exact.path }
  if (files.length === 1 && files[0]) {
    return { path: files[0].path, closestMatchRelativePath: files[0].relativePath }
  }
  return null
}

/**
 * Choose an on-disk path for a generated markdown file link.
 * Prefers a candidate that searchFiles can see; last resorts search the
 * workspace (and its ASCII ancestor) so a doubled Chinese folder name
 * or a failed parent-dir probe still opens the real file.
 */
export async function resolveOpenableGeneratedFile(opts: {
  requestedPath: string
  baseDir?: string | null
  searchFiles: SearchGeneratedFiles
}): Promise<GeneratedFileOpenPick> {
  const candidates = listGeneratedFilePathCandidates(opts.requestedPath, opts.baseDir)

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
    addRoot(opts.baseDir)
    if (opts.baseDir) addRoot(asciiContainingDir(opts.baseDir))

    for (const root of roots) {
      try {
        const hits = await opts.searchFiles(root, fileName)
        const picked = pickFromHits(hits, opts.requestedPath, candidates)
        if (picked) return picked
      } catch {
        // Try the next broader root.
      }
    }
  }

  return { path: candidates[0] ?? opts.requestedPath }
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
