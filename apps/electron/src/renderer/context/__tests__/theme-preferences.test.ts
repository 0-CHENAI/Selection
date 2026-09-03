import { describe, expect, it } from 'bun:test'
import { resolveStartupColorTheme } from '../theme-preferences'

describe('resolveStartupColorTheme', () => {
  it('lets config.json override a different cached theme', () => {
    expect(resolveStartupColorTheme('dracula', 'nord')).toBe('dracula')
  })

  it('treats the configured default theme as authoritative', () => {
    expect(resolveStartupColorTheme('default', 'dracula')).toBe('default')
  })

  it('keeps the cached theme when config cannot provide a value', () => {
    expect(resolveStartupColorTheme(undefined, 'nord')).toBe('nord')
  })

  it('rejects malformed config and cache values', () => {
    expect(resolveStartupColorTheme(42, '  ', 'catppuccin')).toBe('catppuccin')
  })

  it('normalizes a configured theme id', () => {
    expect(resolveStartupColorTheme('  dracula  ', 'nord')).toBe('dracula')
  })
})
