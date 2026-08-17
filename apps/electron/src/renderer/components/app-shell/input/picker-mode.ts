/**
 * Pure render-mode decision for the chat-input model picker.
 *
 * The picker has three mutually-exclusive UIs. Centralizing the truth table
 * here keeps the chevron on the trigger button and the popover content
 * branch in agreement, and makes the rule trivially unit-testable.
 *
 * Precedence (highest first):
 *   1. unavailable     — current connection is gone / error state
 *   2. switcher        — empty session AND multiple connections configured
 *                        (lets the user pick a different connection BEFORE
 *                        the first message locks the session to one)
 *   3. flat            — list models for the active connection
 *
 * Multimodal capability is configured in Settings, not in this picker.
 */

export type PickerMode = 'unavailable' | 'switcher' | 'flat'

export interface PickerModeInput {
  connectionUnavailable: boolean
  /** True when the session has no messages yet. */
  isEmptySession: boolean
  /** Total number of configured connections in the workspace. */
  connectionCount: number
}

export function derivePickerMode(input: PickerModeInput): PickerMode {
  if (input.connectionUnavailable) return 'unavailable'
  if (input.isEmptySession && input.connectionCount > 1) return 'switcher'
  return 'flat'
}
