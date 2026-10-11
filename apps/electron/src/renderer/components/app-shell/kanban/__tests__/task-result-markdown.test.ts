import { describe, expect, it } from 'bun:test'
import { taskResultMarkdown } from '../task-result-markdown'

describe('task result Markdown compatibility', () => {
  it('restores escaped report paragraphs and numbered source lists', () => {
    const text = '官方侧结论。\\n\\n可复核证据：\\n1. [模型文档](https://example.com/model)\\n2. **状态记录**'
    const repaired = taskResultMarkdown(text)
    expect(repaired).toBe('官方侧结论。\n\n可复核证据：\n1. [模型文档](https://example.com/model)\n2. **状态记录**')
    expect(taskResultMarkdown(repaired)).toBe(repaired)
  })

  it('restores escaped CRLF, headings, lists and table rows', () => {
    expect(taskResultMarkdown('结论\\r\\n\\r\\n## 证据\\r\\n- 已核对'))
      .toBe('结论\n\n## 证据\n- 已核对')
    expect(taskResultMarkdown('来源\\n| 名称 | 状态 |\\n| --- | --- |\\n| 官方 | 已核对 |'))
      .toBe('来源\n| 名称 | 状态 |\n| --- | --- |\n| 官方 | 已核对 |')
  })

  it('preserves escapes inside code, paths and link destinations', () => {
    const code = '\x60String.raw("\\n\\n")\x60'
    const codeWithBacktick = '\x60\x60包含 \x60 与 \\n\\n\x60\x60'
    const path = 'C:\\notes\\new.txt'
    const link = '[原始样例](file:///tmp/example\\n\\n.txt)'
    const text = '结论\\n\\n1. ' + [code, codeWithBacktick, path, link].join(' · ') + ' \\n2. 核对完成'
    expect(taskResultMarkdown(text)).toBe('结论\n\n1. ' + [code, codeWithBacktick, path, link].join(' · ') + ' \n2. 核对完成')
  })

  it('leaves normal multiline Markdown and fenced code unchanged', () => {
    const text = '## 结论\n\n段落。\n\n\x60\x60\x60js\nconst text = "\\n\\n";\n\x60\x60\x60\n\n- 完成'
    expect(taskResultMarkdown(text)).toBe(text)
  })

  it('does not reinterpret plain text, structured JSON or deliberately escaped backslashes', () => {
    for (const text of [
      '说明换行字符 \\n。',
      '\x60转义示例 \\n\\n\x60',
      JSON.stringify({ text: '说明\\n\\n1. 示例' }),
      '转义示例 \\\\n\\\\n1. 保留',
      '路径 C:\\notes\\new.txt',
    ]) expect(taskResultMarkdown(text)).toBe(text)
  })
})
