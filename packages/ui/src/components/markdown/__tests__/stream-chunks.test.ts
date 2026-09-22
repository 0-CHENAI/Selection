import { expect, test } from 'bun:test'
import { unified } from 'unified'
import type { Root } from 'hast'
import { rehypeStreamChunks, splitRevealText } from '../rehype-stream-chunks'

test('preserves whitespace and complete emoji graphemes with stable small runs', () => {
  const text = '范围 0.8~1.2，👨‍👩‍👧‍👦 é '.repeat(20)
  const chunks = splitRevealText(text)
  expect(chunks.join('')).toBe(text)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  expect(chunks.every(chunk => [...segmenter.segment(chunk)].length <= 8)).toBe(true)
  expect(chunks.some(chunk => chunk.includes('👨‍👩‍👧‍👦'))).toBe(true)
})
test('text becomes inline runs while code and math stay untouched', () => {
  const tree: Root = { type: 'root', children: [
    { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: '这是需要渐显的一段普通文字。' }] },
    { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: 'const value = 1' }] },
    { type: 'element', tagName: 'span', properties: { className: ['katex'] }, children: [{ type: 'text', value: 'a+b' }] },
  ] }
  const originalCode = JSON.stringify(tree.children.slice(1))
  unified().use(rehypeStreamChunks).runSync(tree)
  expect(tree.children[0]).toMatchObject({ children: [{ tagName: 'span' }, { tagName: 'span' }] })
  expect(JSON.stringify(tree.children.slice(1))).toBe(originalCode)
})


test('keeps completed inline runs stable as a long paragraph grows', () => {
  const prefix = 'abcdefghijklmnop'.repeat(30)
  const old = splitRevealText(prefix)
  const next = splitRevealText(prefix + 'qrstuvwxyz'.repeat(20))
  expect(next.slice(0, old.length - 1)).toEqual(old.slice(0, -1))
  expect(next.length).toBeGreaterThan(old.length)
})
