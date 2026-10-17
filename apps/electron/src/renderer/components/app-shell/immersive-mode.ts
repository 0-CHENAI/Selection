import type { NavigationState } from '../../../shared/types'

/**
 * Conversation column while immersive layout is applied and nothing shares the row.
 * Wide enough for the 840px message column plus the record rail and page padding.
 */
export const IMMERSIVE_CHAT_MAX_WIDTH = 960

export interface ImmersiveLayoutInput {
  enabled: boolean
  /** Sessions navigator showing a conversation, including the empty draft. */
  isConversation: boolean
  /** Narrow/mobile shell already uses its own single-column navigation. */
  isCompact: boolean
  /** The session list is the surface the user is operating on. */
  isMultiSelect: boolean
}

/**
 * Immersive mode hides the left nav and the middle list — the same columns
 * ⌘+. used to collapse. Reference sources, Office, and other trailing panels
 * stay open. Settings and other navigators keep their columns so those pages
 * stay usable. Compact and multi-select also keep the list: compact already
 * owns the drill-in, and multi-select is meaningless without the list.
 */
export function shouldApplyImmersiveLayout(input: ImmersiveLayoutInput): boolean {
  return input.enabled && input.isConversation && !input.isCompact && !input.isMultiSelect
}

export function isConversationSurface(nav: NavigationState | null | undefined): boolean {
  return !!nav && nav.navigator === 'sessions' && nav.viewMode !== 'board'
}

/**
 * Visual widths while the left columns are collapsed. Stored sidebar and list
 * widths are intentionally not part of this result, so turning the mode off
 * restores them. Immersive mode and a focused-window launch share this path.
 */
export function immersiveDisplayWidths(
  stored: { sidebar: number; navigator: number },
  apply: boolean,
): { sidebar: number; navigator: number } {
  if (!apply) return stored
  return { sidebar: 0, navigator: 0 }
}

/**
 * One switch for ⌘/Ctrl+B and ⌘/Ctrl+.. A focused window can also start with
 * the left columns hidden; the first press clears that and turns the preference off.
 */
export function nextImmersiveToggle(input: { immersive: boolean; launchHidden: boolean }): { immersive: boolean; launchHidden: boolean } {
  const hiding = input.immersive || input.launchHidden
  return { immersive: !hiding, launchHidden: false }
}

/** Button, menu, and aria state. A focused window counts as on until the user toggles. */
export function immersiveTogglePressed(input: { immersive: boolean; launchHidden: boolean }): boolean {
  return input.immersive || input.launchHidden
}

/** Old ⌘+. stored its own flag. Fold it into the immersive preference once. */
export function readImmersivePreference(stored: { immersive: boolean; legacyFocus: boolean }): boolean {
  return stored.immersive || stored.legacyFocus
}

/**
 * Outer width of the conversation panel.
 * Null when Office (or another trailing panel) is open, so the conversation
 * fills the space beside it. The sources column lives inside this panel and
 * clears the cap while `[data-source-layout=open]` is present.
 */
export function immersivePanelMaxWidth(apply: boolean, trailingPanelOpen: boolean): number | null {
  if (!apply || trailingPanelOpen) return null
  return IMMERSIVE_CHAT_MAX_WIDTH
}
