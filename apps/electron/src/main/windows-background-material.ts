/** Windows 11 (Sun Valley) introduced Mica. Acrylic on Windows 10 tints chrome dark. */
export const WINDOWS_11_BUILD = 22000

export const WINDOWS_LIGHT_WINDOW_BACKGROUND = '#fafafb'
export const WINDOWS_DARK_WINDOW_BACKGROUND = '#2b292e'

export function parseWindowsBuildNumber(releaseString: string): number {
  const buildNumber = parseInt(releaseString.split('.')[2] || '0', 10)
  return Number.isFinite(buildNumber) ? buildNumber : 0
}

/**
 * Native window backdrop.
 * Windows 11 gets Mica. Windows 10 Acrylic is a dark wash that breaks light mode (#53).
 */
export function getWindowsBackgroundMaterial(
  platform: NodeJS.Platform,
  releaseString: string,
): 'mica' | undefined {
  if (platform !== 'win32') return undefined
  return parseWindowsBuildNumber(releaseString) >= WINDOWS_11_BUILD ? 'mica' : undefined
}

export function resolveWindowsWindowBackground(isDark: boolean): string {
  return isDark ? WINDOWS_DARK_WINDOW_BACKGROUND : WINDOWS_LIGHT_WINDOW_BACKGROUND
}

export function nativeThemeSourceForMode(mode: string): 'system' | 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  return 'system'
}

export function isWindowsWindowDark(mode: string, systemIsDark: boolean): boolean {
  const source = nativeThemeSourceForMode(mode)
  return source === 'dark' || (source === 'system' && systemIsDark)
}
