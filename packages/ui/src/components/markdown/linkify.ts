import LinkifyIt from 'linkify-it'
import { FILE_EXTENSIONS_PATTERN } from '../../lib/file-classification'

/**
 * Linkify - URL and file path detection for markdown preprocessing
 *
 * Uses linkify-it (12M downloads/week) for battle-tested URL detection,
 * plus custom regex for local file paths.
 */

// Initialize linkify-it with default settings (fuzzy URLs, emails enabled)
const linkify = new LinkifyIt()

// Path characters: letters (incl. CJK), digits, and typical path punctuation. No spaces.
// Deliberately narrower than `[^\s)]*` so "see the file is config.json" is not one match.
const PATH_CHARS = `[\\p{L}\\p{N}_\\-./@%\\\\]`
const FILE_PREFIX = `(?:/|~/|\\./|\\.\\./|[A-Za-z]:[\\\\/])`
const FILE_PATH_REGEX_SOURCE = `(?:^|[\\s([\\{<「『（])((?:${FILE_PREFIX}${PATH_CHARS}*|${PATH_CHARS}+)\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=[\\s)\\]}\\.,:;!?>。、，；！？」』）]|$)`
const FILE_PATH_REGEX = new RegExp(FILE_PATH_REGEX_SOURCE, 'giu')
const FILE_PATH_PRETEST_REGEX = new RegExp(FILE_PATH_REGEX_SOURCE, 'iu')

const WEB_SCHEME_RE = /^(https?|mailto|ftp|data|blob|javascript|vbscript|about|chrome):/i
const KNOWN_EXT_RE = new RegExp(`\\.(?:${FILE_EXTENSIONS_PATTERN})$`, 'i')

interface DetectedLink {
  type: 'url' | 'email' | 'file'
  text: string
  url: string
  start: number
  end: number
}

interface CodeRange {
  start: number
  end: number
}

/**
 * Find all code block and inline code ranges in text
 * These ranges should be excluded from link detection
 */
function findCodeRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = []

  // Find fenced code blocks (```...```)
  const fencedRegex = /```[\s\S]*?```/g
  let match
  while ((match = fencedRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }

  // Find inline code (`...`)
  // But skip escaped backticks and code inside fenced blocks
  const inlineRegex = /(?<!`)`(?!`)([^`\n]+)`(?!`)/g
  while ((match = inlineRegex.exec(text)) !== null) {
    const pos = match.index
    // Check if this is inside a fenced block
    const insideFenced = ranges.some(r => pos >= r.start && pos < r.end)
    if (!insideFenced) {
      ranges.push({ start: pos, end: pos + match[0].length })
    }
  }

  return ranges
}

/**
 * Check if a position is inside any code range
 */
function isInsideCode(pos: number, ranges: CodeRange[]): boolean {
  return ranges.some(r => pos >= r.start && pos < r.end)
}

/**
 * Find the closing parenthesis for an inline markdown destination. Bare
 * destinations may contain balanced parentheses, while angle-bracketed
 * destinations may contain parentheses without any escaping at all.
 */
function findInlineLinkDestinationEnd(text: string, start: number): number {
  let depth = 1
  let insideAngleDestination = text[start] === '<'
  const destinationPrefix = text.slice(start)
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(destinationPrefix) || destinationPrefix.startsWith('\\\\')

  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '\n' || char === '\r') return -1

    if (char === '\\' && !isWindowsPath) {
      i++
      continue
    }

    if (insideAngleDestination) {
      if (char === '>') insideAngleDestination = false
      continue
    }

    if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/**
 * Find all markdown link ranges in text: both [text](...) and [text][ref] patterns.
 * Returns ranges covering the entire link syntax so any URL detected within
 * these spans is skipped by preprocessLinks() — preventing nested/broken links.
 */
function findMarkdownLinkRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = []

  // Match [text](url) — inline links. Scan the destination instead of using
  // `[^)]*` so paths such as `report (1).docx` stay inside the same link.
  const inlineLinkRegex = /\[(?:[^\[\]]|\\\[|\\\])*\]\(/g
  let match
  while ((match = inlineLinkRegex.exec(text)) !== null) {
    const destinationEnd = findInlineLinkDestinationEnd(text, inlineLinkRegex.lastIndex)
    if (destinationEnd < 0) continue
    ranges.push({ start: match.index, end: destinationEnd + 1 })
    inlineLinkRegex.lastIndex = destinationEnd + 1
  }

  // Match [text][ref] — reference links
  const refLinkRegex = /\[(?:[^\[\]]|\\\[|\\\])*\]\[[^\]]*\]/g
  while ((match = refLinkRegex.exec(text)) !== null) {
    // Avoid duplicates with inline links that already matched
    const r = { start: match.index, end: match.index + match[0].length }
    const alreadyCovered = ranges.some(existing => rangesOverlap(existing, r))
    if (!alreadyCovered) {
      ranges.push(r)
    }
  }

  return ranges
}

/**
 * Check if a position falls inside any markdown link range
 */
function isInsideMarkdownLink(pos: number, ranges: CodeRange[]): boolean {
  return ranges.some(r => pos >= r.start && pos < r.end)
}

/**
 * Check if ranges overlap
 */
function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Detect all links (URLs, emails, file paths) in text
 */
export function detectLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = []

  // 1. Detect URLs and emails with linkify-it
  const urlMatches = linkify.match(text) || []
  // linkify-it doesn't strip trailing asterisks from bold/italic markdown,
  // which causes broken links when URLs are wrapped like **url** or *url*
  // Note: _ and ~ are valid URL chars so we only strip *
  const trailingMarkdownRe = /\*+$/
  for (const match of urlMatches) {
    let matchText = match.text
    let matchUrl = match.url
    let matchEnd = match.lastIndex

    const stripped = matchText.replace(trailingMarkdownRe, '')
    if (stripped !== matchText) {
      const diff = matchText.length - stripped.length
      matchText = stripped
      matchUrl = matchUrl.replace(trailingMarkdownRe, '')
      matchEnd -= diff
    }

    links.push({
      type: match.schema === 'mailto:' ? 'email' : 'url',
      text: matchText,
      url: matchUrl,
      start: match.index,
      end: matchEnd
    })
  }

  // 2. Detect file paths with custom regex
  // Reset regex state
  FILE_PATH_REGEX.lastIndex = 0
  let fileMatch
  while ((fileMatch = FILE_PATH_REGEX.exec(text)) !== null) {
    const path = fileMatch[1]
    if (!path) continue // Skip if no capture group

    // Calculate actual start position (after any leading whitespace/punctuation)
    const fullMatch = fileMatch[0]
    const pathOffset = fullMatch.indexOf(path)
    const start = fileMatch.index + pathOffset

    links.push({
      type: 'file',
      text: path,
      url: path, // File paths are passed as-is to onFileClick handler
      start,
      end: start + path.length
    })
  }

  // linkify-it treats "SKILL.md" as a fuzzy host (http://SKILL.md). A longer
  // local path that contains that span (D:\…\SKILL.md) must win.
  const files = links.filter((link) => link.type === 'file')
  const others = links.filter((link) => link.type !== 'file')
  const keptOthers = others.filter((link) =>
    !files.some((file) => file.start <= link.start && file.end >= link.end),
  )
  const keptFiles = files.filter((file) =>
    !keptOthers.some((link) => link.start <= file.start && link.end >= file.end),
  )

  return [...keptOthers, ...keptFiles].sort((a, b) => a.start - b.start)
}

/**
 * Detect placeholder/fabricated URLs that the AI generated without knowing the real URL.
 * These are URLs like `https://github.com/...` or `https://example.com/...`
 * that should be stripped back to inline code instead of rendered as links.
 */
const PLACEHOLDER_URL_PATTERN = /\/\.\.\.(?:[)/\s#?]|$)/

/**
 * Check if a URL looks like a placeholder/fabricated URL.
 * Returns true for URLs containing path segments like `/...`
 */
export function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_URL_PATTERN.test(url)
}

/**
 * Strip markdown links with placeholder URLs back to plain text.
 * Converts `[text](https://github.com/...)` → `text`
 * Respects code blocks — links inside fenced or inline code are not touched.
 */
function stripPlaceholderLinks(text: string): string {
  const codeRanges = findCodeRanges(text)
  // Match markdown links [text](url) where url contains placeholder patterns
  return text.replace(
    /\[([^\[\]]*)\]\(([^)]*)\)/g,
    (fullMatch, linkText: string, url: string, offset: number) => {
      // Don't modify links inside code blocks
      if (isInsideCode(offset, codeRanges)) return fullMatch

      if (isPlaceholderUrl(url)) {
        // Strip the link, keep just the display text as plain text
        if (!linkText.trim()) return fullMatch
        return linkText
      }
      return fullMatch
    }
  )
}

/**
 * CommonMark treats an unquoted destination as ending at the first space.
 * AI often writes `[报告](D:\巡察工作\my file.md)` which then is not a link.
 * Wrap those destinations in `<>` so the click handler still receives the full path.
 */
function wrapSpacedFileDestinations(text: string): string {
  const codeRanges = findCodeRanges(text)
  const inlineLinkStartRegex = /\[([^\]\n]*)\]\(/g
  let result = ''
  let lastIndex = 0
  let match

  while ((match = inlineLinkStartRegex.exec(text)) !== null) {
    const destinationStart = inlineLinkStartRegex.lastIndex
    const destinationEnd = findInlineLinkDestinationEnd(text, destinationStart)
    if (destinationEnd < 0) continue

    // Continue after this link rather than interpreting parenthesized pieces of
    // its destination as another markdown link.
    inlineLinkStartRegex.lastIndex = destinationEnd + 1

    if (isInsideCode(match.index, codeRanges)) continue

    const destination = text.slice(destinationStart, destinationEnd)
    const trimmed = destination.trim()
    if (!trimmed || trimmed.startsWith('<') || /^(https?|mailto|ftp):/i.test(trimmed)) continue
    // A plain destination only needs repair when CommonMark punctuation can
    // split it. Balanced parentheses are valid, but wrapping them too keeps the
    // parser from mistaking a filename suffix for the link's closing delimiter.
    if (!/[\s()]/.test(trimmed)) continue
    // Destination with a markdown title: [text](path "title") — leave alone
    if (/\s+['"]/.test(trimmed)) continue
    // CommonMark <dest> cannot contain `>`
    if (trimmed.includes('>')) continue
    if (!isFilePathTarget(trimmed) && !/^[A-Za-z]:[\\/]/.test(trimmed) && !/[\\/]/.test(trimmed)) continue

    result += text.slice(lastIndex, match.index)
    result += `[${match[1]}](<${trimmed}>)`
    lastIndex = destinationEnd + 1
  }

  return result + text.slice(lastIndex)
}

export function preprocessLinks(text: string): string {
  // First pass: strip markdown links with placeholder/fabricated URLs
  // (e.g., AI-generated `[commit](https://github.com/...)` → `\`commit\``)
  text = stripPlaceholderLinks(text)
  text = wrapSpacedFileDestinations(text)

  // Quick check - if no potential links, return early
  if (!linkify.pretest(text) && !FILE_PATH_PRETEST_REGEX.test(text)) {
    return text
  }

  const codeRanges = findCodeRanges(text)
  const markdownLinkRanges = findMarkdownLinkRanges(text)
  const links = detectLinks(text)

  if (links.length === 0) return text

  // Build result, converting raw links to markdown links
  let result = ''
  let lastIndex = 0

  for (const link of links) {
    // Skip if inside code block
    if (isInsideCode(link.start, codeRanges)) continue

    // Skip if inside an existing markdown link (text or href portion)
    if (isInsideMarkdownLink(link.start, markdownLinkRanges)) continue

    // Add text before this link
    result += text.slice(lastIndex, link.start)

    // Convert to markdown link
    result += `[${link.text}](${link.url})`

    lastIndex = link.end
  }

  // Add remaining text
  result += text.slice(lastIndex)

  return result
}

/**
 * Test if text contains any detectable links
 * Useful for optimization - skip preprocessing if no links present
 */
export function hasLinks(text: string): boolean {
  return linkify.pretest(text) || FILE_PATH_PRETEST_REGEX.test(text)
}

/**
 * Check whether a markdown anchor target should be treated as a local file path.
 * Used by click handlers to route local paths to onFileClick instead of onUrlClick.
 *
 * Must accept Windows drive paths and Unicode (Chinese) workspace segments.
 * Must NOT treat `github.com/foo` or `https://…` as files.
 */
export function isFilePathTarget(target: string): boolean {
  const raw = target.trim()
  if (!raw || WEB_SCHEME_RE.test(raw) || /^file:/i.test(raw)) return false

  const t = raw.includes('%')
    ? (() => { try { return decodeURIComponent(raw) } catch { return raw } })()
    : raw

  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (t.startsWith('\\\\')) return true
  if (t.startsWith('/') || t.startsWith('~/') || t.startsWith('./') || t.startsWith('../')) return true

  const unixified = t.replace(/\\/g, '/')
  const first = unixified.split('/')[0] || ''
  // first segment looks like a hostname (example.com) → web, not a local file
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(first) && !KNOWN_EXT_RE.test(first)) {
    return false
  }

  if (KNOWN_EXT_RE.test(unixified)) return true
  // Explicit markdown dest with path separators (folder or extensionless file)
  if (unixified.includes('/')) return true

  return false
}
