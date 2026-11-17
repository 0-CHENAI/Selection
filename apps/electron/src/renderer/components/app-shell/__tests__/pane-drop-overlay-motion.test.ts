import { describe, expect, it } from 'bun:test'
import { motionValue, type AnimationPlaybackControls, type MotionValue } from 'motion/react'
import {
  PANE_DROP_BLUR_PX,
  PANE_DROP_EASE,
  PANE_DROP_HINT_DELAY,
  createPaneDropPlayer,
} from '../pane-drop-overlay-motion'

function makeValues() {
  return {
    blur: motionValue(0),
    wash: motionValue(0),
    hintOpacity: motionValue(0),
    hintY: motionValue(10),
    hintScale: motionValue(0.94),
  }
}

function mockAnimate() {
  const calls: Array<{
    value: MotionValue<number>
    to: number
    delay: number
    stopped: boolean
  }> = []
  const animate = (
    value: MotionValue<number>,
    to: number,
    options?: { duration?: number; ease?: readonly number[]; delay?: number },
  ): AnimationPlaybackControls => {
    const call = { value, to, delay: options?.delay ?? 0, stopped: false }
    calls.push(call)
    return {
      stop() {
        call.stopped = true
      },
      finished: Promise.resolve(),
    } as AnimationPlaybackControls
  }
  return { animate, calls }
}

describe('pane drop overlay motion', () => {
  it('uses the app enter easing and staggers the hint after the blur', () => {
    expect(PANE_DROP_EASE).toEqual([0.22, 1, 0.36, 1])
    expect(PANE_DROP_HINT_DELAY).toBeGreaterThan(0)
    expect(PANE_DROP_BLUR_PX).toBe(16)
  })

  it('snaps open and closed when motion is reduced', () => {
    const values = makeValues()
    const player = createPaneDropPlayer(values, () => true)
    player.enter()
    expect(values.blur.get()).toBe(PANE_DROP_BLUR_PX)
    expect(values.wash.get()).toBe(1)
    expect(values.hintOpacity.get()).toBe(1)
    expect(values.hintY.get()).toBe(0)
    expect(values.hintScale.get()).toBe(1)
    player.snapIdle()
    expect(values.blur.get()).toBe(0)
    expect(values.hintOpacity.get()).toBe(0)
  })

  it('starts blur immediately and delays the icon and text', () => {
    const values = makeValues()
    const { animate, calls } = mockAnimate()
    const player = createPaneDropPlayer(values, () => false, animate)
    player.enter()
    const blur = calls.find(call => call.value === values.blur)
    const hint = calls.find(call => call.value === values.hintOpacity)
    expect(blur?.to).toBe(PANE_DROP_BLUR_PX)
    expect(blur?.delay).toBe(0)
    expect(hint?.to).toBe(1)
    expect(hint?.delay).toBe(PANE_DROP_HINT_DELAY)
  })

  it('lets a later enter interrupt an in-flight leave from the current values', async () => {
    const values = makeValues()
    values.blur.set(16)
    values.wash.set(1)
    values.hintOpacity.set(1)
    values.hintY.set(0)
    values.hintScale.set(1)
    const { animate, calls } = mockAnimate()
    const player = createPaneDropPlayer(values, () => false, animate)
    const leaving = player.leave()
    const leaveBlur = calls.find(call => call.value === values.blur)
    expect(leaveBlur?.to).toBe(0)
    player.enter()
    await leaving
    expect(leaveBlur?.stopped).toBe(true)
    expect(values.blur.get()).toBe(16)
    const enterBlur = calls.filter(call => call.value === values.blur).at(-1)
    expect(enterBlur?.to).toBe(PANE_DROP_BLUR_PX)
    expect(enterBlur?.stopped).toBe(false)
  })

  it('snaps through the drop accept when motion is reduced', async () => {
    const values = makeValues()
    const player = createPaneDropPlayer(values, () => true)
    player.enter()
    await player.acceptThenLeave()
    expect(values.blur.get()).toBe(0)
    expect(values.hintOpacity.get()).toBe(0)
  })

  it('plays a distinct accept settle before fading out', async () => {
    const values = makeValues()
    values.blur.set(16)
    values.hintOpacity.set(1)
    values.hintY.set(0)
    values.hintScale.set(1)
    const { animate, calls } = mockAnimate()
    const player = createPaneDropPlayer(values, () => false, animate)
    await player.acceptThenLeave()
    const scales = calls.filter(call => call.value === values.hintScale).map(call => call.to)
    expect(scales[0]).toBe(0.9)
    expect(scales[1]).toBe(1.05)
    expect(scales.at(-1)).toBe(0.92)
    expect(calls.some(call => call.value === values.blur && call.to === 0)).toBe(true)
  })
})
