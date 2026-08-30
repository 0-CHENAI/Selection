import { describe, expect, it } from 'bun:test'
import { shouldSubmitProjectNameOnKeyDown } from '../project-name-submit'

describe('project name keyboard submission (#148)', () => {
  it('does not submit Enter while composition is active', () => {
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter' }, true, true)).toBe(false)
  })

  it('does not submit when the native event reports composition', () => {
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter', isComposing: true }, true, false)).toBe(false)
  })

  it('does not submit Chromium IME process-key events', () => {
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter', keyCode: 229 }, true, false)).toBe(false)
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter', which: 229 }, true, false)).toBe(false)
  })

  it('submits the next ordinary Enter after composition ends', () => {
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter' }, true, false)).toBe(true)
  })

  it('does not submit other keys or an empty project name', () => {
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Tab' }, true, false)).toBe(false)
    expect(shouldSubmitProjectNameOnKeyDown({ key: 'Enter' }, false, false)).toBe(false)
  })
})
