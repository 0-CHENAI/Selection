import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const HTML_ARTIFACT_SCHEME = 'selection-html'

/** Grant only this document's directory, never the filesystem or workspace root. */
export async function htmlArtifactLocation(path: string, host: string) {
  if (!isAbsolute(path) || !/\.(?:html?|xhtml)$/i.test(path)) throw new Error('Expected an absolute HTML file path')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isFile()) throw new Error('HTML artifact is not a file')
  return { root: dirname(canonical), document: canonical, url: `${HTML_ARTIFACT_SCHEME}://${host}/${encodeURIComponent(basename(canonical))}` }
}

/** Canonical containment also rejects symlinks that escape the granted directory. */
export async function resolveHtmlArtifactResource(root: string, host: string, requestUrl: string, document?: string): Promise<string> {
  const url = new URL(requestUrl)
  if (url.protocol !== `${HTML_ARTIFACT_SCHEME}:` || url.host !== host || url.username || url.password) throw new Error('Invalid HTML artifact origin')
  const pathname = decodeURIComponent(url.pathname)
  const requested = resolve(root, `.${pathname}`)
  if (pathname.includes('\\') || pathname.includes('\0') || (requested !== document && pathname.split('/').some(part => part.startsWith('.')))) throw new Error('Invalid HTML artifact resource')
  const path = await realpath(requested)
  const within = relative(root, path)
  if (!within || (path !== document && within.split(sep).some(part => part.startsWith('.'))) || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !(await stat(path)).isFile()) throw new Error('HTML resource is outside its document directory')
  return path
}

/** External frames cannot reuse a document's local resource grant, even without a referrer. */
export function isHtmlArtifactRequestAllowed(host: string, request: {
  url: string; resourceType: string; referrer: string
  frame?: { url: string; parent?: { url: string } | null } | null
}): boolean {
  const sameOrigin = (value: string) => {
    try {
      const url = new URL(value.startsWith('blob:') ? value.slice(5) : value)
      return url.protocol === `${HTML_ARTIFACT_SCHEME}:` && url.host === host && !url.username && !url.password
    } catch { return false }
  }
  try {
    const protocol = new URL(request.url).protocol
    if (protocol !== `${HTML_ARTIFACT_SCHEME}:`) return request.url === 'about:blank' || ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(protocol)
    if (!sameOrigin(request.url)) return false
    if (request.resourceType === 'mainFrame') return true
    const frame = request.frame
    if (frame && frame.url !== 'about:blank' && frame.url !== '') return sameOrigin(frame.url)
    if (frame?.parent) return sameOrigin(frame.parent.url)
    return sameOrigin(request.referrer)
  } catch { return false }
}

export function isHtmlArtifactNavigationAllowed(url: string): boolean {
  try { return url === 'about:blank' || ['http:', 'https:', `${HTML_ARTIFACT_SCHEME}:`].includes(new URL(url).protocol) }
  catch { return false }
}
