import { describe, expect, test } from 'bun:test'
import { restoreComposerFocus } from '../restore-composer-focus'

describe('restoreComposerFocus', () => {
  test('defers focus until after an overlay finishes restoring trigger focus', () => {
    let scheduled: (() => void) | undefined
    let focusCount = 0
    const targetRef = {
      current: { focus: () => { focusCount += 1 } },
    }

    restoreComposerFocus(targetRef, (callback) => {
      scheduled = callback
    })

    expect(focusCount).toBe(0)
    scheduled?.()
    expect(focusCount).toBe(1)
  })

  test('is safe when the composer unmounts before the deferred callback', () => {
    let scheduled: (() => void) | undefined
    const targetRef: { current: { focus: () => void } | null } = {
      current: { focus: () => { throw new Error('should not focus') } },
    }

    restoreComposerFocus(targetRef, (callback) => {
      scheduled = callback
    })
    targetRef.current = null

    expect(() => scheduled?.()).not.toThrow()
  })
})
