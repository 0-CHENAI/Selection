import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'
import { isSessionsNavigation } from '../types'
import { normalizeRemovedSessionClassification } from '../session-classification'

describe('PPT navigation', () => {
  it('keeps PPT drafts distinct from ordinary session drafts and old classification redirects', () => {
    const ppt = parseRouteToNavigationState(routes.view.ppt())
    if (!ppt || !isSessionsNavigation(ppt)) throw new Error('Expected PPT session surface')
    expect(ppt.filter).toEqual({ kind: 'ppt' })
    expect(ppt.details).toBeNull()
    expect(normalizeRemovedSessionClassification(ppt)).toEqual(ppt)
    expect(buildRouteFromNavigationState(ppt)).toBe('ppt')
  })
  it('retains PPT history when reloading a selected session URL', () => {
    const state = parseRouteToNavigationState(`${routes.view.ppt('deck-123')}?focus=chat`)
    if (!state || !isSessionsNavigation(state)) throw new Error('Expected PPT session surface')
    expect(state.filter).toEqual({ kind: 'ppt' })
    expect(state.details).toEqual({ type: 'session', sessionId: 'deck-123' })
    expect(buildRouteFromNavigationState(state)).toBe('ppt/session/deck-123')
  })
})
