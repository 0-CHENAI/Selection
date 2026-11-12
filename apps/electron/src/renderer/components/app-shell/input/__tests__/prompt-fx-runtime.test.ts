import { describe, expect, it } from 'bun:test'
import {
  PROMPT_FX_AMBIENT_FRAME_MS,
  PROMPT_FX_DPR_CAP,
  decorativeLayerDpr,
  promptFxCanvasDisplayed,
  promptFxFrameDue,
  promptFxFrameIntervalMs,
  promptFxPageVisible,
  promptFxShouldLoop,
  promptFxWindowFocused,
} from '../prompt-fx-runtime'

describe('prompt fx runtime', () => {
  it('caps decorative canvas backing stores at 1.5', () => {
    expect(PROMPT_FX_DPR_CAP).toBe(1.5)
    expect(decorativeLayerDpr(1)).toBe(1)
    expect(decorativeLayerDpr(2)).toBe(1.5)
    expect(decorativeLayerDpr(3)).toBe(1.5)
    expect(decorativeLayerDpr(0)).toBe(1)
    expect(decorativeLayerDpr(Number.NaN)).toBe(1)
  })

  it('treats hidden, blurred, offscreen, and display:none canvases as idle', () => {
    const running = {
      reducedMotion: false,
      visible: true,
      windowFocused: true,
      intersecting: true,
      displayed: true,
      engaged: true,
      live: false,
    }
    expect(promptFxShouldLoop(running)).toBe(true)
    expect(promptFxShouldLoop({ ...running, engaged: false, live: true })).toBe(true)
    expect(promptFxShouldLoop({ ...running, engaged: false, live: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, visible: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, windowFocused: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, intersecting: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, displayed: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, reducedMotion: true })).toBe(false)
  })

  it('reads page visibility and focus without throwing in tests', () => {
    expect(promptFxPageVisible({ visibilityState: 'visible', hidden: false })).toBe(true)
    expect(promptFxPageVisible({ visibilityState: 'hidden', hidden: true })).toBe(false)
    expect(promptFxPageVisible({ hidden: true })).toBe(false)
    expect(promptFxPageVisible({ hidden: false })).toBe(true)
    expect(promptFxWindowFocused({ hasFocus: () => false })).toBe(false)
    expect(promptFxWindowFocused({ hasFocus: () => true })).toBe(true)
    expect(promptFxWindowFocused({})).toBe(true)
    expect(promptFxCanvasDisplayed({ getBoundingClientRect: () => ({ width: 0, height: 10 } as DOMRect) })).toBe(false)
    expect(promptFxCanvasDisplayed({ getBoundingClientRect: () => ({ width: 100, height: 40 } as DOMRect) })).toBe(true)
    expect(promptFxCanvasDisplayed({ isConnected: false, getBoundingClientRect: () => ({ width: 100, height: 40 } as DOMRect) })).toBe(false)
  })

  it('caps ambient frames at 30fps and lets active motion use 60fps', () => {
    expect(promptFxFrameIntervalMs(false)).toBe(PROMPT_FX_AMBIENT_FRAME_MS)
    expect(promptFxFrameIntervalMs(true)).toBeCloseTo(1000 / 60)
    expect(promptFxFrameDue(40, 0, 33)).toBe(true)
    expect(promptFxFrameDue(40, 20, 33)).toBe(false)
    expect(promptFxFrameDue(54, 20, 33)).toBe(true)
  })
})
