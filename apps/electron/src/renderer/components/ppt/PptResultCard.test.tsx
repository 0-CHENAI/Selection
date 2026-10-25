import { beforeAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { PptPageProgress, PptTemplate, PptTheme } from '@craft-agent/shared/protocol'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let PptResultView: typeof import('./PptResultCard').PptResultView
let PptRevisionPanel: typeof import('./PptRevisionPanel').PptRevisionPanel

const i18n = i18next.createInstance()
const cover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'

beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
  ;({ PptResultView } = await import('./PptResultCard'))
  ;({ PptRevisionPanel } = await import('./PptRevisionPanel'))
})

function page(index: number, status: PptPageProgress['status'], extra: Partial<PptPageProgress> = {}): PptPageProgress {
  return { index, id: `p${index}`, name: index === 5 ? '消费：社零总额与结构' : `第${index}页`, status, issueCount: status === 'needs_revision' ? 1 : 0, ...extra }
}

const pages = Array.from({ length: 11 }, (_, index) => page(index + 1, index + 1 === 5 ? 'needs_revision' : 'passed', index + 1 === 5 ? { issue: '图例离页边仅 6px' } : {}))
const themes: PptTheme[] = [
  { id: 'ink', name: '论文墨色', paper: '#F7F4EC', ink: '#1A1A1A', accent: '#1D4ED8', signal: '#B45309' },
  { id: 'stage', name: '暗场讲台', paper: '#12141A', ink: '#F5F5F5', accent: '#7C3AED', signal: '#F59E0B' },
  ...Array.from({ length: 6 }, (_, index) => ({ id: `more-${index}`, name: `配色${index}`, paper: '#fff', ink: '#111', accent: '#333', signal: '#900' })),
]
const templates: PptTemplate[] = [
  { id: 'paper', title: '学术报告', category: '学术', canvas: '16:9', pages: 11, cover, referencePages: [] },
  { id: 'grid', title: '瑞士网格', category: '咨询', canvas: '16:9', pages: 11, cover, referencePages: [] },
]

function view(state: 'done' | 'recolor', panel?: 'color') {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PptResultView
        fileName="2025年中国经济数据简报.pptx"
        pptxPath="/sessions/one/2025年中国经济数据简报.pptx"
        total={11}
        completed={state === 'done' ? 11 : 3}
        current={state === 'recolor' ? 4 : undefined}
        generating={state === 'recolor'}
        canStop={state === 'recolor'}
        pages={state === 'recolor' ? pages.map(item => ({ ...item, status: item.index < 4 ? 'passed' : item.index === 4 ? 'fixing' : 'pending' })) : pages}
        aspect="16:9"
        thumbs={{ 1: cover, 3: cover, 4: cover }}
        templateTitle="学术报告"
        themeName="暗场讲台"
        theme={themes[1]}
        templates={templates}
        themes={themes}
        currentTemplateId="paper"
        currentThemeId="ink"
        run={state === 'recolor' ? { action: 'recolor', themeId: 'stage' } : undefined}
        fileManagerName="访达"
        initialPanel={panel ?? null}
        onPick={() => {}}
        onOpenRight={() => {}}
        onStop={() => {}}
        onApply={() => {}}
        onOpenExternal={() => {}}
        onReveal={() => {}}
      />
    </I18nextProvider>,
  )
}

test('the finished card shows the cover, check summary and page thumbs', () => {
  const html = view('done')
  expect(html).toContain('data-testid="ppt-result-card"')
  expect(html).toContain('2025年中国经济数据简报.pptx')
  expect(html).toContain('PPTX')
  expect(html).toContain('11 页')
  expect(html).toContain('16:9')
  expect(html).toContain('学术报告')
  expect(html).toContain('10 页通过检查')
  expect(html).toContain('第 5 页需留意：图例离页边仅 6px')
  expect(html).toContain('1 / 11')
  expect(html).toContain('在右侧打开')
  expect(html).toContain('换风格重排')
  expect(html).toContain('换配色')
  expect(html).toContain('消费：社零总额与结构')
  expect(html).toContain('data-file-kind="powerpoint"')
  expect(html).not.toContain('<pre')
  expect(html).not.toContain('font-mono')
  expect(html.match(/data-testid="ppt-result-thumb"/g)?.length).toBe(11)
})

test('a recolor in progress keeps one status line and updates page bars', () => {
  const html = view('recolor')
  expect(html).toContain('正在换配色')
  expect(html).toContain('暗场讲台')
  expect(html).toContain('版式不变')
  expect(html).toContain('已完成 3 / 11 页')
  expect(html).toContain('右侧实时刷新')
  expect(html).toContain('第 4 页')
  expect(html).toContain('data-testid="ppt-result-stop"')
  expect(html).toContain('停止')
  expect(html).not.toContain('页通过检查')
  expect(html).not.toContain('<pre')
  expect(html.match(/data-state="done"/g)?.length).toBe(3)
  expect(html.match(/data-state="current"/g)?.length).toBe(1)
  expect(html).toContain('disabled=""')
})

test('the revision panel compares covers and applies to every page', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PptRevisionPanel tab="color" onTab={() => {}} templates={templates} themes={themes} currentThemeId="ink" coverUrl={cover} total={11} onApply={() => {}} onCancel={() => {}} />
    </I18nextProvider>,
  )
  expect(html).toContain('data-testid="ppt-revision-panel"')
  expect(html).toContain('风格')
  expect(html).toContain('配色')
  expect(html).toContain('现在')
  expect(html).toContain('当前')
  expect(html).toContain('更多配色（3）')
  expect(html).toContain('应用到全部 11 页')
  expect(html).toContain('取消')
  expect(html).not.toContain('<pre')
})
