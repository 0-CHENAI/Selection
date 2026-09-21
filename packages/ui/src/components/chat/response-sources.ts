import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { sourceUrlKey } from './source-metadata'
import { visit } from 'unist-util-visit'
import type { RootContent, Nodes } from 'mdast'

export interface ResponseSource { url: string; title: string; hostname: string; description?: string }
const parser = unified().use(remarkParse).use(remarkGfm)
const sourceLabels = ['主要来源', '参考资料', '参考来源', '参考文献', '资料来源', '来源', 'sources', 'references']
const sourceLabel = /^(?:主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]?\s*$/i

function textOutsideLinks(node: Nodes): string {
  if (node.type === 'link' || node.type === 'linkReference') return ''
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  return 'children' in node ? node.children.map(child => textOutsideLinks(child)).join('') : ''
}

/** Collapse explicit source sections only; ordinary links remain in their original context. */
export function extractResponseSources(text: string, evidence: ReadonlySet<string> = new Set(), isStreaming = false): { content: string; sources: ResponseSource[] } {
  const tree = parser.parse(text)
  const definitions = new Map<string, string>()
  visit(tree, 'definition', node => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
  })
  const sources: ResponseSource[] = []
  const seen = new Set<string>()
  const ranges: Array<[number, number]> = []
  let sectionDepth: number | undefined
  let sectionHeading: RootContent | undefined
  for (const block of tree.children) {
    const plain: string[] = []
    visit(block, 'text', node => { plain.push(node.value) })
    // Hold a partial trailing label too, so its heading height never flashes
    // before the next token identifies it as a bibliography.
    if (isStreaming && block === tree.children.at(-1)
      && block.position && (block.type === 'heading' || block.type === 'paragraph'
        || /^\*{1,2}$/.test(text.slice(block.position.start.offset, block.position.end.offset)))) {
      const raw = text.slice(block.position.start.offset, block.position.end.offset)
      const label = raw.replace(/^#{1,6}\s*|^\*{1,2}/, '').replace(/\*{1,2}$/, '').trim().toLowerCase()
      if (sourceLabels.some(candidate => candidate.startsWith(label))) {
        ranges.push([block.position.start.offset!, block.position.end.offset!])
      }
    }
    if (block.type === 'heading') {
      sectionDepth = sourceLabel.test(plain.join('')) ? block.depth : undefined
      sectionHeading = sectionDepth ? block : undefined
      if (isStreaming && sectionHeading?.position) ranges.push([sectionHeading.position.start.offset!, sectionHeading.position.end.offset!])
      continue
    }
    // Models commonly use a bold standalone label instead of a Markdown heading.
    if (block.type === 'paragraph' && sourceLabel.test(plain.join(''))) {
      sectionDepth = 7
      sectionHeading = block
      if (isStreaming && block.position) ranges.push([block.position.start.offset!, block.position.end.offset!])
      continue
    }
    const first = block.type === 'paragraph' ? block.children[0] : undefined
    const explicit = (first?.type === 'text' || first?.type === 'strong') && /^(?:主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]/i.test(first.type === 'text' ? first.value : textOutsideLinks(first))
    const isSourceBlock = explicit || sectionDepth !== undefined
    if (block.type === 'definition') continue
    if (block.type === 'code') {
      sectionDepth = undefined
      sectionHeading = undefined
      continue
    }
    let count = 0
    let invalid = false
    let nonCitation = false
    visit(block, node => {
      if (['image', 'imageReference', 'code', 'inlineCode', 'html', 'table', 'blockquote'].includes(node.type)) nonCitation = true
      if (node.type !== 'link' && node.type !== 'linkReference') return
      const target = node.type === 'link' ? node.url : definitions.get(node.identifier)
      try {
        const url = new URL(target ?? '')
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { invalid = true; return }
        if (!isSourceBlock && !evidence.has(sourceUrlKey(url.href))) return
        // Download links belong to the reply, not its bibliography.
        if (/\.(?:docx?|xlsx?|pptx?|zip|7z|tar|gz)$/i.test(url.pathname)) { invalid = true; return }
        const title: string[] = []
        visit(node, 'text', child => { title.push(child.value) })
        const openUrl = url.href
        url.hash = ''
        count++
        if (seen.has(url.href)) return
        seen.add(url.href)
        sources.push({ url: openUrl, title: title.join('') || url.hostname, hostname: url.hostname })
      } catch { invalid = true }
    })
    const remaining = textOutsideLinks(block)
      .replace(/^(?:主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]/i, '')
    // Parenthesized publisher labels are citation metadata, not body prose.
    const citationRemainder = remaining.replace(/[（(][^()（）\n]{1,80}[)）]/g, '')
    // A publisher suffix is still metadata while its closing bracket is in flight.
    // Classify the unfinished suffix only for buffering, never for final removal.
    const streamingRemainder = citationRemainder.replace(/[（(][^()（）\n]{0,80}$/, '')
    const onlyCitation = /^[\s、，,;；:：.。()（）\[\]\d-]*$/.test(citationRemainder)
    // Buffer only citation-shaped unfinished blocks, never prose, images or code.
    const pending = isStreaming && isSourceBlock && block === tree.children.at(-1)
      && !invalid && !nonCitation
      && (block.type === 'list' || explicit || (block.type === 'paragraph'
        && text.slice(block.position?.start.offset).trimStart().startsWith('[')))
      && (/^[\s、，,;；:：.。()（）\[\]\d-]*$/.test(streamingRemainder) || /^[\s、，,;；:：.。\d-]*\[[^\]]*(?:\](?:\([^)]*)?)?$/.test(streamingRemainder))
    const folded = isSourceBlock && count > 0 && !invalid && !nonCitation && onlyCitation
    if ((pending || folded) && block.position) {
      ranges.push([block.position.start.offset!, block.position.end.offset!])
      if (sectionHeading?.position) {
        ranges.push([sectionHeading.position.start.offset!, sectionHeading.position.end.offset!])
        sectionHeading = undefined
      }
    } else if (sectionDepth !== undefined) {
      // A prose paragraph ends an unheaded bibliography; later link lists may be body content.
      sectionDepth = undefined
      sectionHeading = undefined
    }
  }
  // Preserve UTF-16 offsets so saved annotations still target the original message.
  const parts: string[] = []
  let cursor = 0
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (end <= cursor) continue
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(text.slice(Math.max(cursor, start), end).replace(/[^\r\n]/g, ' '))
    cursor = end
  }
  parts.push(text.slice(cursor))
  return { content: parts.join(''), sources }
}
