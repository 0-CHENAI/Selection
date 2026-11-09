/**
 * Session-only chrome for the middle PPT history column.
 * Opening Office collaboration collapses it once. A click in this window
 * wins over that automatic collapse, and closing Office restores only the
 * automatic one.
 */
export interface PptHistoryListChrome {
  userChoice: 'open' | 'closed' | null
  autoCollapsed: boolean
}

export const initialPptHistoryListChrome: PptHistoryListChrome = {
  userChoice: null,
  autoCollapsed: false,
}

export function pptHistoryListVisible(state: PptHistoryListChrome): boolean {
  if (state.userChoice === 'closed') return false
  if (state.userChoice === 'open') return true
  return !state.autoCollapsed
}

export type PptHistoryListEvent =
  | { type: 'office'; open: boolean }
  | { type: 'toggle' }

export function reducePptHistoryList(state: PptHistoryListChrome, event: PptHistoryListEvent): PptHistoryListChrome {
  if (event.type === 'toggle') {
    const visible = pptHistoryListVisible(state)
    return { userChoice: visible ? 'closed' : 'open', autoCollapsed: false }
  }
  if (event.open) {
    if (state.userChoice !== null) return state.autoCollapsed ? { ...state, autoCollapsed: false } : state
    return state.autoCollapsed ? state : { userChoice: null, autoCollapsed: true }
  }
  if (state.autoCollapsed) return { userChoice: null, autoCollapsed: false }
  return state
}
