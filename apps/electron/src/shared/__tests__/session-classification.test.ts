import { describe, expect, it } from 'bun:test'
import type { NavigationState, SessionFilter } from '../types'
import { normalizeRemovedSessionClassification } from '../session-classification'
import { parseRouteToNavigationState } from '../route-parser'
import { SETTINGS_ITEMS } from '../menu-schema'

describe('normalizeRemovedSessionClassification', () => {
  const removedFilters: SessionFilter[] = [
    { kind: 'flagged' },
    { kind: 'archived' },
    { kind: 'state', stateId: 'done' },
    { kind: 'label', labelId: 'priority' },
  ]

  it.each(removedFilters)('maps legacy $kind routes to ordinary sessions', (filter) => {
    const state: NavigationState = {
      navigator: 'sessions',
      filter,
      viewMode: 'list',
      details: { type: 'session', sessionId: 'session-180' },
    }

    expect(normalizeRemovedSessionClassification(state)).toEqual({
      ...state,
      filter: { kind: 'allSessions' },
    })
  })

  it('preserves supported session views', () => {
    const state: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'view', viewId: 'recent' },
      viewMode: 'list',
      details: null,
    }

    expect(normalizeRemovedSessionClassification(state)).toBe(state)
  })

  it('does not change non-session navigation', () => {
    const state: NavigationState = {
      navigator: 'sources',
      details: null,
    }

    expect(normalizeRemovedSessionClassification(state)).toBe(state)
  })

  it('retires direct label settings routes without leaving a hidden entry point', () => {
    expect(SETTINGS_ITEMS.some(item => item.id === 'labels')).toBe(false)
    expect(parseRouteToNavigationState('settings/labels')).toEqual({
      navigator: 'settings',
      subpage: 'app',
    })
  })

  it.each(['permissions', 'messaging'] as const)(
    'hides the %s settings page and redirects stale routes to app settings',
    (subpage) => {
      expect(SETTINGS_ITEMS.some(item => item.id === subpage)).toBe(false)
      expect(parseRouteToNavigationState(`settings/${subpage}`)).toEqual({
        navigator: 'settings',
        subpage: 'app',
      })
    },
  )
})
