import { describe, expect, it } from 'bun:test'
import {
  INITIAL_NAV_HISTORY,
  buildSemanticHistoryKey,
  canRunInitialRestore,
  createMemoryHistory,
  isHistoryUrlSyncSuppressed,
  memoryGo,
  NAV_HISTORY_STORAGE_KEY,
  navHistoryAfterReload,
  navHistoryCanGoBack,
  navHistoryCanGoForward,
  navHistoryCurrent,
  navHistoryForReload,
  navHistoryGo,
  parseNavHistory,
  parseProjectHistoryScope,
  planHistoryUrlWrite,
  readHistoryNavIndex,
  recordPageVisit,
  serializeNavHistory,
  serializeProjectHistoryScope,
  shouldAutoSelectOnReconcile,
  shouldRecordSemanticPush,
  shouldRunSessionListAutoSelect,
  type NavHistoryEntry,
  type NavHistoryState,
} from '../navigation-history'

function page(route: string, scope = ''): NavHistoryEntry {
  const key = buildSemanticHistoryKey({
    workspaceSlug: 'ws',
    panelRoutes: [route],
    focusedPanelIndex: 0,
    sidebarParam: '',
    historyScope: scope,
  })
  const scopeParam = scope ? `&navscope=${encodeURIComponent(scope)}` : ''
  return { key, search: `?ws=ws&route=${route}${scopeParam}` }
}

function visit(app: NavHistoryState, browser: ReturnType<typeof createMemoryHistory>, entry: NavHistoryEntry) {
  return recordPageVisit(app, browser, entry)
}

describe('buildSemanticHistoryKey', () => {
  it('changes when focused panel index changes even if routes are identical', () => {
    const panelRoutes = ['allSessions/session/s1', 'allSessions/session/s1']

    const keyA = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes,
      focusedPanelIndex: 0,
      sidebarParam: '',
    })

    const keyB = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes,
      focusedPanelIndex: 1,
      sidebarParam: '',
    })

    expect(keyA).not.toBe(keyB)
  })

  it('stays stable for identical semantic inputs and ignores layout-only state', () => {
    const input = {
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1', 'sources/source/github'],
      focusedPanelIndex: 1,
      sidebarParam: 'files',
      historyScope: '',
    }

    const keyA = buildSemanticHistoryKey(input)
    const keyB = buildSemanticHistoryKey(input)

    expect(keyA).toBe(keyB)
    expect(keyA).not.toContain('immersive')
  })

  it('changes when the sidebar project scope changes on the same route', () => {
    const base = {
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1'],
      focusedPanelIndex: 0,
      sidebarParam: '',
    }
    expect(buildSemanticHistoryKey({ ...base, historyScope: '' }))
      .not.toBe(buildSemanticHistoryKey({ ...base, historyScope: 'project:alpha' }))
  })
})

describe('canRunInitialRestore', () => {
  it('returns false until session metadata is ready', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: false,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(false)
  })

  it('returns true only when all restore conditions are satisfied', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(true)

    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: true,
    })).toBe(false)
  })
})

describe('nav history cursor', () => {
  it('starts with back and forward disabled before and after the first seeded page', () => {
    expect(navHistoryCanGoBack(INITIAL_NAV_HISTORY)).toBe(false)
    expect(navHistoryCanGoForward(INITIAL_NAV_HISTORY)).toBe(false)
    expect(navHistoryAfterReload()).toEqual(INITIAL_NAV_HISTORY)

    const seeded = recordPageVisit(INITIAL_NAV_HISTORY, createMemoryHistory('?route=s1'), page('allSessions/session/s1'))
    expect(navHistoryCanGoBack(seeded.app)).toBe(false)
    expect(navHistoryCanGoForward(seeded.app)).toBe(false)
    expect(seeded.wrote).toBe('replace')
    expect(seeded.browser.entries).toHaveLength(1)
  })

  it('enables back after a real page change and drops the forward branch after a new visit', () => {
    let app = recordPageVisit(INITIAL_NAV_HISTORY, createMemoryHistory('?route=s1'), page('allSessions/session/s1')).app
    app = recordPageVisit(app, createMemoryHistory('?route=s1'), page('projects/project/alpha')).app
    expect(navHistoryCanGoBack(app)).toBe(true)
    expect(navHistoryCanGoForward(app)).toBe(false)

    const popped = navHistoryGo(app, -1)
    expect(popped).not.toBeNull()
    expect(navHistoryCanGoBack(popped!)).toBe(false)
    expect(navHistoryCanGoForward(popped!)).toBe(true)
    expect(navHistoryCurrent(popped!)?.search).toContain('allSessions/session/s1')

    const branched = recordPageVisit(popped!, createMemoryHistory('?route=s1'), page('settings')).app
    expect(navHistoryCanGoForward(branched)).toBe(false)
    expect(branched.entries.map(entry => entry.search)).toEqual([
      page('allSessions/session/s1').search,
      page('settings').search,
    ])
  })

  it('ignores a popstate index that is not one of our entries', () => {
    const seeded = recordPageVisit(INITIAL_NAV_HISTORY, createMemoryHistory('?route=s1'), page('allSessions/session/s1')).app
    expect(readHistoryNavIndex(undefined)).toBeNull()
    expect(readHistoryNavIndex({ navIndex: '1' })).toBeNull()
    expect(readHistoryNavIndex({ navIndex: 0 })).toBe(0)
    expect(readHistoryNavIndex({ seq: 1 })).toBeNull()
    expect(navHistoryGo(seeded, -1)).toBeNull()
  })
})

describe('history sync policy', () => {
  it('dedupes identical semantic keys and records real route changes', () => {
    expect(shouldRecordSemanticPush('ws::allSessions::0::::', 'ws::allSessions::0::::')).toBe(false)
    expect(shouldRecordSemanticPush('ws::allSessions::0::::', 'ws::projects/project/p::0::::')).toBe(true)
    expect(planHistoryUrlWrite('ws::allSessions::0::::', 'ws::projects/project/p::0::::')).toBe('push')
    expect(planHistoryUrlWrite('ws::allSessions::0::::', 'ws::allSessions::0::::')).toBe('replace')
    expect(planHistoryUrlWrite('ws::allSessions::0::::', '')).toBe('skip')
  })

  it('suppresses URL writes during restore and before the first restore', () => {
    expect(isHistoryUrlSyncSuppressed({
      suppressPush: false,
      restoringHistory: false,
      initialRouteRestored: true,
    })).toBe(false)
    expect(isHistoryUrlSyncSuppressed({
      suppressPush: true,
      restoringHistory: false,
      initialRouteRestored: true,
    })).toBe(true)
    expect(isHistoryUrlSyncSuppressed({
      suppressPush: false,
      restoringHistory: true,
      initialRouteRestored: true,
    })).toBe(true)
    expect(isHistoryUrlSyncSuppressed({
      suppressPush: false,
      restoringHistory: false,
      initialRouteRestored: false,
    })).toBe(true)
  })

  it('auto-selects only for user navigation, not history restore', () => {
    expect(shouldAutoSelectOnReconcile('user')).toBe(true)
    expect(shouldAutoSelectOnReconcile('history')).toBe(false)
    expect(shouldRunSessionListAutoSelect({
      restoringHistory: false,
      historyNavigation: false,
      userAllowsAutoSelect: true,
      hasSessionDetails: false,
    })).toBe(true)
    expect(shouldRunSessionListAutoSelect({
      restoringHistory: true,
      historyNavigation: false,
      userAllowsAutoSelect: true,
      hasSessionDetails: false,
    })).toBe(false)
    expect(shouldRunSessionListAutoSelect({
      restoringHistory: false,
      historyNavigation: true,
      userAllowsAutoSelect: true,
      hasSessionDetails: false,
    })).toBe(false)
    expect(shouldRunSessionListAutoSelect({
      restoringHistory: false,
      historyNavigation: false,
      userAllowsAutoSelect: false,
      hasSessionDetails: false,
    })).toBe(false)
    expect(shouldRunSessionListAutoSelect({
      restoringHistory: false,
      historyNavigation: false,
      userAllowsAutoSelect: true,
      hasSessionDetails: true,
    })).toBe(false)
  })
})

describe('push / replace / back across pages', () => {
  function start() {
    const browser = createMemoryHistory(page('allSessions/session/s1').search)
    const seeded = recordPageVisit(INITIAL_NAV_HISTORY, browser, page('allSessions/session/s1'))
    return { app: seeded.app, browser: seeded.browser }
  }

  it('walks 会话 → 项目页 → 会话 → 设置 → 新会话, then back and forward one page at a time', () => {
    let { app, browser } = start()
    const steps = [
      page('projects/project/alpha'),
      page('allSessions/session/s2'),
      page('settings'),
      page('allSessions'),
    ]
    for (const entry of steps) {
      const recorded = visit(app, browser, entry)
      expect(recorded.wrote).toBe('push')
      app = recorded.app
      browser = recorded.browser
    }

    expect(app.entries).toHaveLength(5)
    expect(navHistoryCanGoBack(app)).toBe(true)
    expect(navHistoryCanGoForward(app)).toBe(false)
    expect(browser.entries.map(entry => entry.url)).toEqual(app.entries.map(entry => entry.search))

    const expectedBack = [
      'settings',
      'allSessions/session/s2',
      'projects/project/alpha',
      'allSessions/session/s1',
    ]
    for (const route of expectedBack) {
      const nextApp = navHistoryGo(app, -1)
      const nextBrowser = memoryGo(browser, -1)
      expect(nextApp).not.toBeNull()
      expect(nextBrowser).not.toBeNull()
      app = nextApp!
      browser = nextBrowser!
      const search = navHistoryCurrent(app)?.search
      if (!search) throw new Error('missing history search')
      expect(search).toContain(route)
      expect(browser.entries[browser.index]?.url).toBe(search)
    }
    expect(navHistoryCanGoBack(app)).toBe(false)
    expect(navHistoryCanGoForward(app)).toBe(true)

    const forward = navHistoryGo(app, 1)!
    const forwardBrowser = memoryGo(browser, 1)!
    expect(navHistoryCurrent(forward)?.search).toContain('projects/project/alpha')
    expect(forwardBrowser.entries[forwardBrowser.index]?.url).toContain('projects/project/alpha')
    expect(navHistoryCanGoBack(forward)).toBe(true)
    expect(navHistoryCanGoForward(forward)).toBe(true)
  })

  it('does not overwrite the previous page when the route changes', () => {
    let { app, browser } = start()
    const previous = browser.entries[0]?.url
    const recorded = visit(app, browser, page('settings'))
    expect(recorded.wrote).toBe('push')
    expect(recorded.browser.entries[0]?.url).toBe(previous)
    expect(recorded.browser.entries[1]?.url).toContain('settings')
    expect(recorded.browser.entries).toHaveLength(2)
  })

  it('keeps immersive layout and proportion updates off the stack', () => {
    let { app, browser } = start()
    const resized = page('allSessions/session/s1')
    resized.search += '&panels=allSessions/session/s1:1.0000'
    const recorded = visit(app, browser, resized)
    expect(recorded.wrote).toBe('replace')
    expect(recorded.app.entries).toHaveLength(1)
    expect(recorded.app.index).toBe(0)
    expect(navHistoryCanGoBack(recorded.app)).toBe(false)
    expect(recorded.browser.entries).toHaveLength(1)
    expect(recorded.browser.entries[0]?.url).toContain('panels=')
  })

  it('records a sidebar project selection even when the session route stays the same', () => {
    let { app, browser } = start()
    const selected = visit(app, browser, page('allSessions/session/s1', 'project:alpha'))
    expect(selected.wrote).toBe('push')
    expect(navHistoryCanGoBack(selected.app)).toBe(true)

    const back = navHistoryGo(selected.app, -1)!
    expect(navHistoryCurrent(back)?.search).not.toContain('navscope')
    expect(navHistoryCanGoForward(back)).toBe(true)
    expect(parseProjectHistoryScope('project:alpha')).toEqual({ alpha: 'include' })
    expect(serializeProjectHistoryScope(['beta', 'alpha', 'alpha'])).toBe('project:alpha,beta')
    expect(parseProjectHistoryScope('')).toEqual({})
  })

  it('drops the old forward branch when a new navigation happens after back', () => {
    let { app, browser } = start()
    for (const entry of [page('projects/project/alpha'), page('allSessions/session/s2')]) {
      const recorded = visit(app, browser, entry)
      app = recorded.app
      browser = recorded.browser
    }

    app = navHistoryGo(app, -1)!
    browser = memoryGo(browser, -1)!
    const settings = visit(app, browser, page('settings'))
    expect(settings.app.entries.map(entry => entry.search)).toEqual([
      page('allSessions/session/s1').search,
      page('projects/project/alpha').search,
      page('settings').search,
    ])
    expect(settings.browser.entries.map(entry => entry.url)).toEqual(settings.app.entries.map(entry => entry.search))
    expect(navHistoryCanGoForward(settings.app)).toBe(false)
    expect(memoryGo(settings.browser, 1)).toBeNull()
  })

  it('restores the stack after a reload when the browser session history is still there', () => {
    let { app } = start()
    app = recordPageVisit(app, createMemoryHistory(page('allSessions/session/s1').search), page('settings')).app
    app = recordPageVisit(app, createMemoryHistory('x'), page('projects/project/alpha')).app
    const raw = serializeNavHistory(app)
    expect(parseNavHistory(raw)).toEqual(app)
    expect(parseNavHistory('{')).toBeNull()
    expect(NAV_HISTORY_STORAGE_KEY).toBe('selection-nav-history')

    const restored = navHistoryForReload(app, page('projects/project/alpha').search, 3)
    expect(restored?.index).toBe(2)
    expect(navHistoryCanGoBack(restored!)).toBe(true)
    expect(navHistoryCanGoForward(restored!)).toBe(false)

    const mid = navHistoryForReload(app, page('settings').search, 3)
    expect(mid?.index).toBe(1)
    expect(navHistoryCanGoForward(mid!)).toBe(true)

    expect(navHistoryForReload(app, page('settings').search, 1)).toBeNull()
    expect(navHistoryForReload(app, '?route=missing', 3)).toBeNull()
  })

  it('does not add another entry when the same page is selected again', () => {
    let { app, browser } = start()
    const again = visit(app, browser, page('allSessions/session/s1'))
    expect(again.wrote).toBe('skip')
    expect(again.app.entries).toHaveLength(1)
    expect(navHistoryCanGoBack(again.app)).toBe(false)
    expect(navHistoryCanGoForward(again.app)).toBe(false)
  })
})
