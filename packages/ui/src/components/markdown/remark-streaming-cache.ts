import type { Root, RootContent } from 'mdast'
import type { Node } from 'unist'
import type { Parser, Plugin } from 'unified'

/** Cache the raw parse, before remark/rehype plugins mutate its nodes. */
export function createStreamingMarkdownCache() {
  let previous: { source: string; tree: Root } | undefined
  return (source: string, parse: (text: string) => Root): Root => {
    if (previous?.source === source) return structuredClone(previous.tree)
    // Definitions can resolve links/footnotes anywhere in the document. Raw
    // HTML can span block boundaries. Keep the authoritative whole parse there.
    // Labels may contain escaped brackets/newlines, and definitions inside
    // lists/quotes resolve earlier references too. Prefer a conservative full
    // parse over a partial grammar regex that misses those global dependencies.
    const globalSyntax = source.includes(']:') || source.includes('<')
    const last = previous?.tree.children.at(-1)
    const tailStart = last?.position?.start
    const offset = tailStart?.offset != null ? tailStart.offset - tailStart.column + 1 : 0
    let tree: Root
    if (!globalSyntax && previous && source.startsWith(previous.source) && offset > 0) {
      // Retain the entire last block: blank lines do not necessarily finish
      // lists, quotes, tables or fences. A later distinct block seals the prefix.
      const tail = parse(source.slice(offset))
      const lineOffset = (tailStart?.line ?? 1) - 1
      const shift = (node: Node) => {
        if (node.position) {
          for (const point of [node.position.start, node.position.end]) {
            point.line += lineOffset
            if (point.offset != null) point.offset += offset
          }
        }
        if ('children' in node) (node.children as Node[]).forEach(shift)
      }
      shift(tail)
      const prefix = previous.tree.children.slice(0, -1)
      tree = { ...tail, children: [...prefix, ...tail.children] as RootContent[], position: {
        start: previous.tree.position?.start ?? { line: 1, column: 1, offset: 0 },
        end: tail.position!.end,
      } }
    } else tree = parse(source)
    previous = { source, tree: structuredClone(tree) }
    return tree
  }
}

export const remarkStreamingCache: Plugin<[{ parse: ReturnType<typeof createStreamingMarkdownCache> }], Root> = function (cache) {
  const parser = this.parser as Parser<Root>
  this.parser = (source, file) => cache.parse(source, text => parser(text, file))
}
