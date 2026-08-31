import { describe, expect, it } from 'bun:test'
import {
  placeViewportTooltip,
  shouldShowHeaderTooltipOnFocus,
} from '../header-icon-tooltip'

const tooltip = { width: 48, height: 28 }
const desktop = { width: 1440, height: 900 }

describe('placeViewportTooltip', () => {
  it('anchors to the trigger center and prefers above when there is room', () => {
    const trigger = { top: 320, right: 820, bottom: 348, left: 792, width: 28, height: 28 }
    expect(placeViewportTooltip(trigger, desktop, tooltip)).toEqual({
      left: 806,
      top: 286,
      placement: 'above',
    })
  })

  it('does not pin a centered popover button to the app title bar', () => {
    const trigger = { top: 320, right: 820, bottom: 348, left: 792, width: 28, height: 28 }
    const placed = placeViewportTooltip(trigger, desktop, tooltip)
    expect(placed.top).toBeLessThan(trigger.top)
    expect(placed.top).toBeGreaterThan(trigger.top - 50)
    expect(placed.left).toBe(trigger.left + trigger.width / 2)
    expect(placed.top).toBeGreaterThan(80)
  })

  it('flips below when sitting under the app title bar', () => {
    const trigger = { top: 60, right: 820, bottom: 88, left: 792, width: 28, height: 28 }
    expect(placeViewportTooltip(trigger, desktop, tooltip)).toEqual({
      left: 806,
      top: 94,
      placement: 'below',
    })
  })
})

describe('shouldShowHeaderTooltipOnFocus', () => {
  it('shows the tooltip for keyboard-visible focus', () => {
    const target = { matches: (selector: string) => selector === ':focus-visible' }
    expect(shouldShowHeaderTooltipOnFocus(target)).toBe(true)
  })

  it('keeps the tooltip hidden for mouse or programmatically restored focus', () => {
    const target = { matches: () => false }
    expect(shouldShowHeaderTooltipOnFocus(target)).toBe(false)
  })
})
