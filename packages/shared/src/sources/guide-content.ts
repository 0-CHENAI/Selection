/**
 * Source guides are created with an editable skeleton. That skeleton is useful
 * in the settings UI, but it must not turn every source call into a mandatory
 * documentation-reading exercise.
 */

const FRONTMATTER_RE = /^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const MARKDOWN_HEADING_RE = /^\s{0,3}#{1,6}(?:\s+.*)?$/;
const DEFAULT_PLACEHOLDER_RE = /^\(add (?:usage guidelines here|context about this source)\)$/i;
const SOURCE_SLUG_RE = /^[a-z0-9-]+$/;

/** Return true only when a guide contains instructions beyond its empty template. */
export function hasMeaningfulSourceGuide(raw: string | null | undefined): boolean {
  if (!raw) return false;

  const content = raw
    .replace(FRONTMATTER_RE, '')
    .replace(HTML_COMMENT_RE, '');

  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (MARKDOWN_HEADING_RE.test(trimmed)) return false;
    if (DEFAULT_PLACEHOLDER_RE.test(trimmed)) return false;
    return true;
  });
}

const INTERNAL_SOURCE_SLUGS = new Set(['session', 'craft-agents-docs']);

/** Resolve user-managed MCP/API source tools without treating internal tools as sources. */
export function getSourceSlugForTool(toolName: string): string | null {
  if (toolName.startsWith('mcp__')) {
    const [, slug, operation] = toolName.split('__');
    if (!slug || !operation || !SOURCE_SLUG_RE.test(slug) || INTERNAL_SOURCE_SLUGS.has(slug)) return null;
    return slug;
  }

  if (toolName.startsWith('api_')) {
    const slug = toolName.slice(4);
    return SOURCE_SLUG_RE.test(slug) && !INTERNAL_SOURCE_SLUGS.has(slug) ? slug : null;
  }

  return null;
}
