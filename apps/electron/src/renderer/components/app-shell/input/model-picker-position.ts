export type ModelPickerSide = 'top' | 'bottom'

/** Keep the chosen edge stable while pages resize; scroll long lists within it. */
export function modelPickerPlacement(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  side?: ModelPickerSide,
): { side: ModelPickerSide; maxHeight: number } {
  const gap = 16 // 8px trigger offset plus 8px viewport margin
  const above = Math.max(0, trigger.top - gap)
  const below = Math.max(0, viewportHeight - trigger.bottom - gap)
  const preferred = side ?? (above < 160 && below > above ? 'bottom' : 'top')
  const available = preferred === 'top' ? above : below
  const opposite = preferred === 'top' ? below : above
  // Preserve the edge during page transitions, but recover if a window resize
  // or scrolling leaves the chosen side too small to operate the menu.
  const chosen = side && available < 120 && opposite >= 160 && opposite > available + 40
    ? (side === 'top' ? 'bottom' : 'top') : preferred
  return { side: chosen, maxHeight: Math.max(1, Math.min(384, viewportHeight * 0.7, chosen === 'top' ? above : below)) }
}
