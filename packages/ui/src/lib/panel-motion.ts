/** Shared critically damped transition for sidebar and reference-panel visibility. */
export const PANEL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

/** Open/close push. Reduced motion snaps so the layout does not travel. */
export function panelPushTransition(reduceMotion: boolean | null | undefined) {
  return reduceMotion ? { duration: 0 } : PANEL_SPRING
}
