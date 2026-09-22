import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import { decodeFilePath, resolveMarkdownLinkTarget } from '../markdown/link-target'
import { normalizePreviewItems, parseMarkdownPreviewSpec } from '../markdown/markdown-preview-helpers'
import { promoteBarePreviewBlocks } from '../markdown/promote-preview-blocks'

export interface ResponseArtifact {
  path: string
  name: string
  extension: string
}

const DOCUMENT_EXTENSIONS = new Set([
  'doc', 'docx', 'docm', 'odt', 'rtf', 'ppt', 'pptx', 'pptm', 'odp',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif',
  'md', 'markdown', 'mdx', 'txt', 'html', 'htm', 'json',
  'zip', 'tar', 'gz', '7z', 'mp3', 'wav', 'mp4', 'mov', 'webm',
])
const PREVIEW_BLOCKS = new Set(['markdown-preview', 'html-preview', 'image-preview', 'pdf-preview'])
const parser = unified().use(remarkParse)

/** Only files explicitly linked in the final reply; never infer outputs from tool logs or disk. */
export function extractResponseArtifacts(text: string): ResponseArtifact[] {
  const tree = parser.parse(promoteBarePreviewBlocks(text))
  const definitions = new Map<string, string>()
  visit(tree, 'definition', node => {
    const identifier = node.identifier.toLowerCase()
    // CommonMark uses the first definition, matching the link rendered in the reply.
    if (!definitions.has(identifier)) definitions.set(identifier, node.url)
  })
  const artifacts: ResponseArtifact[] = []
  const seen = new Set<string>()
  const add = (rawTarget: string) => {
    const target = rawTarget.trim()
    // Remote citations/downloads and data URLs are not local deliverables.
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return
    const resolved = resolveMarkdownLinkTarget(target)
    // The generic link resolver's preview extensions are narrower than deliverable
    // formats (e.g. docm/ods). Accept an explicitly linked relative file as well.
    const path = resolved.kind === 'file' ? resolved.path : decodeFilePath(target)
    if (!path || /[\x00-\x1f]/.test(path)) return
    if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return
    const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
    const name = normalized.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
    if (!DOCUMENT_EXTENSIONS.has(extension)) return
    const identity = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
    if (seen.has(identity)) return
    seen.add(identity)
    artifacts.push({ path, name, extension })
  }
  visit(tree, (node, _index, parent) => {
    // A linked thumbnail represents its target, not a second deliverable.
    if ((node.type === 'image' || node.type === 'imageReference')
      && (parent?.type === 'link' || parent?.type === 'linkReference')) return
    if (node.type === 'link' || node.type === 'image') add(node.url)
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier.toLowerCase())
      if (target) add(target)
    }
    if (node.type === 'code' && PREVIEW_BLOCKS.has(node.lang ?? '')) {
      for (const item of normalizePreviewItems(parseMarkdownPreviewSpec(node.value))) add(item.src)
    }
  })
  return artifacts
}
