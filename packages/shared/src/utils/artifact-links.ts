import { marked } from 'marked'

/** Local links only. References and escaped Markdown are parsed, never guessed from prose. */
export function localArtifactLinks(markdown: string): string[] {
  const paths = new Set<string>()
  const add = (target: string) => {
    let path = target
    if (/^file:/i.test(path)) {
      try {
        const url = new URL(path.replace(/\\/g, '/'))
        path = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${url.pathname}` : url.pathname
        path = path.replace(/^\/([a-z]:\/)/i, '$1')
      } catch { return }
    } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return
    try { path = decodeURIComponent(path) } catch { /* Preserve malformed literal percent names. */ }
    if (path && !/[\x00-\x1f]/.test(path)) paths.add(path)
  }
  marked.walkTokens(marked.lexer(markdown), token => {
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
