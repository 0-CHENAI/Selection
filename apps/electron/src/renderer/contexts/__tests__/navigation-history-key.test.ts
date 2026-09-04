import { describe, expect, it } from 'bun:test'
import {
  INITIAL_NAV_HISTORY,
  buildSemanticHistoryKey,
  canRunInitialRestore,
  createMemoryHistory,
  isHistoryUrlSyncSuppressed,
  memoryGo,
  memoryPushState,
  memoryReplaceState,
  navHistoryAfterPop,
  navHistoryAfterPush,
  navHistoryAfterReload,
  navHistoryCanGoBack,
  navHistoryCanGoForward,
  readPopStateSeq,
  shouldAutoSelectOnReconcile,
  shouldRecordSemanticPush,
} from '../navigation-history'

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

  it('stays stable for identical semantic inputs', () => {
    const input = {
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1', 'sources/source/github'],
      focusedPanelIndex: 1,
      sidebarParam: 'files',
    }

    const keyA = buildSemanticHistoryKey(input)
    const keyB = buildSemanticHistoryKey(input)

    expect(keyA).toBe(keyB)
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
  it('starts with back and forward disabled after reload', () => {
    const state = navHistoryAfterReload()
    expect(state).toEqual(INITIAL_NAV_HISTORY)
    expect(navHistoryCanGoBack(state)).toBe(false)
    expect(navHistoryCanGoForward(state)).toBe(false)
  })

  it('enables back after a semantic push and discards forward after a new branch', () => {
    const first = navHistoryAfterPush(INITIAL_NAV_HISTORY)
    expect(navHistoryCanGoBack(first.state)).toBe(true)
    expect(navHistoryCanGoForward(first.state)).toBe(false)

    const popped = navHistoryAfterPop(first.state, first.seq - 1)
    expect(navHistoryCanGoBack(popped)).toBe(false)
    expect(navHistoryCanGoForward(popped)).toBe(true)

    const branched = navHistoryAfterPush(popped)
    expect(navHistoryCanGoForward(branched.state)).toBe(false)
    expect(branched.state.maxSeq).toBe(branched.seq)
  })

  it('keeps an unknown popstate seq from inventing a reachable cursor', () => {
    const pushed = navHistoryAfterPush(INITIAL_NAV_HISTORY).state
    expect(navHistoryAfterPop(pushed, undefined).seq).toBe(pushed.seq)
    expect(navHistoryAfterPop(pushed, '1').seq).toBe(pushed.seq)
  })
})

describe('history sync policy', () => {
  it('dedupes identical semantic keys and records real route changes', () => {
    expect(shouldRecordSemanticPush('ws::allSessions::0::', 'ws::allSessions::0::')).toBe(false)
    expect(shouldRecordSemanticPush('ws::allSessions::0::', 'ws::projects/project/p::0::')).toBe(true)
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
  })
})

describe('pushState / replaceState / popstate sync (#259)', () => {
  function keyFor(route: string): string {
    return buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes: [route],
      focusedPanelIndex: 0,
      sidebarParam: '',
    })
  }

  it('walks 普通会话 → 项目 → 会话, then back and forward without overwriting entries', () => {
    const routes = [
      'allSessions/session/s1',
      'projects/project/alpha',
      'allSessions/session/s2',
    ]

    let machine = navHistoryAfterReload()
    let history = createMemoryHistory(`?ws=ws&route=${routes[0]}`)
    let lastKey = keyFor(routes[0])
    const visited: string[] = [routes[0]]

    for (const route of routes.slice(1)) {
      const nextKey = keyFor(route)
      expect(shouldRecordSemanticPush(lastKey, nextKey)).toBe(true)
      const pushed = navHistoryAfterPush(machine)
      machine = pushed.state
      history = memoryPushState(history, pushed.seq, `?ws=ws&route=${route}`)
      lastKey = nextKey
      visited.push(route)
    }

    expect(history.entries).toHaveLength(3)
    expect(navHistoryCanGoBack(machine)).toBe(true)
    expect(navHistoryCanGoForward(machine)).toBe(false)

    const backOnce = memoryGo(history, -1)
    expect(backOnce).not.toBeNull()
    history = backOnce!
    machine = navHistoryAfterPop(machine, readPopStateSeq(history.entries[history.index]?.state))
    expect(history.entries[history.index]?.url).toContain('projects/project/alpha')
    expect(navHistoryCanGoForward(machine)).toBe(true)

    const backTwice = memoryGo(history, -1)
    expect(backTwice).not.toBeNull()
    history = backTwice!
    machine = navHistoryAfterPop(machine, readPopStateSeq(history.entries[history.index]?.state))
    expect(history.entries[history.index]?.url).toContain('allSessions/session/s1')
    expect(navHistoryCanGoBack(machine)).toBe(false)

    const forward = memoryGo(history, 1)
    expect(forward).not.toBeNull()
    history = forward!
    machine = navHistoryAfterPop(machine, readPopStateSeq(history.entries[history.index]?.state))
    expect(history.entries[history.index]?.url).toContain('projects/project/alpha')

    const replaced = memoryReplaceState(history, machine.seq, history.entries[history.index]!.url)
    expect(replaced.entries).toHaveLength(3)
    expect(replaced.index).toBe(history.index)
    expect(visited).toEqual(routes)
  })

  it('drops the old forward branch when a new navigation happens after back', () => {
    let machine = navHistoryAfterReload()
    let history = createMemoryHistory('?route=allSessions/session/s1')

    const toProject = navHistoryAfterPush(machine)
    machine = toProject.state
    history = memoryPushState(history, toProject.seq, '?route=projects/project/alpha')

    const toSession = navHistoryAfterPush(machine)
    machine = toSession.state
    history = memoryPushState(history, toSession.seq, '?route=allSessions/session/s2')

    const back = memoryGo(history, -1)!
    history = back
    machine = navHistoryAfterPop(machine, readPopStateSeq(history.entries[history.index]?.state))

    const toSettings = navHistoryAfterPush(machine)
    machine = toSettings.state
    history = memoryPushState(history, toSettings.seq, '?route=settings')

    expect(history.entries.map(entry => entry.url)).toEqual([
      '?route=allSessions/session/s1',
      '?route=projects/project/alpha',
      '?route=settings',
    ])
    expect(navHistoryCanGoForward(machine)).toBe(false)
    expect(memoryGo(history, 1)).toBeNull()
  })
})
