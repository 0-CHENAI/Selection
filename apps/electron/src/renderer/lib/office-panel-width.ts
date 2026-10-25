import { officePanelWidthBasis } from './office-panel-resize'

/**
 * The conversation column has to stay wide enough for the collapsed PPT
 * result row and the composer controls. The row sits inside the message
 * padding, the record rail and the card padding, so the content panel itself
 * needs about 560px before the filename has to ellipsize.
 */
export const OFFICE_CHAT_MIN_PX = 560
export const OFFICE_PANEL_MIN_PX = 320
export const OFFICE_DEFAULT_RATIO = 0.45
export const OFFICE_LEADING_WIDTH_VAR = '--office-leading-width'

export function officePanelLimits(
  container: number,
  leading: number,
  chatMin = OFFICE_CHAT_MIN_PX,
  officeMin = OFFICE_PANEL_MIN_PX,
) {
  const room = Math.max(0, container - Math.max(0, leading))
  const max = Math.max(0, room - chatMin)
  const min = Math.min(officeMin, max)
  return { min, max, room }
}

/** Preferred width, or 45% of the room after the sidebar and list, clamped so the chat stays readable. */
export function officePanelWidth(container: number, leading: number, preferred?: number): number {
  const { min, max, room } = officePanelLimits(container, leading)
  const target = preferred ?? room * OFFICE_DEFAULT_RATIO
  return Math.min(max, Math.max(min, target))
}

/** Container-query width. A dragged preference still cannot push the chat under the minimum. */
export function officePanelWidthCss(): string {
  const room = `(100cqw - var(${OFFICE_LEADING_WIDTH_VAR}, 0px))`
  const preferred = `var(--office-panel-preferred-width, calc(${OFFICE_DEFAULT_RATIO} * ${room}))`
  const cap = `max(0px, calc(100cqw - var(${OFFICE_LEADING_WIDTH_VAR}, 0px) - ${OFFICE_CHAT_MIN_PX}px))`
  return `min(max(${OFFICE_PANEL_MIN_PX}px, ${preferred}), ${cap})`
}

export function measureOfficeLeadingWidth(layout: HTMLElement): number {
  const total = layout.getBoundingClientRect().width
  let used = 0
  layout.querySelectorAll('[data-panel-role="content"]').forEach(node => {
    used += node.getBoundingClientRect().width
  })
  const office = layout.querySelector('[data-office-panel]')
  if (office) used += office.getBoundingClientRect().width
  return Math.max(0, total - used)
}

export function officeLeadingWidthPx(panel: HTMLElement): number {
  const basis = officePanelWidthBasis(panel)
  if (!basis) return 0
  const raw = getComputedStyle(basis).getPropertyValue(OFFICE_LEADING_WIDTH_VAR)
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Write the sidebar + list chrome onto the office layout. Content and the office panel split whatever is left. */
export function bindOfficeLeadingWidth(layout: HTMLElement): () => void {
  let observer: ResizeObserver | null = null
  const write = () => {
    const measured = Math.round(measureOfficeLeadingWidth(layout))
    const current = Number.parseFloat(layout.style.getPropertyValue(OFFICE_LEADING_WIDTH_VAR))
    if (Number.isFinite(current) && Math.abs(current - measured) <= 1) return
    layout.style.setProperty(OFFICE_LEADING_WIDTH_VAR, `${measured}px`)
  }
  const watch = () => {
    observer?.disconnect()
    observer = new ResizeObserver(write)
    observer.observe(layout)
    layout.querySelectorAll('[data-panel-role="sidebar"], [data-panel-role="navigator"], [data-panel-role="content"], [data-office-panel]').forEach(node => {
      observer?.observe(node)
    })
    write()
  }
  watch()
  const mutations = new MutationObserver(watch)
  mutations.observe(layout, { childList: true, subtree: true })
  return () => {
    observer?.disconnect()
    mutations.disconnect()
  }
}
