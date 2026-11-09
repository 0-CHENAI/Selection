import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let ResponseCard: typeof import('../TurnCard').ResponseCard
let TurnCard: typeof import('../TurnCard').TurnCard
let InlineExecution: typeof import('../InlineExecution').InlineExecution

beforeAll(async () => {
  ;({ ResponseCard, TurnCard } = await import('../TurnCard'))
  ;({ InlineExecution } = await import('../InlineExecution'))
})

function buttonOpen(html: string, marker: string): string {
  const start = html.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const tagStart = html.lastIndexOf('<button', start)
  return html.slice(tagStart, html.indexOf('>', tagStart))
}

describe('retry shares the regenerate action row', () => {
  it('renders retry below the reply, in the same row and button chrome as regenerate', () => {
    const html = renderToStaticMarkup(React.createElement(ResponseCard, {
      text: '部分回复',
      isStreaming: false,
      isTurnComplete: true,
      onRegenerate: () => {},
      onRetry: () => {},
    }))
    const rowStart = html.indexOf('data-response-actions')
    expect(rowStart).toBeGreaterThanOrEqual(0)
    const row = html.slice(rowStart)
    const retryAt = row.indexOf('data-action="retry"')
    const regenerateAt = row.indexOf('data-action="regenerate"')
    expect(retryAt).toBeGreaterThanOrEqual(0)
    expect(regenerateAt).toBeGreaterThan(retryAt)
    expect(row).toContain('px-2.5')

    const retry = buttonOpen(html, 'data-action="retry"')
    const regenerate = buttonOpen(html, 'data-action="regenerate"')
    for (const token of ['turn-action-btn', 'text-muted-foreground', 'hover:text-foreground', 'focus-visible:underline', 'gap-1.5']) {
      expect(retry).toContain(token)
      expect(regenerate).toContain(token)
    }
    expect(retry).not.toContain('border-destructive')
    expect(retry).not.toContain('bg-accent')
    // Same glyph already used by regenerate. Do not introduce a second icon.
    expect(html.split('lucide-refresh-cw').length - 1).toBe(2)
  })

  it('uses the compact footer treatment when the reply is compact', () => {
    const html = renderToStaticMarkup(React.createElement(ResponseCard, {
      text: '部分回复',
      isStreaming: false,
      isTurnComplete: true,
      compactMode: true,
      onRegenerate: () => {},
      onRetry: () => {},
    }))
    expect(html).toMatch(/data-response-actions=""[^>]*class="[^"]*pl-2\.5 pr-2 py-1\.5/)
    expect(html).toContain('border-border/30')
    expect(html).toContain('bg-muted/20')
    expect(html).toContain('data-action="retry"')
    expect(html).toContain('data-action="regenerate"')
  })

  it('keeps a retry row under an interrupted turn that has no reply', () => {
    const html = renderToStaticMarkup(React.createElement(TurnCard, {
      turnId: 'stopped',
      activities: [],
      isStreaming: false,
      isComplete: true,
      onRetry: () => {},
    }))
    expect(html).toContain('data-response-actions')
    expect(html).toContain('data-action="retry"')
    expect(html).toContain('turn-action-btn')
    expect(html).not.toContain('data-action="regenerate"')
  })

  it('styles an inline execution failure retry like the message action button', () => {
    const html = renderToStaticMarkup(React.createElement(InlineExecution, {
      status: 'error',
      activities: [],
      error: '请求失败',
      onRetry: () => {},
      onDismiss: () => {},
    }))
    expect(html.indexOf('请求失败')).toBeLessThan(html.indexOf('data-action="retry"'))
    const retry = buttonOpen(html, 'data-action="retry"')
    expect(retry).toContain('turn-action-btn')
    expect(retry).toContain('text-muted-foreground')
    expect(html).not.toContain('bg-accent/10')
    expect(html).toContain('lucide-x')
  })
})
