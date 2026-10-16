import type { NavigationState } from '../../../shared/types'

/**
 * Conversation column while immersive layout is applied.
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
 * Immersive mode hides the left nav, the middle list, and trailing panels.
 * Settings and other navigators keep their columns so those pages stay usable.
 * Compact and multi-select also keep the list: compact already owns the drill-in,
 * and multi-select is meaningless without the list.
 */
export function shouldApplyImmersiveLayout(input: ImmersiveLayoutInput): boolean {
  return input.enabled && input.isConversation && !input.isCompact && !input.isMultiSelect
}

export function isConversationSurface(nav: NavigationState | null | undefined): boolean {
  return !!nav && nav.navigator === 'sessions' && nav.viewMode !== 'board'
}

/**
 * Visual widths while immersive layout is on. Stored sidebar and list widths
 * are intentionally not part of this result, so turning the mode off restores them.
 */
export function immersiveDisplayWidths(
  stored: { sidebar: number; navigator: number },
  apply: boolean,
): { sidebar: number; navigator: number } {
  if (!apply) return stored
  return { sidebar: 0, navigator: 0 }
}
