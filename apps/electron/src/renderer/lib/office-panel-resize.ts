/** Scoped to the Office panel DOM node; no per-frame React context updates. */
export const OFFICE_PANEL_RESIZE_EVENT = 'office-panel-resize'

/**
 * The panel is a flex item of the office layout, but its DOM parent is
 * `display: contents` and has no box. Measuring that parent yields a zero
 * width, so a drag bails out. Walk to the layout box the container query uses.
 */
export function officePanelWidthBasis(panel: HTMLElement): HTMLElement | null {
  let node = panel.parentElement
  while (node) {
    if (getComputedStyle(node).display !== 'contents' && node.getBoundingClientRect().width > 0) return node
    node = node.parentElement
  }
  return null
}
