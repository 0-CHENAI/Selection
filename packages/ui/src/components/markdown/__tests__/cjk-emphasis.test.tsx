import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
const { Markdown } = await import('../Markdown')

function render(content: string, props: object = {}) {
  return renderToStaticMarkup(<Markdown {...props}>{content}</Markdown>)
    .replace(/<span data-stream-chunk="">([\s\S]*?)<\/span>/g, '$1')
}

describe('CJK emphasis in shared Markdown rendering', () => {
  const report = [
    '### 结论先说',
    '**确实有用户公开反映 GPT-6.1 Sol 慢，但没有官方一手材料确认根因。**另有一宗 API 延迟事件。',
    '',
    '- **X：**9 月 30 日，一位用户评价模型不错。',
    '- **Reddit：**检索到 r/codex 讨论。',
    '',
    '**我的判断：**目前公开一手证据仍不充分。',
  ].join('\n')

  for (const mode of ['minimal', 'full', 'terminal'] as const) {
    for (const collapsible of [false, true]) {
      it(`renders Chinese punctuation next to bold markers (${mode}, collapsible=${collapsible})`, () => {
        const html = render(report, { mode, collapsible })
        expect(html).toMatch(/<strong[^>]*>确实有用户公开反映 GPT-6\.1 Sol 慢，但没有官方一手材料确认根因。<\/strong>另有/)
        for (const label of ['X：', 'Reddit：', '我的判断：']) {
          expect(html).toMatch(new RegExp(`<strong[^>]*>${label}</strong>`))
        }
        expect(html).not.toContain('**')
      })
    }
  }

  it('retains links, inline code and nested emphasis inside Chinese bold text', () => {
    const html = render('这是**“[来源](https://example.com)与 `code`、*复核*。”**之后的正文。')
    expect(html).toMatch(/<strong[^>]*>“<a /)
    expect(html).toContain('href="https://example.com"')
    expect(html).toMatch(/<code[^>]*>code<\/code>/)
    expect(html).toMatch(/<em[^>]*>复核<\/em>/)
    expect(html).toContain('。”</strong>之后的正文。')
  })

  it('keeps code, escaped markers and incomplete streaming delimiters literal', () => {
    for (const content of ['`**标签：**正文`', '```text\n**标签：**正文\n```', '\\*\\*标签：\\*\\*正文', '**尚未完成：']) {
      const html = render(content, { isStreaming: true })
      expect(html).toContain('**')
      expect(html).not.toContain('<strong')
    }
  })

  it('preserves standard English delimiter rules and existing emphasis', () => {
    expect(render('**foo.**bar')).toContain('**foo.**bar')
    expect(render('**bold** and *italic*')).toMatch(/<strong[^>]*>bold<\/strong> and <em[^>]*>italic<\/em>/)
    expect(render('~~原文~~；0.8~1.2')).toContain('~~原文~~；0.8~1.2')
  })
})
