/** Gap between the centered capsule and the toolbar buttons on either side. */
export const TOOLBAR_CLUSTER_GAP = 8

/** Composer toolbar controls (permission, files, docked capsule) share this height. */
export const TOOLBAR_CONTROL_HEIGHT = 30

/** Collapsed capsule corners. The expanded panel still uses the 16px shell radius. */
export const TOOLBAR_CAPSULE_RADIUS = 8

/** Fused back-to-bottom control while it sits in the toolbar row. */
export const TOOLBAR_SCROLL_SIZE = 30

export const TOOLBAR_BUTTON_GAP = 6

/**
 * `x` of the toolbar back-to-bottom button when its left edge sits on the row center.
 * Undocked, shift by half its width so the button itself is centered.
 * Docked, its left edge is the shell's right edge plus the gap (the shell stays centered).
 */
export function toolbarScrollX(input: {
  docked: boolean
  shellWidth: number
  button?: number
  gap?: number
}): number {
  const button = input.button ?? TOOLBAR_SCROLL_SIZE
  if (!input.docked || !(input.shellWidth > 0)) return -button / 2
  return input.shellWidth / 2 + (input.gap ?? TOOLBAR_BUTTON_GAP)
}

/** Same cap the floating panel has always used. */
export const TOOLBAR_SHELL_MAX = 420

export interface ToolbarCapsuleFitInput {
  rowWidth: number
  leftTextWidth: number
  rightTextWidth: number
  leftIconWidth: number
  rightIconWidth: number
  shellNaturalWidth: number
  shellMinWidth: number
  /** Scroll button plus the gap, hanging off the capsule's right. */
  endReserve: number
  iconOnly: boolean
  gap?: number
  /** Stay icon-only until the text buttons clear the minimum shell by this many pixels. */
  restoreSlack?: number
}

export interface ToolbarCapsuleFit {
  iconOnly: boolean
  /** Max border-box width of the centered capsule and the expanded panel. */
  shellMaxWidth: number
}

/**
 * Widest shell that stays centered on the row without crossing either side.
 * The scroll button consumes `endReserve` on the right of that shell.
 */
export function centeredShellBudget(
  rowWidth: number,
  leftWidth: number,
  rightWidth: number,
  endReserve: number,
  gap: number,
): number {
  const half = rowWidth / 2
  const leftRoom = half - leftWidth - gap
  const rightRoom = half - rightWidth - gap - endReserve
  return Math.max(0, Math.floor(2 * Math.min(leftRoom, rightRoom)))
}

export function toolbarCapsuleFit(input: ToolbarCapsuleFitInput): ToolbarCapsuleFit {
  const gap = input.gap ?? TOOLBAR_CLUSTER_GAP
  const slack = input.restoreSlack ?? 4
  const textBudget = centeredShellBudget(
    input.rowWidth,
    input.leftTextWidth,
    input.rightTextWidth,
    input.endReserve,
    gap,
  )
  const iconBudget = centeredShellBudget(
    input.rowWidth,
    input.leftIconWidth,
    input.rightIconWidth,
    input.endReserve,
    gap,
  )
  const iconOnly = input.iconOnly
    ? textBudget < input.shellMinWidth + slack
    : input.shellMinWidth > textBudget
  return {
    iconOnly,
    shellMaxWidth: Math.max(0, Math.min(TOOLBAR_SHELL_MAX, iconOnly ? iconBudget : textBudget)),
  }
}
