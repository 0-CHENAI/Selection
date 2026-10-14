import { describe, expect, it } from 'bun:test'
import { splitOpenRichFence } from '../streaming-rich-fence'

describe('splitOpenRichFence', () => {
  it('withholds an unclosed datatable fence while streaming', () => {
    const text = '结果如下。\n\n```datatable\n{\n  "title": "模拟'
    expect(splitOpenRichFence(text)).toEqual({ body: '结果如下。\n\n', pending: 'datatable' })
  })
  it('keeps closed rich fences and plain code that is still open', () => {
    const closed = '```mermaid\ngraph TD\nA-->B\n```\n\n后文'
    expect(splitOpenRichFence(closed)).toEqual({ body: closed })
    const code = '代码：\n```python\nprint(1)'
    expect(splitOpenRichFence(code)).toEqual({ body: code })
  })
  it('ignores rich fence names quoted inside another open fence and handles tildes', () => {
    const nested = '````md\n```datatable\n'
    expect(splitOpenRichFence(nested)).toEqual({ body: nested })
    expect(splitOpenRichFence('前\n~~~mermaid\ngraph')).toEqual({ body: '前\n', pending: 'mermaid' })
  })
})
