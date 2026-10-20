import { describe, expect, test } from 'bun:test'
import {
  capsuleContentOpacity,
  panelContentOpacity,
  taskCardContentMotion,
  taskCardRestingBox,
  taskCardScrollDockFrame,
  taskCardShellSize,
} from '../task-card-motion'

const panel = { width: 420, height: 280 }
const capsule = { width: 220, height: 36 }

describe('task card shape crossfade', () => {
  test('panel text is gone once the shell is 60% of the panel height', () => {
    const height = panel.height * 0.6
    const progress = (height - capsule.height) / (panel.height - capsule.height)
    expect(taskCardShellSize(progress, panel, capsule).height).toBeCloseTo(height, 5)
    expect(panelContentOpacity(progress, panel.height, capsule.height)).toBeLessThanOrEqual(0.2)
    expect(panelContentOpacity(progress - 0.02, panel.height, capsule.height)).toBe(0)
    const lineClip = 1 - 16 / (panel.height - capsule.height)
    expect(panelContentOpacity(lineClip, panel.height, capsule.height)).toBeLessThanOrEqual(0.2)
  })

  test('capsule stays hidden until the shell is 80% of the way to the capsule', () => {
    expect(capsuleContentOpacity(1)).toBe(0)
    expect(capsuleContentOpacity(0.25)).toBe(0)
    expect(capsuleContentOpacity(0.2)).toBe(0)
    expect(capsuleContentOpacity(0.1)).toBeCloseTo(0.5)
    expect(capsuleContentOpacity(0)).toBe(1)
  })

  test('the two layers are not clearly visible at the same time', () => {
    for (let step = 0; step <= 20; step++) {
      const progress = step / 20
      const frame = taskCardContentMotion({ progress, panel, capsule, direction: 'collapse' })
      expect(frame.panelOpacity === 0 || frame.capsuleOpacity === 0).toBe(true)
      expect(frame.panelY).toBeGreaterThanOrEqual(0)
      expect(frame.capsuleY).toBe(0)
    }
  })

  test('collapse moves content downward and expand moves it upward', () => {
    const collapsing = taskCardContentMotion({ progress: 0.9, panel, capsule, direction: 'collapse' })
    expect(collapsing.panelY).toBeGreaterThan(0)
    expect(collapsing.capsuleY).toBeGreaterThanOrEqual(0)
    const expanding = taskCardContentMotion({ progress: 0.05, panel, capsule, direction: 'expand' })
    expect(expanding.capsuleY).toBeLessThan(0)
    expect(expanding.panelY).toBeLessThanOrEqual(0)
  })

  test('sampled collapse and expand frames do not overlap readable text', () => {
    const samples = [1, 0.8, 0.6, 0.4, 0.2, 0]
    for (const progress of samples) {
      const collapsing = taskCardContentMotion({ progress, panel, capsule, direction: 'collapse' })
      const expanding = taskCardContentMotion({ progress, panel, capsule, direction: 'expand' })
      const shellAtSixty = panel.height * 0.6
      if (collapsing.height <= shellAtSixty + 0.01) {
        expect(collapsing.panelOpacity).toBeLessThanOrEqual(0.2)
      }
      if (progress + 1e-9 >= 0.2) {
        expect(collapsing.capsuleOpacity).toBeCloseTo(0, 5)
        expect(expanding.capsuleOpacity).toBeCloseTo(0, 5)
      }
      expect(collapsing.panelOpacity === 0 || collapsing.capsuleOpacity === 0).toBe(true)
      expect(expanding.panelOpacity === 0 || expanding.capsuleOpacity === 0).toBe(true)
      expect(collapsing.panelY).toBeGreaterThanOrEqual(0)
      expect(collapsing.capsuleY).toBeGreaterThanOrEqual(0)
      expect(expanding.panelY).toBeLessThanOrEqual(0)
      expect(expanding.capsuleY).toBeLessThanOrEqual(0)
    }
    const collapsed = taskCardContentMotion({ progress: 0, panel, capsule, direction: 'collapse' })
    expect(collapsed.panelOpacity).toBe(0)
    expect(collapsed.capsuleOpacity).toBe(1)
    const open = taskCardContentMotion({ progress: 1, panel, capsule, direction: 'expand' })
    expect(open.panelOpacity).toBe(1)
    expect(open.capsuleOpacity).toBe(0)
  })

  test('a resting count change moves the measured box and does not scale it', () => {
    const from = { width: 84, height: 30 }
    const to = { width: 96, height: 30 }
    expect(taskCardRestingBox(from, to, 0)).toEqual(from)
    expect(taskCardRestingBox(from, to, 1)).toEqual(to)
    expect(taskCardRestingBox(from, to, 0.5)).toEqual({ width: 90, height: 30 })
    expect(taskCardRestingBox(from, to, -0.4)).toEqual(from)
    expect(taskCardRestingBox(from, to, 1.4)).toEqual(to)
    const grown = taskCardRestingBox({ width: 120, height: 36 }, { width: 120, height: 180 }, 0.25)
    expect(grown).toEqual({ width: 120, height: 72 })
  })

  test('scroll dock frame starts on the pill edge and keeps the group centered', () => {
    const button = 30
    const gap = 6
    const hidden = taskCardScrollDockFrame(0, button, gap)
    expect(hidden).toEqual({ width: 0, opacity: 0, margin: 0, span: 0, pillShift: 0 })
    const shown = taskCardScrollDockFrame(1, button, gap)
    expect(shown).toEqual({ width: 30, opacity: 1, margin: 6, span: 36, pillShift: -18 })
    const mid = taskCardScrollDockFrame(0.5, button, gap)
    expect(mid).toEqual({ width: 15, opacity: 0.5, margin: 3, span: 18, pillShift: -9 })
    expect(taskCardScrollDockFrame(-0.2, button, gap)).toEqual(hidden)
    expect(taskCardScrollDockFrame(1.4, button, gap)).toEqual(shown)
    let previous = hidden.span
    for (let step = 0; step <= 20; step++) {
      const frame = taskCardScrollDockFrame(step / 20, button, gap)
      expect(frame.opacity).toBeCloseTo(step / 20, 5)
      expect(frame.span).toBeCloseTo(frame.width + frame.margin, 5)
      expect(frame.pillShift + frame.span / 2).toBeCloseTo(0, 5)
      expect(frame.span).toBeGreaterThanOrEqual(previous)
      expect(frame.width).toBeLessThanOrEqual(button)
      previous = frame.span
    }
  })

  test('reduced motion snaps without blur or shift', () => {
    const frame = taskCardContentMotion({
      progress: 0.4,
      panel,
      capsule,
      direction: 'collapse',
      reduceMotion: true,
    })
    expect(frame.panelOpacity).toBe(0)
    expect(frame.capsuleOpacity).toBe(1)
    expect(frame.panelY).toBe(0)
    expect(frame.capsuleY).toBe(0)
    expect(frame.panelBlur).toBe(0)
    expect(frame.height).toBe(capsule.height)
  })
})
