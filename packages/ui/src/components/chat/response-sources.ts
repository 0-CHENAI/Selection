import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { sourceUrlKey } from './source-metadata'
import { visit } from 'unist-util-visit'
import type { RootContent, Nodes } from 'mdast'

export interface ResponseSource { url: string; title: string; hostname: string; description?: string }
const parser = unified().use(remarkParse).use(remarkGfm)
const sourceLabels = ['官方来源', '主要来源', '参考资料', '参考来源', '参考文献', '资料来源', '来源', 'sources', 'references']
const sourceLabel = /^(?:官方来源|主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]?\s*$/i

function textOutsideLinks(node: Nodes): string {
  if (node.type === 'link' || node.type === 'linkReference') return ''
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  return 'children' in node ? node.children.map(child => textOutsideLinks(child)).join('') : ''
}

function isPartialCitation(pendingText: string): boolean {
  const partialUrl = ['h', 'ht', 'htt', 'http', 'https', 'http:', 'https:', 'http:/', 'https:/'].includes(pendingText)
    || /^https?:\/\/\S*$/.test(pendingText)
  return /^[\s、，,;；:：.。()（）\[\]\d-]*$/.test(pendingText)
    || /^[\s、，,;；:：.。\d-]*\[[^\]]*(?:\](?:\([^)]*\)?|\[[^\]]*\]?)?)?$/.test(pendingText)
    || /^\[[^\]]+\]:\s*\S*$/.test(pendingText)
    || partialUrl
}

/** Collapse explicit source sections only; ordinary links remain in their original context. */
export function extractResponseSources(text: string, evidence: ReadonlySet<string> = new Set(), isStreaming = false): { content: string; sources: ResponseSource[] } {
  const tree = parser.parse(text)
  const definitions = new Map<string, string>()
  visit(tree, 'definition', node => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
  })
  const lastBlock = tree.children.at(-1)
  const trailingDefinition = isStreaming && lastBlock?.type === 'definition' ? lastBlock : undefined
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
      continue
    }
    // Models commonly use a bold standalone label instead of a Markdown heading.
    if (block.type === 'paragraph' && sourceLabel.test(plain.join(''))) {
      sectionDepth = 7
      sectionHeading = block
      continue
    }
    const first = block.type === 'paragraph' ? block.children[0] : undefined
    const explicit = (first?.type === 'text' || first?.type === 'strong') && /^(?:官方来源|主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]/i.test(first.type === 'text' ? first.value : textOutsideLinks(first))
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
    visit(block, (node, _index, parent) => {
      if (['image', 'imageReference', 'code', 'inlineCode', 'html', 'table', 'blockquote'].includes(node.type)) nonCitation = true
      if (node.type !== 'link' && node.type !== 'linkReference') return
      const target = node.type === 'link' ? node.url : definitions.get(node.identifier)
      // A reference definition may arrive after its list during streaming.
      if (isStreaming && node.type === 'linkReference' && (!target || node.identifier === trailingDefinition?.identifier)) return
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
        const suffix = parent?.type === 'paragraph' ? textOutsideLinks(parent).trim() : ''
        const description = isSourceBlock && /^(?:—|–|-|:|：)\s*/.test(suffix)
          ? suffix.replace(/^(?:—|–|-|:|：)\s*/, '').trim() || undefined : undefined
        sources.push({ url: openUrl, title: title.join('') || url.hostname, hostname: url.hostname, ...(description ? { description } : {}) })
      } catch { invalid = true }
    })
    const remaining = textOutsideLinks(block)
      .replace(/^(?:官方来源|主要来源|参考资料|参考来源|参考文献|资料来源|来源|sources|references)\s*[:：]/i, '')
    // Parenthesized publisher labels are citation metadata, not body prose.
    const citationRemainder = remaining.replace(/[（(][^()（）\n]{1,80}[)）]/g, '')
    // A publisher suffix is still metadata while its closing bracket is in flight.
    // Classify the unfinished suffix only for buffering, never for final removal.
    const streamingRemainder = citationRemainder.replace(/[（(][^()（）\n]{0,80}$/, '')
    // Markdown emphasis and list markers are often incomplete between deltas.
    // Strip them only for buffering, never when deciding final removal.
    const pendingText = streamingRemainder.replace(/[*_~]/g, '').trim()
    const partialCitation = isPartialCitation(pendingText)
    // A bibliography entry may annotate its leading link with a description.
    // Keep arbitrary prose, nested blocks and instructions in the answer.
    const annotatedList = isSourceBlock && block.type === 'list' && block.children.every((item, index) => {
      const pendingLast = isStreaming && index === block.children.length - 1
      if (!item.children.length) return pendingLast
      if (item.children.length !== 1 || item.children[0]?.type !== 'paragraph') return false
      const paragraph = item.children[0]
      if (!['link', 'linkReference'].includes(paragraph.children[0]?.type ?? '')) {
        const raw = paragraph.position ? text.slice(paragraph.position.start.offset, paragraph.position.end.offset) : ''
        return pendingLast && isPartialCitation(raw.replace(/[*_~]/g, '').trim())
      }
      if (paragraph.children.slice(1).some(child => child.type !== 'text')) return false
      const suffix = textOutsideLinks(paragraph).trim()
      return !suffix || /^(?:—|–|-|:|：)\s*/.test(suffix)
    })
    const onlyCitation = /^[\s、，,;；:：.。()（）\[\]\d-]*$/.test(citationRemainder)
    // Buffer citation-shaped blocks while definitions may still arrive later.
    // Never buffer explanatory prose, images or code.
    const pending = isStreaming && isSourceBlock
      && !invalid && !nonCitation
      && (block.type === 'list' || explicit || block.type === 'paragraph')
      && (partialCitation || annotatedList)
    const folded = isSourceBlock && count > 0 && !invalid && !nonCitation && (onlyCitation || annotatedList)
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
