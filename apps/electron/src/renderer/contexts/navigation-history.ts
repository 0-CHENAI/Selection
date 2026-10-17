interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  panelRoutes: string[]
  focusedPanelIndex: number
  sidebarParam: string
  /**
   * Sidebar list scope that is not part of the panel route (project filter).
   * Included so choosing a project in the sidebar is its own history step.
   */
  historyScope?: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

/** One visitable page. `search` is the URL query that restores it. */
export interface NavHistoryEntry {
  key: string
  search: string
}

/**
 * In-app back/forward stack.
 *
 * The index is the source of truth for the buttons. Browser history is only a
 * mirror: a semantic page change pushes, a cosmetic URL change replaces the
 * current entry, and back/forward move this index.
 */
export interface NavHistoryState {
  entries: NavHistoryEntry[]
  index: number
}

export const INITIAL_NAV_HISTORY: NavHistoryState = {
  entries: [],
  index: -1,
}

export interface MemoryHistoryEntry {
  url: string
  state: { navIndex: number } | null
}

export interface MemoryHistory {
  entries: MemoryHistoryEntry[]
  index: number
}

export type HistoryReconcileSource = 'user' | 'history'
export type HistoryUrlWrite = 'push' | 'replace' | 'skip'

/**
 * Builds a semantic history key used to dedupe history entries.
 *
 * Includes focused panel index so states with duplicate routes remain distinct
 * when focus moves between panels, and historyScope so sidebar project
 * selection is distinct from the underlying session route.
 *
 * Layout-only state (immersive mode, panel proportions, sidebar width) is
 * intentionally absent: it must not create a back step.
 */
export function buildSemanticHistoryKey({
  workspaceSlug,
  panelRoutes,
  focusedPanelIndex,
  sidebarParam,
  historyScope = '',
}: SemanticHistoryKeyInput): string {
  return [
    workspaceSlug ?? '',
    panelRoutes.join('|'),
    String(focusedPanelIndex),
    sidebarParam,
    historyScope,
  ].join('::')
}

/**
 * Returns whether initial route restoration is allowed to run.
 */
export function canRunInitialRestore({
  isReady,
  isSessionsReady,
  workspaceId,
  initialRouteRestored,
}: InitialRestoreGateInput): boolean {
  return isReady && isSessionsReady && !!workspaceId && !initialRouteRestored
}

export function navHistoryCanGoBack(state: NavHistoryState): boolean {
  return state.index > 0
}

export function navHistoryCanGoForward(state: NavHistoryState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1
}

export function navHistoryCurrent(state: NavHistoryState): NavHistoryEntry | null {
  if (state.index < 0) return null
  return state.entries[state.index] ?? null
}

/**
 * How a URL write is allowed to touch the stack.
 *
 * A changed page must push. Replacing in that case overwrites the previous
 * entry, so the first back press stays on the new page. An unchanged page
 * (resize, immersive layout, proportion sync) may only replace the current
 * entry.
 */
export function planHistoryUrlWrite(previousKey: string, nextKey: string): HistoryUrlWrite {
  if (!nextKey) return 'skip'
  if (previousKey !== nextKey) return 'push'
  return 'replace'
}

/** Same page refreshes in place. A new page truncates the forward branch. */
export function navHistoryPush(state: NavHistoryState, entry: NavHistoryEntry): NavHistoryState {
  if (!entry.key) return state
  if (state.index >= 0 && state.entries[state.index]?.key === entry.key) {
    return navHistoryReplace(state, entry)
  }
  const entries = state.index >= 0 ? state.entries.slice(0, state.index + 1) : []
  entries.push(entry)
  return { entries, index: entries.length - 1 }
}

/** Update the current entry without moving, or seed the stack when empty. */
export function navHistoryReplace(state: NavHistoryState, entry: NavHistoryEntry): NavHistoryState {
  if (!entry.key) return state
  if (state.index >= 0) {
    const current = state.entries[state.index]
    if (current && current.key === entry.key && current.search === entry.search) return state
  }
  if (state.index < 0) return { entries: [entry], index: 0 }
  const entries = state.entries.slice()
  entries[state.index] = entry
  return { entries, index: state.index }
}

export function navHistoryGo(state: NavHistoryState, delta: number): NavHistoryState | null {
  const index = state.index + delta
  if (index < 0 || index >= state.entries.length) return null
  return { ...state, index }
}

/** Adopt a browser pop whose state points at one of our entries. */
export function navHistoryAt(state: NavHistoryState, index: number): NavHistoryState | null {
  if (!Number.isInteger(index) || index < 0 || index >= state.entries.length) return null
  if (index === state.index) return state
  return { ...state, index }
}

export function navHistoryAfterReload(): NavHistoryState {
  return { entries: [], index: -1 }
}

export const NAV_HISTORY_STORAGE_KEY = 'selection-nav-history'

export function serializeNavHistory(state: NavHistoryState): string {
  return JSON.stringify({ entries: state.entries, index: state.index })
}

export function parseNavHistory(raw: string): NavHistoryState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<NavHistoryState>
    if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.index !== 'number' || !Number.isInteger(parsed.index)) {
      return null
    }
    if (!parsed.entries.every(entry => (
      !!entry
      && typeof entry.key === 'string'
      && typeof entry.search === 'string'
      && entry.key.length > 0
    ))) return null
    const entries = parsed.entries as NavHistoryEntry[]
    if (entries.length === 0) return parsed.index === -1 ? { entries, index: -1 } : null
    if (parsed.index < 0 || parsed.index >= entries.length) return null
    return { entries, index: parsed.index }
  } catch {
    return null
  }
}

/**
 * Restore buttons after a document reload (including a back/forward that the
 * browser treated as a full navigation). The stored stack is only reused when
 * the loaded URL is one of its pages and the browser still has enough
 * session-history entries to walk it.
 */
export function navHistoryForReload(
  stored: NavHistoryState | null,
  search: string,
  browserLength: number,
): NavHistoryState | null {
  if (!stored || stored.index < 0) return null
  const found = stored.entries.findIndex(entry => entry.search === search)
  if (found < 0) return null
  if (!Number.isFinite(browserLength) || browserLength < stored.entries.length) return null
  return found === stored.index ? stored : { entries: stored.entries, index: found }
}

export function shouldRecordSemanticPush(previousKey: string, nextKey: string): boolean {
  return planHistoryUrlWrite(previousKey, nextKey) === 'push'
}

export function isHistoryUrlSyncSuppressed(flags: {
  suppressPush: boolean
  restoringHistory: boolean
  initialRouteRestored: boolean
}): boolean {
  return flags.suppressPush || flags.restoringHistory || !flags.initialRouteRestored
}

/** History restore must keep the encoded route. Auto-select is a forward-navigation policy. */
export function shouldAutoSelectOnReconcile(source: HistoryReconcileSource): boolean {
  return source === 'user'
}

/**
 * List auto-select may finish a user navigation that is still waiting for
 * session metadata. It must not run for a page reached by back/forward, or
 * the restored draft / empty list is immediately replaced and the click
 * appears to do nothing.
 */
export function shouldRunSessionListAutoSelect(input: {
  restoringHistory: boolean
  historyNavigation: boolean
  userAllowsAutoSelect: boolean
  hasSessionDetails: boolean
}): boolean {
  if (input.restoringHistory || input.historyNavigation) return false
  if (!input.userAllowsAutoSelect) return false
  return !input.hasSessionDetails
}

export function readHistoryNavIndex(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('navIndex' in state)) return null
  const index = (state as { navIndex?: unknown }).navIndex
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null
}

/** Project ids included by the sidebar, stable for both the history key and the URL. */
export function serializeProjectHistoryScope(ids: Iterable<string>): string {
  const unique = [...new Set(ids)].map(id => id.trim()).filter(Boolean).sort()
  return unique.length ? `project:${unique.join(',')}` : ''
}

export function parseProjectHistoryScope(scope: string): Record<string, 'include'> {
  if (!scope.startsWith('project:')) return {}
  const ids = scope.slice('project:'.length).split(',').map(id => id.trim()).filter(Boolean)
  return Object.fromEntries(ids.map(id => [id, 'include' as const]))
}

export function createMemoryHistory(initialUrl: string): MemoryHistory {
  return {
    entries: [{ url: initialUrl, state: { navIndex: 0 } }],
    index: 0,
  }
}

export function memoryPushState(history: MemoryHistory, navIndex: number, url: string): MemoryHistory {
  return {
    entries: [...history.entries.slice(0, history.index + 1), { url, state: { navIndex } }],
    index: history.index + 1,
  }
}

export function memoryReplaceState(history: MemoryHistory, navIndex: number, url: string): MemoryHistory {
  const entries = history.entries.slice()
  const index = history.index < 0 ? 0 : history.index
  entries[index] = { url, state: { navIndex } }
  return { entries, index }
}

export function memoryGo(history: MemoryHistory, delta: number): MemoryHistory | null {
  const index = history.index + delta
  if (index < 0 || index >= history.entries.length) return null
  return { ...history, index }
}

export interface RecordedPageVisit {
  app: NavHistoryState
  browser: MemoryHistory
  wrote: HistoryUrlWrite
}

/**
 * Mirror one page visit into the app stack and the browser stack together.
 * A semantic change pushes both. A cosmetic change replaces both current
 * entries and leaves the previous URL untouched.
 */
export function recordPageVisit(
  app: NavHistoryState,
  browser: MemoryHistory,
  entry: NavHistoryEntry,
): RecordedPageVisit {
  // The document load is already the first browser entry. Seed it in place
  // so the first real page change is the first back step.
  if (app.index < 0) {
    const next = navHistoryReplace(app, entry)
    if (next === app) return { app, browser, wrote: 'skip' }
    return {
      app: next,
      browser: memoryReplaceState(browser, next.index, entry.search),
      wrote: 'replace',
    }
  }
  const previousKey = navHistoryCurrent(app)?.key ?? ''
  const plan = planHistoryUrlWrite(previousKey, entry.key)
  if (plan === 'skip') return { app, browser, wrote: 'skip' }
  if (plan === 'replace') {
    const next = navHistoryReplace(app, entry)
    if (next === app) return { app, browser, wrote: 'skip' }
    return {
      app: next,
      browser: memoryReplaceState(browser, next.index, entry.search),
      wrote: 'replace',
    }
  }
  const next = navHistoryPush(app, entry)
  const added = next.index !== app.index || next.entries.length !== app.entries.length
  return {
    app: next,
    browser: added
      ? memoryPushState(browser, next.index, entry.search)
      : memoryReplaceState(browser, next.index, entry.search),
    wrote: added ? 'push' : 'replace',
  }
}
