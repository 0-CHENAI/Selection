/** Gap between the centered capsule and the toolbar buttons on either side. */
export const TOOLBAR_CLUSTER_GAP = 8

/**
 * Border box shared by the composer toolbar controls.
 * Permission, session files, the collapsed task pill, and the back-to-bottom
 * circle all use this. The document font size is 15px, so a rem height such as
 * `h-7` (1.75rem = 26.25px) is not this box.
 */
export const TOOLBAR_CONTROL_HEIGHT = 30

/** Glass shell border on each edge (`border` = 1px). Included in the control's border box. */
export const TOOLBAR_SHELL_BORDER = 1

/**
 * Collapsed pill content box. The shell adds one border on the top and bottom,
 * so this plus both borders is `TOOLBAR_CONTROL_HEIGHT`.
 */
export const TOOLBAR_CAPSULE_CONTENT_HEIGHT = TOOLBAR_CONTROL_HEIGHT - TOOLBAR_SHELL_BORDER * 2

/**
 * Collapsed toolbar capsule corners. Half the control, so a resting capsule is a pill.
 * The shell spring moves this to the panel's 16px radius; it is not a separate scale.
 */
export const TOOLBAR_CAPSULE_RADIUS = TOOLBAR_CONTROL_HEIGHT / 2

/** Fused back-to-bottom control. Same border box as the toolbar buttons, so it stays a circle. */
export const TOOLBAR_SCROLL_SIZE = TOOLBAR_CONTROL_HEIGHT

export const TOOLBAR_BUTTON_GAP = 6

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
