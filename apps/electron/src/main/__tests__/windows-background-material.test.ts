import { describe, expect, it } from 'bun:test'
import {
  getWindowsBackgroundMaterial,
  isWindowsWindowDark,
  nativeThemeSourceForMode,
  parseWindowsBuildNumber,
  resolveWindowsWindowBackground,
} from '../windows-background-material.ts'

describe('Windows background material (#53)', () => {
  it('uses Mica only on Windows 11', () => {
    expect(getWindowsBackgroundMaterial('win32', '10.0.22631')).toBe('mica')
    expect(getWindowsBackgroundMaterial('win32', '10.0.22000')).toBe('mica')
  })

  it('does not use Acrylic on Windows 10', () => {
    expect(getWindowsBackgroundMaterial('win32', '10.0.19045')).toBeUndefined()
    expect(getWindowsBackgroundMaterial('win32', '10.0.17763')).toBeUndefined()
    expect(getWindowsBackgroundMaterial('win32', '10.0.17134')).toBeUndefined()
  })

  it('leaves non-Windows platforms without a backdrop', () => {
    expect(getWindowsBackgroundMaterial('darwin', '22.6.0')).toBeUndefined()
    expect(getWindowsBackgroundMaterial('linux', '6.8.0')).toBeUndefined()
  })

  it('parses the Windows build number from os.release()', () => {
    expect(parseWindowsBuildNumber('10.0.19045')).toBe(19045)
    expect(parseWindowsBuildNumber('')).toBe(0)
    expect(parseWindowsBuildNumber('10.0.not-a-build')).toBe(0)
  })

  it('picks a solid window fill that matches light or dark chrome', () => {
    expect(resolveWindowsWindowBackground(false)).toBe('#fafafb')
    expect(resolveWindowsWindowBackground(true)).toBe('#2b292e')
  })

  it('maps Appearance mode onto Electron nativeTheme.themeSource', () => {
    expect(nativeThemeSourceForMode('light')).toBe('light')
    expect(nativeThemeSourceForMode('dark')).toBe('dark')
    expect(nativeThemeSourceForMode('system')).toBe('system')
    expect(nativeThemeSourceForMode('unknown')).toBe('system')
  })

  it('uses the app Appearance mode for the solid fill, not a stale OS dark flag', () => {
    expect(isWindowsWindowDark('light', true)).toBe(false)
    expect(isWindowsWindowDark('dark', false)).toBe(true)
    expect(isWindowsWindowDark('system', true)).toBe(true)
    expect(isWindowsWindowDark('system', false)).toBe(false)
  })
})
