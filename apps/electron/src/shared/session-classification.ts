import type { NavigationState, SessionFilter } from './types'

/**
 * Session classifications were removed from the product in issue #180.
 * Keep recognising their old routes so bookmarks continue to open, but route
 * them into the ordinary session list instead of recreating a hidden filter.
 */
export function isRemovedSessionClassificationFilter(filter: SessionFilter): boolean {
  return filter.kind === 'flagged'
    || filter.kind === 'archived'
    || filter.kind === 'state'
    || filter.kind === 'label'
}

export function normalizeRemovedSessionClassification(
  state: NavigationState,
): NavigationState {
  if (state.navigator !== 'sessions' || !isRemovedSessionClassificationFilter(state.filter)) {
    return state
  }

  return {
    ...state,
    filter: { kind: 'allSessions' },
  }
}
