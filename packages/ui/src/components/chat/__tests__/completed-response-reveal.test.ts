import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import type { ActivityItem } from '../TurnCard'

// Match the Vite asset loader in the Bun test environment. Module mocks are
// process-wide in Bun, so never null out shared UI modules (../../markdown,
// ../../overlay) — sibling test files need the real implementation.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
let ResponseCard: typeof import('../TurnCard').ResponseCard
let TurnCard: typeof import('../TurnCard').TurnCard
beforeAll(async () => { ({ ResponseCard, TurnCard } = await import('../TurnCard')) })

const document = '# 完整🙂\n\n[引用][ref]\n\n```ts\nconst value = 1\n```\n\n[ref]: https://example.com\n'

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1
}

describe('completed response semantic reveal boundary', () => {
  it('omits the entire action row from async start acknowledgments while retaining final reply actions', () => {
    const start: ActivityItem = { id: 'start', type: 'tool', timestamp: 1, status: 'completed',
      toolName: 'mcp__session__run_task', content: JSON.stringify({ runId: 'run', status: 'running' }) }
    const verdict: ActivityItem = { id: 'verdict', type: 'tool', timestamp: 2, status: 'completed',
      toolName: 'mcp__session__submit_task_verdict', content: JSON.stringify({ status: 'completed' }) }
    for (const animateResponse of [false, true]) {
      for (const [activities, progress] of [[[], false], [[start], true], [[{ ...start, status: 'error' }], false],
        [[{ ...start, content: '{invalid' }], false], [[start, verdict], false]] as [ActivityItem[], boolean][]) {
        const html = renderToStaticMarkup(React.createElement(TooltipProvider, null,
          React.createElement(TurnCard, { turnId: 'start', activities, isStreaming: false, isComplete: true,
            response: { text: '已启动调研。', isStreaming: false, messageId: 'reply' }, animateResponse,
            onRegenerate: () => {}, onPopOut: () => {}, onBranch: () => {},
          })))
        expect(html).toContain('已启动调研。')
        for (const action of ['common.copy', 'chat.regenerate', '>Markdown<', 'turn-action-btn']) {
          expect(html.includes(action)).toBe(!progress)
        }
      }
    }
  })

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

  it('renders recorded file changes with the completed answer', () => {
    const base = { text: '完成', isStreaming: false, isTurnComplete: true }
    const empty = renderToStaticMarkup(React.createElement(ResponseCard, base))
    const complete = renderToStaticMarkup(React.createElement(ResponseCard, {
      ...base, artifactVersions: [{ path: '/tmp/中文 报告.html', ordinal: 1, change: 'created' }],
    }))
    expect(empty).not.toContain('中文 报告.html')
    expect(complete).toContain('中文 报告.html')
  })
})
