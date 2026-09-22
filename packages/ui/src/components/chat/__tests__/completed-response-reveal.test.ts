import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Match the Vite asset loader in the Bun test environment. Module mocks are
// process-wide in Bun, so never null out shared UI modules (../../markdown,
// ../../overlay) — sibling test files need the real implementation.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
let ResponseCard: typeof import('../TurnCard').ResponseCard
beforeAll(async () => { ({ ResponseCard } = await import('../TurnCard')) })

const document = '# 完整🙂\n\n[引用][ref]\n\n```ts\nconst value = 1\n```\n\n[ref]: https://example.com\n'

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1
}

describe('completed response semantic reveal boundary', () => {
  it('renders full source and completed actions immediately for fresh and historical replies', () => {
    for (const start of [undefined, 1, Date.now()]) {
      const html = renderToStaticMarkup(React.createElement(ResponseCard, {
        text: document.repeat(100), isStreaming: false, isTurnComplete: true,
        completedRevealStartTime: start, onRegenerate: () => {},
      }))
      expect(countOccurrences(html, '完整🙂')).toBe(100)
      expect(html).toContain('const value = 1')
      expect(html).toContain('https://example.com')
      expect(html).toContain('common.copy')
      expect(html).toContain('chat.regenerate')
      expect(html).not.toContain('Streaming...')
    }
  })
})
