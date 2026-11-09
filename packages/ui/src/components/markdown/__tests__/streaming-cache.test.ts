import { describe, expect, test } from 'bun:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import { createStreamingMarkdownCache, remarkStreamingCache } from '../remark-streaming-cache'

const processor = () => unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkCjkFriendly)

describe('streaming Markdown parser cache', () => {
  test('matches the whole parser at every character, including lists, quotes and late definitions', () => {
    const documents = [
      '# 标题\n\n前文 **加粗** 与 [链接](https://example.com)。\n\n- 第一项\n\n- 第二项\n  - 嵌套\n\n> 引用\n>\n> 后段\n\n尾部\n---\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n末段',
      '  缩进前文\n\n    code\n\n第二段\n\n~~~text\n# inside\n~~~\n\n结尾',
      '第一段 [引用][source] 与脚注[^note]。\n\n第二段。\n\n[source]: https://example.com\n\n[^note]: 注释\n\n结尾',
      '第一段\n\n<div>\nraw\n\nsecond\n</div>\n\n结尾',
    ]
    for (const document of documents) {
      const full = processor()
      const cached = processor().use(remarkStreamingCache, { parse: createStreamingMarkdownCache() })
      for (let end = 1; end <= document.length; end++) {
        const source = document.slice(0, end)
        expect(cached.parse(source)).toEqual(full.parse(source))
      }
    }
  })
  test('parses only the open tail, preserves offsets and isolates plugin mutations', () => {
    const cache = createStreamingMarkdownCache()
    const parser = processor()
    const inputs: string[] = []
    const parse = (source: string) => { inputs.push(source); return parser.parse(source) }
    const prefix = '稳定段落。\n\n'.repeat(100)
    const first = cache(prefix + '末尾', parse)
    first.children.splice(0, 50)
    const second = cache(prefix + '末尾新增', parse)
    expect(inputs[1]).toBe('末尾新增')
    expect(second).toEqual(parser.parse(prefix + '末尾新增'))
    cache(prefix + '末尾新增', parse)
    expect(inputs).toHaveLength(2)
    expect(cache('替换为新消息', parse)).toEqual(parser.parse('替换为新消息'))
  })
  test('reparses earlier references for definitions inside lists and escaped or multiline labels', () => {
    const cases = [
      { label: 'x', definition: '- [x]: https://example.com' },
      { label: 'a\\]b', definition: '[a\\]b]: https://example.com' },
      { label: 'a b', definition: '[a\nb]: https://example.com' },
    ]
    for (const { label, definition } of cases) {
      const cache = createStreamingMarkdownCache()
      const parser = processor()
      const before = `前文 [引用][${label}]。\n\n第二段`
      cache(before, source => parser.parse(source))
      const after = before + '\n\n' + definition
      const full = parser.parse(after)
      expect(full.children[0]).toMatchObject({ children: [
        { type: 'text', value: '前文 ' }, { type: 'linkReference' }, { type: 'text', value: '。' },
      ] })
      expect(cache(after, source => parser.parse(source))).toEqual(full)
    }
  })
})
