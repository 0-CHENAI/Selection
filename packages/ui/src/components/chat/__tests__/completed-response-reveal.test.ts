import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Inspect the text and lifecycle passed by the actual response card. Markdown's
// document structure and animation behavior have separate renderer tests.
mock.module('../../markdown', () => ({
  Markdown: ({ children }: { children: string }) => React.createElement('pre', null, children),
}))
mock.module('../../overlay', () => ({ DocumentFormattedMarkdownOverlay: () => null }))
let ResponseCard: typeof import('../TurnCard').ResponseCard
beforeAll(async () => { ({ ResponseCard } = await import('../TurnCard')) })

const document = '# 完整🙂\n\n[引用][ref]\n\n```ts\nconst value = 1\n```\n\n[ref]: https://example.com\n'

describe('completed response semantic reveal boundary', () => {
  it('renders full source and completed actions immediately for fresh and historical replies', () => {
    for (const start of [undefined, 1, Date.now()]) {
      const html = renderToStaticMarkup(React.createElement(ResponseCard, {
        text: document.repeat(100), isStreaming: false, isTurnComplete: true,
        completedRevealStartTime: start, onRegenerate: () => {},
      }))
      expect(html).toContain(document.repeat(100))
      expect(html).toContain('common.copy')
      expect(html).toContain('chat.regenerate')
      expect(html).not.toContain('Streaming...')
    }
  })
})
