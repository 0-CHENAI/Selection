import { describe, expect, it } from 'bun:test'
import { OFFICE_CHAT_MIN_PX, officePanelLimits, officePanelWidth, officePanelWidthCss } from './office-panel-width'

describe('office panel width', () => {
  it('uses 45% of the room after the sidebar and keeps the chat at the minimum', () => {
    const open = officePanelWidth(1442, 226)
    expect(open).toBeCloseTo(1216 * 0.45, 5)
    expect(1442 - 226 - open).toBeGreaterThanOrEqual(OFFICE_CHAT_MIN_PX)

    const small = officePanelWidth(1280, 226)
    expect(1280 - 226 - small).toBeGreaterThanOrEqual(OFFICE_CHAT_MIN_PX)
    expect(small).toBeCloseTo(1054 * 0.45, 5)
  })

  it('clamps a dragged width and the default so the chat never goes under the minimum', () => {
    expect(officePanelWidth(1442, 532, 800)).toBe(350)
    expect(1442 - 532 - 350).toBe(OFFICE_CHAT_MIN_PX)
    expect(officePanelWidth(1442, 226, 100)).toBe(320)
    expect(officePanelLimits(700, 20)).toEqual({ min: 120, max: 120, room: 680 })
    expect(officePanelWidth(700, 20)).toBe(120)
    expect(officePanelWidth(500, 0)).toBe(0)
  })

  it('encodes the same cap in the container-query width', () => {
    const css = officePanelWidthCss()
    expect(css).toContain('var(--office-leading-width, 0px)')
    expect(css).toContain('560px')
    expect(css).toContain('320px')
    expect(css).toContain('0.45')
    expect(css).toContain('var(--office-panel-preferred-width,')
    expect(css).not.toContain('440px')
  })
})
