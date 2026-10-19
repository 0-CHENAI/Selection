import { describe, expect, test } from 'bun:test'
import {
  capsuleContentOpacity,
  panelContentOpacity,
  taskCardContentMotion,
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
