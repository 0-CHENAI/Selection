import * as React from 'react'
import { beforeAll, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../tooltip'
import { ArtifactSupplementsProvider, type ArtifactSupplement } from '../artifact-supplements'
import type { ActivityItem } from '../TurnCard'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let TurnCard: typeof import('../TurnCard').TurnCard
beforeAll(async () => { ({ TurnCard } = await import('../TurnCard')) })

function row(extra: Partial<ArtifactSupplement> = {}): ArtifactSupplement {
  return {
    path: '/work/项目介绍.pptx',
    name: '项目介绍.pptx',
    extension: 'pptx',
    applyAnchors: ['msg-1', 'sess:turn:sk'],
    pendingAnchors: ['msg-1', 'sess:turn:sk'],
    meta: '生成中 · 第 6/15 页',
    progress: 6 / 15,
    testId: 'ppt-artifact-row',
    ...extra,
  }
}

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<TooltipProvider><ArtifactSupplementsProvider supplements={[row()]}>{node}</ArtifactSupplementsProvider></TooltipProvider>)
}

it('shows the live pptx row inside a streaming reply and does not repeat the shelf', () => {
  const html = render(<TurnCard sessionId="sess" turnId="turn" isStreaming isComplete={false} activities={[]}
    response={{ text: '正在写', isStreaming: true, messageId: 'msg-1', streamKey: 'sk' }} />)
  expect(html.match(/data-testid="ppt-artifact-row"/g)?.length).toBe(1)
  expect(html).toContain('项目介绍.pptx')
  expect(html).toContain('生成中 · 第 6/15 页')
  expect(html).toContain('data-progress="0.4"')
  expect(html).not.toContain('data-testid="ppt-result-card"')
})

it('keeps one supplemented row on a finished reply that also delivered another file', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ArtifactSupplementsProvider supplements={[row({ pendingAnchors: [], progress: undefined, meta: 'PPTX · 15 页 · 全部通过检查' })]}>
        <TurnCard sessionId="sess" turnId="turn" isStreaming={false} isComplete activities={[]}
          response={{
            text: '做好了',
            isStreaming: false,
            messageId: 'msg-1',
            streamKey: 'sk',
            artifactVersions: [
              { path: '/work/附录.docx', ordinal: 1, change: 'created' },
              { path: '/work/项目介绍.pptx', ordinal: 1, change: 'created' },
            ],
          }} />
      </ArtifactSupplementsProvider>
    </TooltipProvider>,
  )
  expect(html.match(/data-testid="ppt-artifact-row"/g)?.length).toBe(1)
  expect(html.indexOf('项目介绍.pptx')).toBeLessThan(html.indexOf('附录.docx'))
  expect(html).toContain('PPTX · 15 页 · 全部通过检查')
  expect(html).not.toContain('data-testid="artifact-row-progress"')
})

it('puts the row on a turn that has no reply card yet', () => {
  const activities: ActivityItem[] = [{ id: 'tool', type: 'tool', status: 'running', timestamp: 1, toolName: 'Bash' }]
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ArtifactSupplementsProvider supplements={[row({ applyAnchors: ['turn'], pendingAnchors: ['turn', 'sess:turn:response'] })]}>
        <TurnCard sessionId="sess" turnId="turn" isStreaming isComplete={false} activities={activities} />
      </ArtifactSupplementsProvider>
    </TooltipProvider>,
  )
  expect(html).toContain('data-testid="ppt-artifact-row"')
  expect(html).toContain('生成中 · 第 6/15 页')
})

it('does not paint the row onto a different turn', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ArtifactSupplementsProvider supplements={[row({ applyAnchors: ['other'], pendingAnchors: ['other'] })]}>
        <TurnCard sessionId="sess" turnId="turn" isStreaming isComplete={false} activities={[]}
          response={{ text: '正在写', isStreaming: true, messageId: 'msg-1', streamKey: 'sk' }} />
      </ArtifactSupplementsProvider>
    </TooltipProvider>,
  )
  expect(html).not.toContain('data-testid="ppt-artifact-row"')
})
