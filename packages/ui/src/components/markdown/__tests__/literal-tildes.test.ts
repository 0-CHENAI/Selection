import { expect, test } from 'bun:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { remarkLiteralTildes } from '../remark-literal-tildes'
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkLiteralTildes)

test('single and double tildes remain literal, including multiple numerical ranges', () => {
  for (const text of ['Temperature 0.8~1.2 或 Top P 0.9~0.98', '~~原文~~', '0~0.3']) {
    const tree = parser.parse(text)
    expect(tree.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: text }] })
  }
})
test('GFM tables, task lists and tilde code fences still work', () => {
  expect(parser.parse('A | B\n--- | ---\n1 | 2').children[0]?.type).toBe('table')
  expect(parser.parse('- [x] done').children[0]).toMatchObject({ type: 'list', children: [{ checked: true }] })
  expect(parser.parse('~~~txt\n0.8~1.2\n~~~').children[0]).toMatchObject({ type: 'code', value: '0.8~1.2' })
})
