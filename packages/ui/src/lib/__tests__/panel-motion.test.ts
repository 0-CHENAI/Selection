import { describe, expect, it } from 'bun:test'
import { PANEL_SPRING, panelPushTransition } from '../panel-motion'

describe('panel push transition', () => {
  it('uses the shared spring unless motion is reduced', () => {
    expect(panelPushTransition(false)).toBe(PANEL_SPRING)
    expect(panelPushTransition(null)).toBe(PANEL_SPRING)
    expect(panelPushTransition(undefined)).toBe(PANEL_SPRING)
    expect(panelPushTransition(true)).toEqual({ duration: 0 })
  })
})
