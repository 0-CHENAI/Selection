import { isWebUI, isWindows } from './platform'

/** Keep Selection chrome left of the Windows overlay caption buttons. */
export const WINDOWS_CAPTION_INSET_PADDING =
  'max(12px, calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%)))'

export function resolveWindowsCaptionInsetStyle(
  windows: boolean,
  webui: boolean,
): { paddingRight: string } | undefined {
  if (!windows || webui) return undefined
  return { paddingRight: WINDOWS_CAPTION_INSET_PADDING }
}

export function windowsCaptionInsetStyle(): { paddingRight: string } | undefined {
  return resolveWindowsCaptionInsetStyle(isWindows, isWebUI)
}
