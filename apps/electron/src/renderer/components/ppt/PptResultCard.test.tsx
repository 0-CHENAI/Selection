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
  { id: 'academic-ink', name: '论文墨色', paper: '#F7F4EE', ink: '#1B2430', accent: '#1D4ED8', signal: '#1D4ED8' },
  { id: 'keynote-stage', name: '暗场讲台', paper: '#0E0E10', ink: '#F5F5F7', accent: '#FF6B3D', signal: '#FF6B3D' },
  { id: 'sugar-rush', name: '糖彩', paper: '#FFF8EE', ink: '#1A1A2E', accent: '#EB3898', signal: '#A34710' },
  { id: 'glass-saas', name: '玻璃界面', paper: '#F4F6FB', ink: '#1E1B4B', accent: '#4F46E5', signal: '#4F46E5' },
  { id: 'paper-cut', name: '剪纸月色', paper: '#F2ECE0', ink: '#131A33', accent: '#1E3A5F', signal: '#8A6A1E' },
  { id: 'pixel-breakfast', name: '像素早餐', paper: '#F4F0E6', ink: '#1A1C2C', accent: '#A34710', signal: '#A34710' },
  { id: 'tea-tasting', name: '点茶', paper: '#F5EFE2', ink: '#2B2A28', accent: '#9E2E26', signal: '#9E2E26' },
  { id: 'brutal-stone', name: '粗石', paper: '#F2F0EA', ink: '#14110F', accent: '#C8331E', signal: '#C8331E' },
]
const templates: PptTemplate[] = [
  { id: 'paper', title: '学术报告', category: '学术', canvas: '16:9', pages: 11, cover, referencePages: [] },
  { id: 'grid', title: '瑞士网格', category: '咨询', canvas: '16:9', pages: 11, cover, referencePages: [] },
]

function view(state: 'done' | 'recolor', options: { panel?: 'color'; expanded?: boolean; completed?: number; current?: number | null } = {}) {
  const current = options.current === null ? undefined : options.current ?? (state === 'recolor' ? 4 : undefined)
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PptResultView
        fileName="2025年中国经济数据简报.pptx"
        pptxPath="/sessions/one/2025年中国经济数据简报.pptx"
        total={11}
        completed={options.completed ?? (state === 'done' ? 11 : 3)}
        current={current}
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
        currentThemeId="academic-ink"
        run={state === 'recolor' ? { action: 'recolor', themeId: 'keynote-stage' } : undefined}
        fileManagerName="访达"
        initialPanel={options.panel ?? null}
        expanded={options.expanded ?? false}
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

test('the card starts collapsed on one row', () => {
  const html = view('done')
  expect(html).toContain('data-expanded="false"')
  expect(html).toContain('data-testid="ppt-result-fold"')
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-controls=')
  expect(html).toContain('aria-label="展开"')
  expect(html).toContain('type="button"')
  expect(html).toContain('2025年中国经济数据简报.pptx')
  expect(html).toContain('data-file-kind="powerpoint"')
  expect(html).toContain('11 页 · 1 页需留意')
  expect(html).toContain('在右侧打开')
  expect(html).toContain('data-testid="ppt-result-fold-status" class="shrink-0 whitespace-nowrap')
  expect(html).toContain('data-testid="ppt-result-open-right"')
  expect(html).toContain('whitespace-nowrap rounded-md')
  expect(html).not.toContain('basis-0')
  expect(html).not.toContain('data-testid="ppt-result-cover"')
  expect(html).not.toContain('data-testid="ppt-result-thumb"')
  expect(html).not.toContain('换风格重排')
  expect(html).not.toContain('10 页通过检查')
})

test('the finished card shows the cover, check summary and page thumbs', () => {
  const html = view('done', { expanded: true })
  expect(html).toContain('aria-expanded="true"')
  expect(html).toContain('aria-label="折叠"')
  expect(html).toContain('data-motion="off"')
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
  expect(html).toContain('aspect-video')
  expect(html).toContain('object-contain')
  expect(html).not.toContain('object-cover')
  expect(html).not.toContain('h-[196px]')
  expect(html).not.toContain('<pre')
  expect(html).not.toContain('font-mono')
  expect(html.match(/data-testid="ppt-result-thumb"/g)?.length).toBe(11)
})

test('a collapsed redraw keeps a thin bar and does not invent page 1', () => {
  const html = view('recolor', { completed: 11, current: null })
  expect(html).toContain('data-testid="ppt-result-fold-bar"')
  expect(html).toContain('h-1 ')
  expect(html).not.toContain('h-1.5')
  expect(html).toContain('11 页 · 0/11')
  expect(html).not.toContain('第 1 页')
  expect(html).not.toContain('已完成 11 / 11 页')
  expect(html).not.toContain('data-testid="ppt-result-cover"')
  expect(html.match(/data-state="wait"/g)?.length).toBe(11)
})

test('the veil and the completed count come from the page being redrawn', () => {
  const veiled = view('recolor', { expanded: true, completed: 11, current: null })
  expect(veiled).not.toContain('第 1 页')
  expect(veiled).toContain('已完成 0 / 11 页')
  expect(veiled).not.toContain('已完成 11 / 11 页')
  expect(veiled.match(/data-state="wait"/g)?.length).toBe(11)
  const html = view('recolor', { expanded: true, completed: 11, current: 4 })
  expect(html.match(/第 4 页/g)).toEqual(['第 4 页'])
  expect(html).toContain('已完成 3 / 11 页')
  expect(html).not.toContain('已完成 11 / 11 页')
  expect(html.match(/data-state="done"/g)?.length).toBe(3)
  expect(html.match(/data-state="current"/g)?.length).toBe(1)
})

test('a recolor in progress keeps one status line and updates page bars', () => {
  const html = view('recolor', { expanded: true })
  expect(html).toContain('正在换配色')
  expect(html).toContain('暗场讲台')
  expect(html).toContain('版式不变')
  expect(html).toContain('已完成 3 / 11 页')
  expect(html).toContain('右侧实时刷新')
  expect(html.match(/第 4 页/g)).toEqual(['第 4 页'])
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
      <PptRevisionPanel tab="color" onTab={() => {}} templates={templates} themes={themes} currentThemeId="academic-ink" coverUrl={cover} total={11} onApply={() => {}} onCancel={() => {}} />
    </I18nextProvider>,
  )
  expect(html).toContain('data-testid="ppt-revision-panel"')
  expect(html).toContain('风格')
  expect(html).toContain('配色')
  expect(html).toContain('现在')
  expect(html).toContain('当前')
  expect(html).toContain('更多配色（3）')
  expect(html).toContain('糖彩')
  expect(html).toContain('剪纸月色')
  expect(html).not.toContain('更多配色 1')
  expect(html).not.toContain('配色0')
  expect(html).toContain('应用到全部 11 页')
  expect(html).toContain('取消')
  expect(html).not.toContain('<pre')
})
