import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { FILE_EXTENSIONS_PATTERN } from '../../lib/file-classification'
const filename = new RegExp(`^[^\\s/\\\\]+\\.(?:${FILE_EXTENSIONS_PATTERN})$`, 'i')

/** GFM can autolink AGENTS.md as a domain. Keep implicit filename mentions as text. */
export function remarkFileMentions() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value ?? '')
    visit(tree, 'link', (node, index, parent) => {
      if (!parent || index === undefined || node.children.length !== 1 || node.children[0]?.type !== 'text') return
      const label = node.children[0].value
      const raw = source.slice(node.position?.start.offset, node.position?.end.offset)
      if (!filename.test(label) || raw !== label || !/^https?:\/\//i.test(node.url)) return
      parent.children.splice(index, 1, { type: 'text', value: label, position: node.position })
    })
  }
}
