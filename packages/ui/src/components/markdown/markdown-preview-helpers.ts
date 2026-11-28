import { localArtifactPath } from '@craft-agent/shared/utils/artifact-links'

/**
 * Shared file-preview spec validation for MarkdownDocBlock and MarkdownHtmlBlock.
 *
 * Extracted so we can unit-test the JSON-spec → preview-items normalization
 * without spinning up React. Component DOM behavior is verified separately in the browser.
 */

export interface MarkdownPreviewItem {
  src: string
  label?: string
}

export interface MarkdownPreviewSpec {
  src?: string
  title?: string
  items?: MarkdownPreviewItem[]
}

/**
 * Parse a `markdown-preview` JSON spec string.
 *
 * Returns `null` for invalid JSON or specs that lack both `src` and a non-empty
 * `items` array. Uses the shared HTML/Markdown preview schema so the same
 * spec shape works across preview block types.
 */
export function parseMarkdownPreviewSpec(code: string): MarkdownPreviewSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object') return null
  const spec = raw as Record<string, unknown>

  const itemsField = spec.items
  if (Array.isArray(itemsField) && itemsField.length > 0) {
    const items = itemsField.filter(
      (item): item is MarkdownPreviewItem =>
        !!item && typeof item === 'object' && typeof (item as { src?: unknown }).src === 'string' && (item as { src: string }).src.length > 0
    ).map(item => ({
      src: item.src,
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
    }))
    if (items.length === 0) return null
    return {
      src: typeof spec.src === 'string' ? spec.src : undefined,
      title: typeof spec.title === 'string' ? spec.title : undefined,
      items,
    }
  }

  if (typeof spec.src === 'string' && spec.src.length > 0) {
    return {
      src: spec.src,
      title: typeof spec.title === 'string' ? spec.title : undefined,
    }
  }

  return null
}

/**
 * Normalize a spec to a flat array of items.
 *
 * Single-item specs (only `src`) are wrapped into a one-element array so the
 * rest of the component can iterate uniformly. If both fields are present,
 * `items` wins (matches sibling preview blocks).
 */
export function normalizePreviewItems(spec: MarkdownPreviewSpec | null): MarkdownPreviewItem[] {
  if (!spec) return []
  if (spec.items && spec.items.length > 0) return spec.items
  if (spec.src) return [{ src: spec.src }]
  return []
}

function normalizePreviewPathKey(rawPath: string): string | null {
  const local = localArtifactPath(rawPath)
  if (!local) return null
  const normalized = local.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  if (!normalized) return null
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

function isAbsolutePreviewPathKey(key: string): boolean {
  return key.startsWith('/') || /^[a-z]:\//i.test(key) || key.startsWith('//')
}

/**
 * Single-file `html-preview` blocks duplicate the deliverable shelf when the
 * same file is already shown in `ResponseArtifacts`. Multi-item tab sets and
 * scratch/untracked HTML files (e.g. emails or templates in `data/`) remain visible.
 */
export function isHtmlPreviewCoveredByArtifacts(
  items: readonly MarkdownPreviewItem[],
  deliveredArtifactPaths: readonly string[],
): boolean {
  if (items.length !== 1 || deliveredArtifactPaths.length === 0) return false
  const srcKey = normalizePreviewPathKey(items[0]!.src)
  if (!srcKey) return false
  const srcAbsolute = isAbsolutePreviewPathKey(srcKey)
  const srcLower = srcKey.toLowerCase()
  for (const deliveredPath of deliveredArtifactPaths) {
    const deliveredKey = normalizePreviewPathKey(deliveredPath)
    if (!deliveredKey) continue
    if (deliveredKey === srcKey) return true
    const deliveredAbsolute = isAbsolutePreviewPathKey(deliveredKey)
    if (!srcAbsolute && deliveredAbsolute) {
      const lowerDelivered = deliveredKey.toLowerCase()
      if (lowerDelivered === srcLower || lowerDelivered.endsWith(`/${srcLower}`)) return true
    } else if (srcAbsolute && !deliveredAbsolute) {
      const lowerDelivered = deliveredKey.toLowerCase()
      if (srcLower === lowerDelivered || srcLower.endsWith(`/${lowerDelivered}`)) return true
    }
  }
  return false
}
