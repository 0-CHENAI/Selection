import { describe, expect, it } from 'bun:test'
import {
  draftSessionNavigateOptions,
  navigateOptionsFromEventDetail,
} from '../navigate'

describe('draftSessionNavigateOptions', () => {
  it('always suppresses auto-select so new chat can stay on the draft composer', () => {
    expect(draftSessionNavigateOptions()).toEqual({ skipAutoSelect: true })
    expect(draftSessionNavigateOptions(false)).toEqual({ skipAutoSelect: true })
  })

  it('opens a new panel without losing auto-select suppression', () => {
    expect(draftSessionNavigateOptions(true)).toEqual({
      skipAutoSelect: true,
      newPanel: true,
      targetLaneId: 'main',
    })
  })
})

describe('navigateOptionsFromEventDetail', () => {
  it('forwards skipAutoSelect through the navigate event bridge', () => {
    expect(navigateOptionsFromEventDetail({
      route: 'allSessions',
      skipAutoSelect: true,
    })).toEqual({ skipAutoSelect: true })
  })

  it('forwards new-panel options together with skipAutoSelect', () => {
    expect(navigateOptionsFromEventDetail({
      route: 'allSessions',
      skipAutoSelect: true,
      newPanel: true,
      targetLaneId: 'main',
    })).toEqual({
      skipAutoSelect: true,
      newPanel: true,
      targetLaneId: 'main',
    })
  })
})
