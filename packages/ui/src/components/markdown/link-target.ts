import { FILE_EXTENSIONS_PATTERN } from '../../lib/file-classification'
import { isFilePathTarget } from './linkify'

export type ResolvedMarkdownLinkTarget =
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string }

const KNOWN_FILE_NAME_RE = new RegExp(`\\.(?:${FILE_EXTENSIONS_PATTERN})$`, 'i')

function normalizeFileUrlPath(path: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

/**
 * Percent-decode a bare file path so a link destination with %20 (the only
 * CommonMark-legal way to encode a space in a bare destination) resolves to the
 * real on-disk path. No-op when there's no '%'; falls back to the raw string if
 * the value isn't valid percent-encoding (#944).
 */
export function decodeFilePath(path: string): string {
  if (!path.includes('%')) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function resolveFileUrlPath(target: string): string | null {
  if (!/^file:/i.test(target)) return null

  // URL parser requires forward slashes; AI output often uses Windows `\`.
  const normalized = target.replace(/\\/g, '/')

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'file:') return null

    const pathname = decodeURIComponent(parsed.pathname || '')
    const host = parsed.hostname ? decodeURIComponent(parsed.hostname) : ''

    // file://D:/selection/巡察工作/a.md  → hostname "d", pathname "/selection/..."
    if (host && /^[A-Za-z]$/.test(host)) {
      const rest = pathname.startsWith('/') ? pathname : `/${pathname}`
      return `${host.toUpperCase()}:${rest}`
    }

    if (!pathname && !host) return null

    // file://localhost/C:/Users/x.md (common Windows form)
    if (!host || host.toLowerCase() === 'localhost') {
      return normalizeFileUrlPath(pathname)
    }

    return normalizeFileUrlPath(`//${host}${pathname}`)
  } catch {
    return null
  }
}

/**
 * linkify-it turns a bare `SKILL.md` into `http://SKILL.md`. That is not a
 * real host — send it back through the file opener.
 */
function fuzzyAutolinkedFileName(target: string): string | null {
  const match = target.match(/^https?:\/\/([^/?#]+)$/i)
  if (!match?.[1]) return null
  const host = decodeFilePath(match[1])
  // Bare `SKILL.md` only — reject multi-label hosts like jquery.min.js / example.com.
  if (!/^[^\s./]+\.[A-Za-z0-9]+$/.test(host)) return null
  return KNOWN_FILE_NAME_RE.test(host) ? host : null
}

/**
 * Resolve markdown link targets for click dispatch.
 *
 * - Raw filesystem paths are routed through onFileClick
 * - Explicit file:// URLs are normalized to filesystem paths and also routed through onFileClick
 * - Fuzzy `http://SKILL.md` autolinks are treated as local file names
 * - Everything else is treated as a URL and routed through onUrlClick
 */
export function resolveMarkdownLinkTarget(target: string): ResolvedMarkdownLinkTarget {
  const trimmed = target.trim()

  const fileUrlPath = resolveFileUrlPath(trimmed)
  if (fileUrlPath) {
    return { kind: 'file', path: fileUrlPath }
  }

  if (isFilePathTarget(trimmed)) {
    return { kind: 'file', path: decodeFilePath(trimmed) }
  }

  const fuzzyName = fuzzyAutolinkedFileName(trimmed)
  if (fuzzyName) {
    return { kind: 'file', path: fuzzyName }
  }

  return { kind: 'url', url: trimmed }
}

/**
 * Backward-compatible classifier for tests and existing callers that only need the kind.
 */
export function classifyMarkdownLinkTarget(target: string): 'file' | 'url' {
  return resolveMarkdownLinkTarget(target).kind
}
