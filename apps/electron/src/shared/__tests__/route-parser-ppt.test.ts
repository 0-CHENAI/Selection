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
  it('keeps old PPT urls and accepts the Office area aliases', () => {
    for (const route of ['ppt', 'office', 'office/ppt']) {
      const state = parseRouteToNavigationState(route)
      if (!state || !isSessionsNavigation(state)) throw new Error(route)
      expect(state.filter).toEqual({ kind: 'ppt' })
      expect(buildRouteFromNavigationState(state)).toBe('ppt')
    }
    const word = parseRouteToNavigationState(routes.view.office('word', 'minutes-1'))
    if (!word || !isSessionsNavigation(word)) throw new Error('Expected Word section')
    expect(word.filter).toEqual({ kind: 'office', section: 'word' })
    expect(word.details).toEqual({ type: 'session', sessionId: 'minutes-1' })
    expect(buildRouteFromNavigationState(word)).toBe('office/word/session/minutes-1')
    const excel = parseRouteToNavigationState('office/excel')
    if (!excel || !isSessionsNavigation(excel)) throw new Error('Expected Excel section')
    expect(excel.filter).toEqual({ kind: 'office', section: 'excel' })
    expect(buildRouteFromNavigationState(excel)).toBe('office/excel')
  })
})
