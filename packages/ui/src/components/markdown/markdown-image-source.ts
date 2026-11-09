import { resolveMarkdownLinkTarget } from './link-target'

export type MarkdownImageSource =
  | { kind: 'remote'; src: string }
  | { kind: 'data'; src: string }
  | { kind: 'file'; path: string }
  | { kind: 'blocked' }

const BLOCKED_SRC_RE = /^(javascript|vbscript|blob):/i
const DATA_IMAGE_RE = /^data:image\//i
const REMOTE_SRC_RE = /^https?:\/\//i

/**
 * Classify an markdown/HTML image `src` for in-app rendering.
 *
 * ReactMarkdown's default URL transform strips `file:`, `data:`, and Windows
 * drive letters (`C:`), which made every local chat image look broken.
 */
export function resolveMarkdownImageSource(src: string | undefined): MarkdownImageSource {
  const trimmed = src?.trim() ?? ''
  if (!trimmed || BLOCKED_SRC_RE.test(trimmed)) return { kind: 'blocked' }
  if (DATA_IMAGE_RE.test(trimmed)) return { kind: 'data', src: trimmed }
  if (REMOTE_SRC_RE.test(trimmed)) return { kind: 'remote', src: trimmed }

  const target = resolveMarkdownLinkTarget(trimmed)
  if (target.kind === 'file') return { kind: 'file', path: target.path }
  return { kind: 'blocked' }
}

export function isPreservedMarkdownImageSrc(src: string | undefined): boolean {
  return resolveMarkdownImageSource(src).kind !== 'blocked'
}
