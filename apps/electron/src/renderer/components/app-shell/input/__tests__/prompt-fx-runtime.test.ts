import { describe, expect, it } from 'bun:test'
import {
  PROMPT_FX_DPR_CAP,
  createPromptFxClock,
  decorativeLayerDpr,
  promptFxBoxFromObserver,
  promptFxCanvasDisplayed,
  promptFxPageVisible,
  promptFxReadCssBox,
  promptFxShouldLoop,
  promptFxSyncClock,
} from '../prompt-fx-runtime'

describe('prompt fx runtime', () => {
  it('keeps the original decorative backing-store cap of 2', () => {
    expect(PROMPT_FX_DPR_CAP).toBe(2)
    expect(decorativeLayerDpr(1)).toBe(1)
    expect(decorativeLayerDpr(2)).toBe(2)
    expect(decorativeLayerDpr(3)).toBe(2)
    expect(decorativeLayerDpr(0)).toBe(1)
    expect(decorativeLayerDpr(Number.NaN)).toBe(1)
  })

  it('loops at full rate whenever the canvas could be seen, including idle and unfocused', () => {
    const running = {
      reducedMotion: false,
      visible: true,
      intersecting: true,
      displayed: true,
    }
    expect(promptFxShouldLoop(running)).toBe(true)
    expect(promptFxShouldLoop({ ...running, visible: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, intersecting: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, displayed: false })).toBe(false)
    expect(promptFxShouldLoop({ ...running, reducedMotion: true })).toBe(false)
  })

  it('treats hidden documents, disconnected canvases, and display:none as invisible', () => {
    expect(promptFxPageVisible({ visibilityState: 'visible', hidden: false })).toBe(true)
    expect(promptFxPageVisible({ visibilityState: 'hidden', hidden: true })).toBe(false)
    expect(promptFxPageVisible({ hidden: true })).toBe(false)
    expect(promptFxPageVisible({ hidden: false })).toBe(true)
    expect(promptFxCanvasDisplayed({ width: 0, height: 10 })).toBe(false)
    expect(promptFxCanvasDisplayed({ width: 100, height: 40 })).toBe(true)
    expect(promptFxCanvasDisplayed({ width: 100, height: 40, isConnected: false })).toBe(false)
    expect(promptFxCanvasDisplayed({ width: 100, height: 40, display: 'none' })).toBe(false)
    expect(promptFxCanvasDisplayed({ width: 100, height: 40, visibility: 'hidden' })).toBe(false)
  })

  it('reads CSS boxes from ResizeObserver entries without getBoundingClientRect', () => {
    expect(promptFxBoxFromObserver({
      contentBoxSize: [{ inlineSize: 1605, blockSize: 203 }],
      contentRect: { width: 1, height: 1 },
    })).toEqual({ width: 1605, height: 203 })
    expect(promptFxReadCssBox({ clientWidth: 320, clientHeight: 48 })).toEqual({ width: 320, height: 48 })
    expect(promptFxReadCssBox({
      clientWidth: 0,
      clientHeight: 0,
      getBoundingClientRect: () => ({ width: 180, height: 22 }),
    })).toEqual({ width: 180, height: 22 })
  })

  it('freezes the animation clock while paused so resume continues without a jump', () => {
    const clock = createPromptFxClock()
    expect(promptFxSyncClock(clock, true, 1000)).toBe(1000)
    expect(promptFxSyncClock(clock, false, 1100)).toBe(1100)
    expect(promptFxSyncClock(clock, false, 1500)).toBe(1100)
    expect(promptFxSyncClock(clock, true, 1600)).toBe(1100)
    expect(promptFxSyncClock(clock, true, 1640)).toBe(1140)
  })
})
