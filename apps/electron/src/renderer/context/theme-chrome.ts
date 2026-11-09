/**
 * The 50% `data-theme-override` wash exists so macOS vibrancy (and only
 * vibrancy) can show through the chrome. Windows 10 has no light Acrylic;
 * keeping that overlay on a transparent sidebar/top bar is the gray mask
 * in #53. Web UI is a normal browser tab and also needs a solid surface.
 */
export function shouldUseVibrancyOverlay(isMacOS: boolean, isWebUI = false): boolean {
  return isMacOS && !isWebUI
}
