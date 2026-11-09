import { isWebUI, isWindows } from './platform'

/** Keep Selection chrome left of the Windows overlay caption buttons. */
export const WINDOWS_CAPTION_INSET_PADDING =
  'max(12px, calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%)))'

function isWindowsDesktop(windows: boolean, webui: boolean): boolean {
  return windows && !webui
}

export function resolveWindowsCaptionInsetStyle(
  windows: boolean,
  webui: boolean,
): { paddingRight: string } | undefined {
  if (!isWindowsDesktop(windows, webui)) return undefined
  return { paddingRight: WINDOWS_CAPTION_INSET_PADDING }
}

/** Stop a full-bleed top strip under the native min/max/close overlay. */
export function resolveWindowsCaptionEdgeStyle(
  windows: boolean,
  webui: boolean,
): { right: string } | undefined {
  if (!isWindowsDesktop(windows, webui)) return undefined
  return { right: WINDOWS_CAPTION_INSET_PADDING }
}

export function windowsCaptionInsetStyle(): { paddingRight: string } | undefined {
  return resolveWindowsCaptionInsetStyle(isWindows, isWebUI)
}

export function windowsCaptionEdgeStyle(): { right: string } | undefined {
  return resolveWindowsCaptionEdgeStyle(isWindows, isWebUI)
}
