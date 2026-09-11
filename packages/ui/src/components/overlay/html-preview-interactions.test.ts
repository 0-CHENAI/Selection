import { describe, expect, test } from 'bun:test'
import { iframePoint } from './html-preview-interactions'

describe('HTML iframe interaction coordinates', () => {
  test('anchors wheel and drag points to the scaled iframe in the outer viewport', () => {
    expect(iframePoint({ clientX: 120, clientY: 80 }, { left: -40, top: 25, width: 1600, height: 1200 }, { width: 800, height: 600 }))
      .toEqual({ clientX: 200, clientY: 185 })
  })
  test('preserves cursor position after a translated frame moves beneath it', () => {
    const before = iframePoint({ clientX: 100, clientY: 100 }, { left: 20, top: 30, width: 400, height: 300 }, { width: 800, height: 600 })
    const after = iframePoint({ clientX: 60, clientY: 80 }, { left: 40, top: 40, width: 400, height: 300 }, { width: 800, height: 600 })
    expect(after).toEqual(before)
  })
})
