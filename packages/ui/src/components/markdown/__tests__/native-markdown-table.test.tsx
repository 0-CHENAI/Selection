import * as React from 'react'
import { beforeAll, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
let Markdown: typeof import('../Markdown').Markdown
beforeAll(async () => { ({ Markdown } = await import('../Markdown')) })
const content = '| 维度 | 结果 |\n| --- | --- |\n| **输出** | [官方文档](https://example.com/docs) |\n| 接口 | `State → Decisions` |'
it('uses native table controls for ordinary tables and retains rich cells', () => {
  for (const mode of ['minimal', 'full'] as const) {
    const html = renderToStaticMarkup(<TooltipProvider><Markdown mode={mode}>{content}</Markdown></TooltipProvider>)
    expect(html).toContain('datatable.defaultTitle')
    expect(html).toContain('<strong')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('State → Decisions')
    expect(html).not.toContain('__markdownRow')
  }
})
it('keeps terminal output as a plain table', () => {
  const html = renderToStaticMarkup(<Markdown mode="terminal">{content}</Markdown>)
  expect(html).toContain('<table')
  expect(html).not.toContain('datatable.defaultTitle')
})

it('retains rich headers in native tables', () => {
  const text = '| **标题** | `接口` |\n| --- | --- |\n| 文本 | 值 |'
  const html = renderToStaticMarkup(<TooltipProvider><Markdown mode="minimal">{text}</Markdown></TooltipProvider>)
  expect(html).toMatch(/<th[^]*?<strong[^>]*>[^]*?标题[^]*?<\/strong>/)
  expect(html).toMatch(/<th[^]*?<code[^>]*>接口<\/code>/)
})

it('preserves captions and merged cells instead of dropping complex HTML structure', () => {
  const text = '<table><caption>合并表格</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td colspan="2">完整内容</td></tr></tbody></table>'
  const html = renderToStaticMarkup(<TooltipProvider><Markdown mode="minimal">{text}</Markdown></TooltipProvider>)
  expect(html).toContain('colSpan="2"')
  expect(html).toMatch(/<caption>[^]*?合并表格[^]*?<\/caption>/)
  expect(html).toContain('完整内容')
  expect(html).not.toContain('datatable.defaultTitle')
})
