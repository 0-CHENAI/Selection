import { parse } from 'parse5'

type HtmlNode = { nodeName: string; value?: string; tagName?: string; childNodes?: HtmlNode[] }
const ignored = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'head', 'template'])
const blocks = new Set(['p', 'div', 'section', 'article', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Inert parsing and iterative traversal: no browser DOM, URL fetching or
 * recursive stack growth from deeply nested imported HTML. */
export function extractWorkbenchHtml(source: string): string {
  const output: string[] = []
  const stack: Array<HtmlNode | string> = [parse(source)]
  while (stack.length) {
    const entry = stack.pop()!
    if (typeof entry === 'string') { output.push(entry); continue }
    if (ignored.has(entry.tagName ?? '')) continue
    if (entry.nodeName === '#text') { output.push(entry.value ?? ''); continue }
    if (blocks.has(entry.tagName ?? '')) stack.push('\n')
    else if (entry.tagName === 'td' || entry.tagName === 'th') stack.push('\t')
    const children = entry.childNodes ?? []
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]!)
  }
  return output.join('')
}
