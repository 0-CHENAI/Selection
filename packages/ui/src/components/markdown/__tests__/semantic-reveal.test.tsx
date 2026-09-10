import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// Bun does not implement Vite's ?url asset loader.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
const { Markdown } = await import('../Markdown')
import { getRevealUnits, SEMANTIC_REVEAL_MAX_MS } from '../useSemanticReveal'

const content = '# 标题🙂\n\n第一段 [引用][source] 和脚注[^note]。\n\n- one\n- two\n\n> quoted\n\n```text\n完整代码\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[source]: https://example.com\n\n[^note]: 完整脚注\n'

describe('semantic reveal preserves the whole document', () => {
  it('uses the same complete Markdown rendering while live, completed and historical', () => {
    const render = (props: object) => renderToStaticMarkup(<Markdown {...props}>{content}</Markdown>)
    const historical = render({})
    expect(render({ isStreaming: true })).toBe(historical)
    expect(render({ revealStartTime: Date.now() })).toBe(historical)
    expect(historical).toContain('href="https://example.com"')
    expect(historical).toContain('完整脚注')
    expect(historical).toContain('<table')
    expect(historical).toContain('<blockquote')
    expect(historical).toContain('完整代码')
  })
  it('keeps long paragraphs and selection text complete on the first frame', () => {
    const paragraph = '长段落 mixed English 🙂 '.repeat(300)
    const html = renderToStaticMarkup(<Markdown revealStartTime={Date.now()}>{paragraph}</Markdown>)
    expect(html).toContain(paragraph.trim())
    expect(SEMANTIC_REVEAL_MAX_MS).toBeLessThan(500)
  })
  it('selects outer semantic units, without nested paragraph/list/preview animations', () => {
    const paragraph = { parentElement: { closest: () => null } }
    const listItem = { parentElement: { closest: () => null } }
    const nestedParagraph = { parentElement: { closest: () => listItem } }
    const preview = { parentElement: { closest: () => null } }
    const pre = { parentElement: { closest: () => preview } }
    const elements = [paragraph, listItem, nestedParagraph, preview, pre]
    const root = { querySelectorAll: () => elements, contains: (node: unknown) => elements.includes(node as typeof paragraph) }
    expect(getRevealUnits(root as unknown as HTMLElement)).toEqual([paragraph, listItem, preview])
  })
})
