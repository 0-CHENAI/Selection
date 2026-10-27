import { beforeAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { PptPageProgress, PptTemplate, PptTheme } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let PptArtifactScope: typeof import('./PptResultCard').PptArtifactScope
let PptArtifactMenuItems: typeof import('./PptResultCard').PptArtifactMenuItems
let PptRevisionPanel: typeof import('./PptRevisionPanel').PptRevisionPanel
let MenuRoot: typeof import('@radix-ui/react-dropdown-menu').Root
let MenuContent: typeof import('@radix-ui/react-dropdown-menu').Content
let ResponseArtifacts: typeof import('@craft-agent/ui/chat').ResponseArtifacts
let useArtifactSupplements: typeof import('@craft-agent/ui/chat').useArtifactSupplements

const i18n = i18next.createInstance()
const cover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'

beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
  ;({ PptArtifactScope, PptArtifactMenuItems } = await import('./PptResultCard'))
  ;({ PptRevisionPanel } = await import('./PptRevisionPanel'))
  ;({ Root: MenuRoot, Content: MenuContent } = await import('@radix-ui/react-dropdown-menu'))
  ;({ ResponseArtifacts, useArtifactSupplements } = await import('@craft-agent/ui/chat'))
})

function page(index: number, status: PptPageProgress['status'], extra: Partial<PptPageProgress> = {}): PptPageProgress {
  return { index, id: `p${index}`, name: index === 5 ? '消费结构' : `第${index}页`, status, issueCount: status === 'needs_revision' ? 1 : 0, ...extra }
}

const themes: PptTheme[] = [
  { id: 'academic-ink', name: '论文墨色', paper: '#F7F4EE', ink: '#1B2430', accent: '#1D4ED8', signal: '#1D4ED8' },
]
const templates: PptTemplate[] = [
  { id: 'paper', title: '学术报告', category: '学术', canvas: '16:9', pages: 15, cover, referencePages: [] },
]

function session(state: 'generating' | 'passed' | 'attention', extra: Partial<Session> = {}): Session {
  const pages = state === 'generating'
    ? []
    : state === 'passed'
      ? Array.from({ length: 15 }, (_, index) => page(index + 1, 'passed'))
      : Array.from({ length: 15 }, (_, index) => page(index + 1, index + 1 === 5 || index + 1 === 9 ? 'needs_revision' : 'passed'))
  return {
    id: 's1',
    ppt: {},
    isProcessing: state === 'generating',
    messages: [{ id: 'a1', role: 'assistant', turnId: 't1' }],
    pptProgress: {
      fileName: '项目介绍.pptx',
      ...(state === 'generating' ? {} : { pptxPath: '/sessions/one/项目介绍.pptx' }),
      total: 15,
      completed: state === 'generating' ? 5 : 15,
      ...(state === 'generating' ? { current: 6, currentTitle: '市场概览', generating: true } : { generating: false }),
      pages,
    },
    ...extra,
  } as Session
}

function ShelfProbe() {
  const supplement = useArtifactSupplements()[0]
  if (!supplement) return null
  const pending = !!supplement.pendingAnchors?.length
  const anchors = pending ? supplement.pendingAnchors! : supplement.applyAnchors ?? []
  const artifacts = pending ? [] : [{ path: supplement.path, name: supplement.name, extension: supplement.extension }]
  return <ResponseArtifacts artifacts={artifacts} anchors={anchors} mode={pending ? 'pending' : 'settled'} />
}

function view(state: 'generating' | 'passed' | 'attention') {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PptArtifactScope session={session(state)}>
        <ShelfProbe />
      </PptArtifactScope>
    </I18nextProvider>,
  )
}

test('a generating deck is one artifact row with a live subtitle, stop control and 2px bar', () => {
  const html = view('generating')
  expect(html.match(/成果文件/g)?.length).toBe(2)
  expect(html).toContain('data-testid="ppt-artifact-row"')
  expect(html).toContain('项目介绍.pptx')
  expect(html).toContain('data-file-kind="powerpoint"')
  expect(html).toContain('生成中 · 第 6/15 页 · 市场概览')
  expect(html).toContain('data-testid="artifact-row-progress"')
  expect(html).toContain('data-progress="0.4"')
  expect(html).toContain('h-[2px]')
  expect(html).toContain('data-testid="ppt-artifact-stop"')
  expect(html).toContain('停止')
  expect(html).not.toContain('data-testid="ppt-artifact-menu"')
  expect(html).not.toContain('data-testid="ppt-result-card"')
  expect(html).not.toContain('data-testid="ppt-result-cover"')
  expect(html).not.toContain('data-testid="ppt-result-thumb"')
  expect(html).not.toContain('<pre')
  expect(html).not.toContain('font-mono')
})

test('a finished deck reports that every page passed', () => {
  const html = view('passed')
  expect(html).toContain('PPTX · 15 页')
  expect(html).toContain('全部通过检查')
  expect(html).toContain('data-testid="ppt-artifact-open-right"')
  expect(html).toContain('aria-label="在右侧打开"')
  expect(html).toContain('data-testid="ppt-artifact-menu"')
  expect(html).toContain('aria-label="更多操作"')
  expect(html).not.toContain('data-testid="artifact-row-progress"')
  expect(html).not.toContain('data-testid="ppt-artifact-stop"')
  expect(html).not.toContain('data-testid="ppt-result-cover"')
  expect(html.match(/成果文件/g)?.length).toBe(2)
})

test('flagged pages stay in the subtitle as a status notice', () => {
  const html = view('attention')
  expect(html).toContain('PPTX · 15 页')
  expect(html).toContain('<span data-testid="ppt-artifact-attention"')
  expect(html).toContain('第 5、9 页需留意')
  expect(html).not.toContain('underline')
  expect(html).not.toContain('全部通过检查')
  expect(html).not.toContain('data-testid="ppt-artifact-page"')
  expect(html).not.toContain('<pre')
})

test('the row menu keeps restyle and recolor and does not list pages', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MenuRoot open>
        <MenuContent>
          <PptArtifactMenuItems canRevise onRestyle={() => {}} onRecolor={() => {}} />
        </MenuContent>
      </MenuRoot>
    </I18nextProvider>,
  )
  expect(html).toContain('换风格重排...')
  expect(html).toContain('换配色...')
  expect(html).not.toContain('逐页检查')
  expect(html).not.toContain('data-testid="ppt-artifact-page"')
  expect(html).not.toContain('<pre')
  expect(html).not.toContain('font-mono')
})

test('the revision panel compares covers and applies to every page', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PptRevisionPanel tab="color" onTab={() => {}} templates={templates} themes={themes} currentThemeId="academic-ink" coverUrl={cover} total={11} onApply={() => {}} onCancel={() => {}} />
    </I18nextProvider>,
  )
  expect(html).toContain('data-testid="ppt-revision-panel"')
  expect(html).toContain('风格')
  expect(html).toContain('配色')
  expect(html).toContain('现在')
  expect(html).toContain('当前')
  expect(html).toContain('应用到全部 11 页')
  expect(html).toContain('取消')
  expect(html).not.toContain('<pre')
})
