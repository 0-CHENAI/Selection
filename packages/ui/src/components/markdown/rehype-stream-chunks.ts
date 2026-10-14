import type { Root, Element, RootContent } from 'hast'
import type { Plugin } from 'unified'

const skip = new Set(['pre', 'code', 'svg', 'math', 'script', 'style', 'textarea'])
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Per-message arrival boundaries: never append new text into an old fade. */
export function createStreamArrivalChunks() {
  const nodes = new Map<string, { text: string; chunks: string[] }>()
  return (text: string, path: string): string[] => {
    const previous = nodes.get(path)
    if (previous?.text === text) return previous.chunks
    const chunks = previous && text.startsWith(previous.text)
      ? [...previous.chunks, text.slice(previous.text.length)]
      : [text]
    if (chunks.length > 1) {
      const tail = chunks.at(-2)! + chunks.at(-1)!
      const boundary = chunks.at(-2)!.length
      if (segmenter.segment(tail).containing(boundary)?.index !== boundary) {
        // A combining mark/ZWJ may finish the previous grapheme in a later delta.
        chunks.splice(-2, 2, tail)
      }
    }
    nodes.set(path, { text, chunks })
    return chunks
  }
}

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

export const rehypeStreamChunks: Plugin<[{ split?: ReturnType<typeof createStreamArrivalChunks> }?], Root> = (options = {}) => (tree, file) => {
  const source = String(file.value ?? '')
  function walk(parent: Root | Element, path = '') {
    if (parent.type === 'element') {
      const classes = parent.properties.className
      if (skip.has(parent.tagName) || (Array.isArray(classes) && classes.some(c => String(c).startsWith('katex')))) return
    }
    parent.children = parent.children.flatMap((node, index): RootContent[] => {
      const key = `${path}/${index}`
      if (node.type === 'element') { walk(node, key); return [node] }
      if (node.type !== 'text' || !node.value.trim()) return [node]
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      const exact = start != null && end != null && source.slice(start, end) === node.value
      let consumed = 0
      return (options.split ? options.split(node.value, key) : splitRevealText(node.value)).map(value => {
        const properties: Element['properties'] = { 'data-stream-chunk': '' }
        if (start != null && end != null) {
          // Escapes/entities can change source length. Use the whole source
          // range there rather than guessing offsets and replaying old text.
          properties['data-stream-start'] = exact ? start + consumed : start
          properties['data-stream-end'] = exact ? start + consumed + value.length : end
        }
        consumed += value.length
        return {
          type: 'element', tagName: 'span', properties,
          children: [{ type: 'text', value }],
        }
      })
    }) as typeof parent.children
  }
  walk(tree)
}
