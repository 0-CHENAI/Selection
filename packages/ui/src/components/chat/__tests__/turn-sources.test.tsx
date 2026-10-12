import * as React from 'react'
import { beforeAll, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import { ResponseSourcesLayout } from '../ResponseSourcesLayout'
import type { ActivityItem } from '../TurnCard'
import type { ResponseSource } from '../response-sources'
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))
let TurnCard: typeof import('../TurnCard').TurnCard
beforeAll(async () => { ({ TurnCard } = await import('../TurnCard')) })

function render(animateResponse: boolean, researched: boolean, text = '调查结论', streaming = false, activities?: ActivityItem[], researchSources?: ResponseSource[]) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ResponseSourcesLayout messages={[{ role: 'tool', toolName: 'WebFetch', content: 'Content from https://old.example.com:\n\n上一轮网页' }]}>
        <TurnCard turnId="sources-regression" isStreaming={streaming} isComplete={!streaming} animateResponse={animateResponse}
          researchSources={researchSources}
          activities={activities ?? (researched ? [{ id: 'fetch', type: 'tool', status: 'completed', timestamp: 1, toolName: 'WebFetch', toolInput: { url: 'https://example.com' }, content: 'Content from https://example.com:\n\n本轮网页' }] : [])}
          response={{ text, isStreaming: streaming }} />
      </ResponseSourcesLayout>
    </TooltipProvider>,
  )
}
it('renders the source shelf in both app and animated paths without an explicit bibliography', () => {
  for (const animated of [false, true]) expect(render(animated, true)).toContain('chat.sourcesLabel')
})
it('shows worker sources on the parent answer without copying worker tools into its work chain', () => {
  const sources = [{ url: 'https://worker.example.com', hostname: 'worker.example.com', title: '子代理查阅资料', description: '实际返回的资料摘要' }]
  for (const animated of [false, true]) {
    const html = render(animated, false, '父代理汇总答复', false, [], sources)
    expect(html).toContain('chat.sourcesLabel')
    expect(html).toContain('worker.example.com')
    expect(html).not.toContain('old.example.com')
  }
  const hidden = render(false, false, '汇总中', true, [], sources)
  expect(hidden).toContain('opacity:0')
  expect(hidden).toMatch(/data-response-sources[^]*?<button[^>]*disabled=""/)
})
it('renders sources for a PRO answer that reads handover web snapshots', () => {
  const activities: ActivityItem[] = [{ id: 'read', type: 'tool', status: 'completed', timestamp: 1,
    toolName: 'Read', toolInput: { file_path: `{{SESSION_PATH}}/data/handover/handoff/files/${'a'.repeat(64)}.txt` },
    content: 'Content from https://example.com/page:\n\n本轮读取的交接网页' }]
  for (const animated of [false, true]) {
    const html = render(animated, false, '基于交接材料的结论', false, activities)
    expect(html).toContain('data-response-sources=""')
    expect(html).toContain('chat.sourcesLabel')
    expect(html).not.toContain('old.example.com')
  }
})
it('does not infer research from another turn or hide ordinary links', () => {
  const html = render(false, false, '普通链接 [旧网站](https://old.example.com)')
  expect(html).not.toContain('chat.sourcesLabel')
  expect(html).toContain('旧网站')
})

it('keeps the model reply intact when it contains an explicit source list', () => {
  const text = '结论。\n\nSources: [官网](https://example.com) · [补充资料](https://other.com)'
  const html = render(false, true, text)
  expect(html).toContain('Sources:')
  expect(html).toContain('补充资料')
  expect(html).toContain('data-response-sources=""')
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
