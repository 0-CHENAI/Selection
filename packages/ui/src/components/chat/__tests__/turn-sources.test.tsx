import * as React from 'react'
import { beforeAll, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import { ResponseSourcesLayout } from '../ResponseSourcesLayout'
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
let TurnCard: typeof import('../TurnCard').TurnCard
beforeAll(async () => { ({ TurnCard } = await import('../TurnCard')) })

function render(animateResponse: boolean, researched: boolean, text = '调查结论', streaming = false) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ResponseSourcesLayout messages={[{ role: 'tool', toolName: 'WebFetch', content: 'Content from https://old.example.com:\n\n上一轮网页' }]}>
        <TurnCard turnId="sources-regression" isStreaming={streaming} isComplete={!streaming} animateResponse={animateResponse}
          activities={researched ? [{ id: 'fetch', type: 'tool', status: 'completed', timestamp: 1, toolName: 'WebFetch', toolInput: { url: 'https://example.com' }, content: 'Content from https://example.com:\n\n本轮网页' }] : []}
          response={{ text, isStreaming: streaming }} />
      </ResponseSourcesLayout>
    </TooltipProvider>,
  )
}
it('renders the source shelf in both app and animated paths without an explicit bibliography', () => {
  for (const animated of [false, true]) expect(render(animated, true)).toContain('chat.sourcesLabel')
})
it('does not infer research from another turn or hide ordinary links', () => {
  const html = render(false, false, '普通链接 [旧网站](https://old.example.com)')
  expect(html).not.toContain('chat.sourcesLabel')
  expect(html).toContain('旧网站')
})

it('reserves the same source shelf before completion and keeps it non-interactive', () => {
  const streaming = render(false, true, '调查结论', true)
  expect(streaming).toContain('data-response-sources=""')
  expect(streaming).toContain('aria-hidden="true"')
  expect(streaming).toContain('opacity:0')
  expect(streaming).toMatch(/data-response-sources[^]*?<button[^>]*disabled=""/)
  const completed = render(false, true)
  expect(completed).toContain('data-response-sources=""')
  expect(completed).toContain('opacity:1')
  expect(render(false, false, '普通回答', true)).not.toContain('data-response-sources')
})
