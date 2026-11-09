import { describe, it, expect } from 'bun:test'
import { shouldAnnounceBackgroundFinish } from '../background-finish-announce'

describe('shouldAnnounceBackgroundFinish', () => {
  const visible = new Set(['parent', 'other'])

  it('does not announce a session the user is already looking at', () => {
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'parent', hidden: false, chipPreference: true, visibleSessionIds: visible, ancestorIds: [],
    })).toBe(false)
  })

  it('does not announce hidden mini sessions', () => {
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'mini', hidden: true, chipPreference: true, visibleSessionIds: visible, ancestorIds: ['parent'],
    })).toBe(false)
  })

  it('announces any off-screen session when the chip preference is on', () => {
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'stranger', chipPreference: true, visibleSessionIds: visible, ancestorIds: [],
    })).toBe(true)
  })

  it('announces a nested child of a visible parent even when the chip preference is off', () => {
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'child', chipPreference: false, visibleSessionIds: visible, ancestorIds: ['parent'],
    })).toBe(true)
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'deep', chipPreference: false, visibleSessionIds: visible, ancestorIds: ['step', 'parent'],
    })).toBe(true)
  })

  it('stays quiet for an unrelated background session when the preference is off', () => {
    expect(shouldAnnounceBackgroundFinish({
      sessionId: 'stranger', chipPreference: false, visibleSessionIds: visible, ancestorIds: ['nobody'],
    })).toBe(false)
  })
})
