import type { Root, Element, RootContent } from 'hast'
import type { Plugin } from 'unified'

const skip = new Set(['pre', 'code', 'svg', 'math', 'script', 'style', 'textarea'])
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Stable inline runs: preserve text, whitespace and the React tree at completion. */
export function splitRevealText(text: string): string[] {
  const letters = Array.from(segmenter.segment(text), part => part.segment)
  // Fixed boundaries keep already-visible runs intact as the paragraph grows.
  // The animation controller separately bounds layout reads per frame.
  const size = 8
  const runs: string[] = []
  for (let index = 0; index < letters.length; index += size) {
    runs.push(letters.slice(index, index + size).join(''))
  }
  return runs
}

export const rehypeStreamChunks: Plugin<[], Root> = () => tree => {
  function walk(parent: Root | Element) {
    if (parent.type === 'element') {
      const classes = parent.properties.className
      if (skip.has(parent.tagName) || (Array.isArray(classes) && classes.some(c => String(c).startsWith('katex')))) return
    }
    parent.children = parent.children.flatMap((node): RootContent[] => {
      if (node.type === 'element') { walk(node); return [node] }
      if (node.type !== 'text' || !node.value.trim()) return [node]
      return splitRevealText(node.value).map(value => ({
        type: 'element', tagName: 'span', properties: { 'data-stream-chunk': '' },
        children: [{ type: 'text', value }],
      }))
    }) as typeof parent.children
  }
  walk(tree)
}
