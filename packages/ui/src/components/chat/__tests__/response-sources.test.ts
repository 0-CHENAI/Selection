import { expect, it } from 'bun:test'
import { extractResponseSources } from '../response-sources'

it('collapses explicit sources, deduplicates URLs, and preserves text offsets', () => {
  const text = '正文 [普通链接](https://other.com)\n\n主要来源：[文档](https://example.com/docs#one)、[同文档](https://example.com/docs#two)、[博客](https://example.com/blog)\n\n后续正文'
  const result = extractResponseSources(text)
  expect(result.sources.map(s => s.url)).toEqual(['https://example.com/docs#one', 'https://example.com/blog'])
  expect(result.content).toContain('[普通链接](https://other.com)')
  expect(result.content.indexOf('后续正文')).toBe(text.indexOf('后续正文'))
  expect(result.content).not.toContain('主要来源')
})
it('supports reference links and a dedicated bibliography section', () => {
  const result = extractResponseSources('## 参考资料\n\n- [文档][ref]\n\n## 下一节\n\n[普通](https://other.com)\n\n[ref]: https://example.com')
  expect(result.sources).toHaveLength(1)
  expect(result.content).toContain('## 下一节')
  expect(result.content).toContain('[普通]')
})
it('does not collect files, code samples, ordinary links or unsafe URLs', () => {
  expect(extractResponseSources('[正常](https://example.com)\n\n`来源：[示例](https://sample.com)`').sources).toHaveLength(0)
  const text = '来源：[文件](/report.docx)、[下载](https://example.com/report.docx)、[危险](javascript:alert)'
  expect(extractResponseSources(text)).toEqual({content: text, sources: []})
})
it('collects cited research pages without requiring a Sources heading', () => {
  const text = '根据[官方文档](https://example.com/docs#part)可以确认。另见 https://example.com/blog 。'
  const result = extractResponseSources(text, new Set(['https://example.com/docs','https://example.com/blog','https://unused.com/']))
  expect(result.sources.map(source => source.url)).toEqual(['https://example.com/docs#part','https://example.com/blog'])
  expect(result.content).toBe(text)
})
it('does not list searched-but-uncited pages, ordinary links or code examples', () => {
  const result = extractResponseSources('[登录](https://login.com) `https://example.com/docs`', new Set(['https://example.com/docs']))
  expect(result.sources).toHaveLength(0)
})
it('recognizes reference-style citations in tables', () => {
  const text = '|结论|依据|\n|---|---|\n|成立|[1][ref]|\n\n[ref]: https://example.com/docs'
  expect(extractResponseSources(text,new Set(['https://example.com/docs'])).sources).toHaveLength(1)
})
it('folds bold standalone source labels and publisher suffixes into one source shelf', () => {
  const text = '结论\n\n**参考来源**\n\n- [官网](https://official.com)\n- [报道](https://news.com)（媒体名称）\n\n## 其他说明\n\n保留此处'
  const result = extractResponseSources(text)
  expect(result.sources).toHaveLength(2)
  expect(result.content).not.toContain('参考来源')
  expect(result.content).not.toContain('[报道]')
  expect(result.content).toContain('其他说明')
  expect(result.content.indexOf('保留此处')).toBe(text.indexOf('保留此处'))
})
it('folds a bold inline source label but preserves explanatory text', () => {
  const folded = extractResponseSources('**参考来源：**[官网](https://official.com)')
  expect(folded.sources).toHaveLength(1)
  expect(folded.content.trim()).toBe('')
  const text = '## 参考来源\n\n根据[官网](https://official.com)，数据仅代表测试条件。'
  expect(extractResponseSources(text).content).toContain('数据仅代表测试条件')
})

it('buffers streaming bibliography links before Markdown delimiters are complete', () => {
  for (const heading of ['## 参考来源', '**参考来源**']) {
    const prefix = '正文 [正常引用](https://body.com)\n\n' + heading + '\n\n'
    const list = '- [官网](https://official.com)\n- [报道](https://news.com)'
    for (let end = 0; end <= list.length; end++) {
      const text = prefix + list.slice(0, end)
      const result = extractResponseSources(text, new Set(), true)
      expect(result.content).toContain('[正常引用](https://body.com)')
      expect(result.content.slice(prefix.indexOf(heading)).trim()).toBe('')
      expect(result.content.length).toBe(text.length)
    }
    const result = extractResponseSources(prefix + list)
    expect(result.sources).toHaveLength(2)
    expect(result.content.slice(prefix.indexOf(heading)).trim()).toBe('')
  }
})
it('buffers inline source labels and resumes body text after a source section', () => {
  expect(extractResponseSources('来源：[官网](https://off', new Set(), true).content.trim()).toBe('')
  const text = '## 参考来源\n\n- [官网](https://official.com)\n\n## 限制\n\n正文仍然显示'
  const result = extractResponseSources(text, new Set(), true)
  expect(result.content).not.toContain('[官网]')
  expect(result.content).toContain('## 限制')
  expect(result.content.indexOf('正文仍然显示')).toBe(text.indexOf('正文仍然显示'))
})

it('preserves images, code, and explanatory lists during and after streaming', () => {
  for (const suffix of ['![图示](/figure.png)', '\n  \`\`\`js\n  123\n  \`\`\`', '<img src="/figure.png">', '具体说明不能删除']) {
    const text = '## 参考来源\n\n- [官网](https://official.com) ' + suffix
    for (const streaming of [false, true]) {
      const result = extractResponseSources(text, new Set(), streaming)
      expect(result.content).toContain(suffix)
    }
  }
})
it('does not treat later body lists as part of an unheaded bibliography', () => {
  const text = '**参考来源**\n\n- [官网](https://official.com)\n\n继续阅读：\n\n- [操作入口](https://app.com)'
  const result = extractResponseSources(text)
  expect(result.sources.map(source => source.url)).toEqual(['https://official.com/'])
  expect(result.content).toContain('[操作入口]')
})

it('keeps bibliography geometry stable for every streamed prefix including publisher suffixes', () => {
  const body = '已完成的正文。\n\n'
  for (const heading of ['## 参考来源', '**参考来源**']) {
    for (const publisher of ['（官方文档）', '(Official documentation)']) {
      const tail = heading + '\n\n- [官网](https://official.com)' + publisher + '\n- [报道](https://news.com)' + publisher
      for (let end = 1; end <= tail.length; end++) {
        const input = body + tail.slice(0, end)
        const result = extractResponseSources(input, new Set(), true)
        expect(result.content.trim()).toBe(body.trim())
        expect(result.content.length).toBe(input.length)
      }
      expect(extractResponseSources(body + tail).content.trim()).toBe(body.trim())
    }
  }
})
it('restores unfinished metadata and ordinary headings when a stream ends', () => {
  const unfinished = '## 参考来源\n\n- [官网](https://official.com)（未完成说明'
  expect(extractResponseSources(unfinished).content).toContain('未完成说明')
  const ordinary = '## 参考架构\n\n正常正文'
  expect(extractResponseSources(ordinary, new Set(), true).content).toBe(ordinary)
})
