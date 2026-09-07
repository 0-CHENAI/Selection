import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next, { type InitOptions } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

import type { AppShellContextType } from '@/context/AppShellContext'

let AppShellProvider: typeof import('@/context/AppShellContext').AppShellProvider
let PanelHeader: typeof import('../PanelHeader').PanelHeader
let BoardListToggle: typeof import('../kanban/BoardListToggle').BoardListToggle
let SessionSearchHeader: typeof import('../SessionSearchHeader').SessionSearchHeader

beforeAll(async () => {
  ;({ AppShellProvider } = await import('@/context/AppShellContext'))
  ;({ PanelHeader } = await import('../PanelHeader'))
  ;({ BoardListToggle } = await import('../kanban/BoardListToggle'))
  ;({ SessionSearchHeader } = await import('../SessionSearchHeader'))
})

function renderWithShell(
  node: ReactNode,
  context: Partial<AppShellContextType> = {},
): string {
  return renderToStaticMarkup(
    <AppShellProvider value={context as AppShellContextType}>
      {node}
    </AppShellProvider>,
  )
}

function renderWithI18n(language: keyof typeof LOCALE_REGISTRY, node: ReactNode): string {
  const instance = i18next.createInstance()
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    initImmediate: false,
    resources: Object.fromEntries(
      Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
        code,
        { translation: entry.messages },
      ]),
    ),
  } as InitOptions)

  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>{node}</I18nextProvider>,
  )
}

function sessionNavigatorActionsSource(): string {
  const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
  const navigatorSlot = appShell.slice(appShell.indexOf('navigatorSlot='))
  const actions = navigatorSlot.slice(navigatorSlot.indexOf('actions={'))
  return actions.slice(0, actions.indexOf('isSourcesNavigation'))
}

describe('session list header actions (#264)', () => {
  it('places search before the list / new-orchestration switcher after #263', () => {
    const actions = sessionNavigatorActionsSource()
    const searchIdx = actions.indexOf('sidebar.search')
    const toggleIdx = actions.indexOf('BoardListToggle')
    const compactIdx = actions.indexOf('!isAutoCompact')

    expect(searchIdx).toBeGreaterThan(-1)
    expect(toggleIdx).toBeGreaterThan(-1)
    expect(searchIdx).toBeLessThan(toggleIdx)
    expect(compactIdx).toBeGreaterThan(searchIdx)
    expect(compactIdx).toBeLessThan(toggleIdx)
    expect(actions).toContain('setSearchActive(true)')
    expect(actions).toContain('flex items-center gap-1.5')
    expect(actions).not.toContain('ListFilter')
    expect(actions).not.toContain('sidebar.filterChats')
  })

  it('keeps search activation, start-aligned title, and the existing search field chain', () => {
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const sessionList = readFileSync(join(import.meta.dir, '../SessionList.tsx'), 'utf8')
    const useSessionSearch = readFileSync(
      join(import.meta.dir, '../../../hooks/useSessionSearch.ts'),
      'utf8',
    )

    expect(appShell).toContain("useAction('app.search', () => setSearchActive(true))")
    expect(appShell).toContain('titleAlign="start"')
    expect(appShell).toContain('searchActive={searchActive}')
    expect(sessionList).toContain('searchActive && (')
    expect(sessionList).toContain('<SessionSearchHeader')
    expect(useSessionSearch).toContain('searchInputRef.current?.focus()')
  })

  it('places the orchestration-pane switcher after the workspace selector, without board search', () => {
    const container = readFileSync(
      join(import.meta.dir, '../kanban/KanbanBoardContainer.tsx'),
      'utf8',
    )
    const topBar = readFileSync(join(import.meta.dir, '../TopBar.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const topBarCall = appShell.slice(appShell.indexOf('<TopBar'), appShell.indexOf('isCompact={isAutoCompact}'))

    expect(container).not.toContain('BoardListToggle')
    expect(container).not.toContain('sidebar.search')
    expect(container).not.toContain('setSearchActive')
    expect(container).not.toContain('SessionSearchHeader')
    expect(topBar).toContain('afterWorkspace')
    expect(topBar.lastIndexOf('<WorkspaceSwitcher')).toBeLessThan(topBar.indexOf('{afterWorkspace}'))
    expect(topBarCall).toContain('isBoardView')
    expect(topBarCall).toContain('BoardListToggle')
    expect(topBarCall).toContain('value="board"')
  })

  it('pushes header actions to the right and keeps search left of the switcher in the DOM', () => {
    const html = renderWithShell(
      <PanelHeader
        title="所有会话"
        titleAlign="start"
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button">Search</button>
            <button type="button">List / New orchestration</button>
          </div>
        }
      />,
    )

    expect(html).toContain('所有会话')
    expect(html).not.toContain('mx-auto')
    expect(html).toContain('shrink-0')
    expect(html).toContain('pr-2')
    expect(html.indexOf('所有会话')).toBeLessThan(html.indexOf('Search'))
    expect(html.indexOf('Search')).toBeLessThan(html.indexOf('List / New orchestration'))
  })

  it('labels the switcher 列表 / 导入编排 in Chinese', () => {
    const zh = LOCALE_REGISTRY['zh-Hans'].messages
    expect(zh['kanban.list']).toBe('列表')
    expect(zh['kanban.board']).toBe('导入编排')

    const html = renderWithI18n(
      'zh-Hans',
      <BoardListToggle value="list" onChange={() => {}} />,
    )
    expect(html).toContain('列表')
    expect(html).toContain('导入编排')
    expect(html.indexOf('列表')).toBeLessThan(html.indexOf('导入编排'))
  })

  it('still opens the existing search field with close control when search is active', () => {
    const html = renderWithI18n(
      'zh-Hans',
      <SessionSearchHeader
        searchQuery=""
        onSearchChange={() => {}}
        onSearchClose={() => {}}
      />,
    )
    expect(html).toContain('placeholder="搜索标题和内容…"')
    expect(html).toContain('title="关闭搜索"')
  })
})
