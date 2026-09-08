interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  panelRoutes: string[]
  focusedPanelIndex: number
  sidebarParam: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

export interface NavHistoryState {
  /** Assigned seq of the current history entry */
  seq: number
  /** Highest seq still reachable via forward */
  maxSeq: number
  /** Next seq to allocate on pushState */
  nextSeq: number
}

export const INITIAL_NAV_HISTORY: NavHistoryState = {
  seq: 0,
  maxSeq: 0,
  nextSeq: 1,
}

export interface MemoryHistoryEntry {
  url: string
  state: { seq: number } | null
}

export interface MemoryHistory {
  entries: MemoryHistoryEntry[]
  index: number
}

export type HistoryReconcileSource = 'user' | 'history'

/**
 * Builds a semantic history key used to dedupe pushState entries.
 *
 * Includes focused panel index so states with duplicate routes remain distinct
 * when focus moves between panels.
 */
export function buildSemanticHistoryKey({
  workspaceSlug,
  panelRoutes,
  focusedPanelIndex,
  sidebarParam,
}: SemanticHistoryKeyInput): string {
  return [
    workspaceSlug ?? '',
    panelRoutes.join('|'),
    String(focusedPanelIndex),
    sidebarParam,
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
  return state.seq > 0
}

export function navHistoryCanGoForward(state: NavHistoryState): boolean {
  return state.seq < state.maxSeq
}

export function navHistoryAfterPush(state: NavHistoryState): { state: NavHistoryState; seq: number } {
  const seq = state.nextSeq
  return {
    seq,
    state: { seq, maxSeq: seq, nextSeq: seq + 1 },
  }
}

export function navHistoryAfterPop(state: NavHistoryState, eventSeq: unknown): NavHistoryState {
  const seq = typeof eventSeq === 'number' && Number.isInteger(eventSeq) && eventSeq >= 0
    ? eventSeq
    : state.seq
  return { ...state, seq }
}

export function navHistoryAfterReload(): NavHistoryState {
  return { ...INITIAL_NAV_HISTORY }
}

export function shouldRecordSemanticPush(previousKey: string, nextKey: string): boolean {
  return nextKey.length > 0 && nextKey !== previousKey
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

export function readPopStateSeq(state: unknown): unknown {
  if (typeof state !== 'object' || state === null || !('seq' in state)) return undefined
  return (state as { seq?: unknown }).seq
}

export function createMemoryHistory(initialUrl: string): MemoryHistory {
  return {
    entries: [{ url: initialUrl, state: { seq: 0 } }],
    index: 0,
  }
}

export function memoryPushState(history: MemoryHistory, seq: number, url: string): MemoryHistory {
  return {
    entries: [...history.entries.slice(0, history.index + 1), { url, state: { seq } }],
    index: history.index + 1,
  }
}

export function memoryReplaceState(history: MemoryHistory, seq: number, url: string): MemoryHistory {
  const entries = history.entries.slice()
  entries[history.index] = { url, state: { seq } }
  return { ...history, entries }
}

export function memoryGo(history: MemoryHistory, delta: number): MemoryHistory | null {
  const index = history.index + delta
  if (index < 0 || index >= history.entries.length) return null
  return { ...history, index }
}
