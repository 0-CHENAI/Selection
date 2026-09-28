import { marked } from 'marked'

/** Keep Windows separators intact before Markdown treats `\.` as an escape. */
export function normalizeWindowsMarkdownLinkDestinations(markdown: string): string {
  let result = ''
  let cursor = 0
  while (cursor < markdown.length) {
    const start = markdown.indexOf('](', cursor)
    if (start < 0) break
    const destinationStart = start + 2
    let depth = 0
    let angled = false
    let end = destinationStart
    for (; end < markdown.length; end++) {
      const char = markdown[end]
      if (char === '\n' || char === '\r') break
      if (char === '<') angled = true
      else if (char === '>') angled = false
      else if (!angled && char === '(') depth++
      else if (!angled && char === ')') {
        if (depth === 0) break
        depth--
      }
    }
    if (markdown[end] !== ')') { cursor = destinationStart; continue }
    const raw = markdown.slice(destinationStart, end).trim()
    const path = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
    const windowsPath = /^[a-z]:\\/i.test(path) || /^file:\/\/\/[a-z]:\\/i.test(path) || /^\\\\[^\\]+\\/i.test(path)
    if (windowsPath && !/[<>\r\n]/.test(path) && (raw.startsWith('<') || !/\s/.test(path))) {
      result += markdown.slice(cursor, destinationStart) + `<${path.replace(/\\/g, '/')}>`
      cursor = end
    } else {
      result += markdown.slice(cursor, end)
      cursor = end
    }
  }
  return cursor === 0 ? markdown : result + markdown.slice(cursor)
}

/** Normalize local paths shared by Markdown links and explicit result selection. */
export function localArtifactPath(target: string): string | undefined {
  let path = target.trim()
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path.replace(/\\/g, '/'))
      if (url.protocol !== 'file:') return undefined
      const host = url.hostname
      path = /^[a-z]$/i.test(host) ? `${host.toUpperCase()}:${url.pathname}`
        : host && host.toLowerCase() !== 'localhost' ? `//${host}${url.pathname}` : url.pathname
    } catch { return undefined }
  }
  try { path = decodeURIComponent(path) } catch { /* Preserve malformed literal percent names. */ }
  path = path.replace(/^\/([a-z]:[\\/])/i, '$1')
  if (!path || /[\x00-\x1f]/.test(path)
    || /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined
  return path
}

/** Local links only. References and escaped Markdown are parsed, never guessed from prose. */
export function localArtifactLinks(markdown: string): string[] {
  const paths = new Set<string>()
  const add = (target: string) => {
    const path = localArtifactPath(target)
    if (path) paths.add(path)
  }
  marked.walkTokens(marked.lexer(normalizeWindowsMarkdownLinkDestinations(markdown)), token => {
    if (token.type === 'link' || token.type === 'image') add(token.href)
    if (token.type === 'code' && /^(?:markdown|html|image|pdf)-preview$/.test(token.lang ?? '')) {
      try {
        const spec = JSON.parse(token.text)
        for (const item of Array.isArray(spec) ? spec : [spec]) if (typeof item?.src === 'string') add(item.src)
      } catch { /* Invalid previews do not identify files. */ }
    }
  })
  return [...paths]
}

/** Helper scripts, drafts, and QA dumps live in the session data or plans folder, not in the result. */
export function isSessionScratchPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return /(?:^|\/)\{\{SESSION_PATH\}\}\/(?:data|plans)(?:\/|$)/.test(normalized)
    || /(?:^|\/)sessions\/[^/]+\/(?:data|plans)(?:\/|$)/.test(normalized)
}
