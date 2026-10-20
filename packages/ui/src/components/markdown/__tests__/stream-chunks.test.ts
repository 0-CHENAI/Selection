import { expect, test } from 'bun:test'
import { unified } from 'unified'
import type { Root, RootContent, Element } from 'hast'
import { STREAM_ARRIVAL_LIMIT, createStreamArrivalChunks, rehypeStreamChunks, splitRevealText } from '../rehype-stream-chunks'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

test('each short arrival gets a new run without changing already received runs', () => {
  const split = createStreamArrivalChunks()
  expect(split('你', '/p')).toEqual(['你'])
  expect(split('你好', '/p')).toEqual(['你', '好'])
  expect(split('你好世界', '/p')).toEqual(['你', '好', '世界'])
  expect(split('你好世界', '/p')).toEqual(['你', '好', '世界'])
  expect(split('修正', '/p')).toEqual(['修正'])
  expect(split('另一段', '/other')).toEqual(['另一段'])
})

test('a long stream folds settled arrivals instead of keeping one span per token', () => {
  const split = createStreamArrivalChunks()
  let text = ''
  for (let i = 0; i < 80; i++) {
    text += '字'
    const chunks = split(text, '/p')
    expect(chunks.join('')).toBe(text)
    expect(chunks.length).toBeLessThanOrEqual(STREAM_ARRIVAL_LIMIT)
  }
  // The paragraph stopped growing. The next pass must not keep a span per token.
  expect(split(text, '/p')).toEqual([text])
})

test('arrival boundaries do not break combining characters or emoji', () => {
  const split = createStreamArrivalChunks()
  split('e', '/a')
  expect(split('é', '/a')).toEqual(['é'])
  split('👨', '/b')
  expect(split('👨‍👩‍👧‍👦', '/b')).toEqual(['👨‍👩‍👧‍👦'])
})

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

test('source ranges distinguish an old label from a new tail after delimiter completion', () => {
  const split = createStreamArrivalChunks()
  const processor = unified().use(remarkParse).use(remarkRehype).use(rehypeStreamChunks, { split })
  const render = (source: string) => processor.runSync(processor.parse(source), { value: source })
  render('结论：**原文')
  const tree = render('结论：**原文**新增')
  expect(tree.children[0]).toMatchObject({ children: [
    { properties: { 'data-stream-start': 0, 'data-stream-end': 3 } },
    { tagName: 'strong', children: [{ properties: { 'data-stream-start': 5, 'data-stream-end': 7 } }] },
    { properties: { 'data-stream-start': 9, 'data-stream-end': 11 } },
  ] })
})

test('retains nested-list punctuation when rehype-raw supplies an incomplete position', () => {
  const source = '1. **父项**：\n   - 子项\n\n尾部'
  const parser = unified().use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
  const tree = parser.runSync(parser.parse(source), { value: source })
  const textNodes: Array<{ value: string; position?: { start?: unknown; end?: unknown } }> = []
  const collect = (node: Root | RootContent) => {
    if (node.type === 'text') textNodes.push(node)
    if ('children' in node) node.children.forEach(collect)
  }
  collect(tree)
  const generated = textNodes.find(node => node.value === '：\n')!
  expect(generated.position?.start).toBeDefined()
  expect(generated.position?.end).toBeUndefined()
  expect(() => unified().use(rehypeStreamChunks).runSync(tree, { value: source })).not.toThrow()
  const chunks: Element[] = []
  const collectChunks = (node: Root | RootContent) => {
    if (node.type === 'element' && node.properties['data-stream-chunk'] === '') chunks.push(node)
    if ('children' in node) node.children.forEach(collectChunks)
  }
  collectChunks(tree)
  const punctuation = chunks.find(node => node.children[0]?.type === 'text' && node.children[0].value === '：\n')!
  expect(punctuation).toBeDefined()
  expect(punctuation.properties['data-stream-start']).toBeUndefined()
  expect(punctuation.properties['data-stream-end']).toBeUndefined()
})
