import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldUseVibrancyOverlay } from '../theme-chrome'

describe('shouldUseVibrancyOverlay (#53)', () => {
  it('keeps the semi-transparent wash only for the macOS desktop app', () => {
    expect(shouldUseVibrancyOverlay(true, false)).toBe(true)
  })

  it('paints a solid surface on Windows, Linux, and the web UI', () => {
    expect(shouldUseVibrancyOverlay(false, false)).toBe(false)
    expect(shouldUseVibrancyOverlay(true, true)).toBe(false)
    expect(shouldUseVibrancyOverlay(false, true)).toBe(false)
  })
})

describe('Windows solid chrome CSS (#53)', () => {
  it('fills html/body/#root when the vibrancy overlay is off', () => {
    const css = readFileSync(join(import.meta.dir, '../../index.css'), 'utf8')
    expect(css).toContain('html:not([data-theme-override]):not([data-scenic])')
    expect(css).toContain('background-color: var(--background)')
  })
})
