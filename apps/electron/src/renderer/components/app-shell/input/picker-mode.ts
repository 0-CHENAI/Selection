/**
 * Pure render-mode decision for the chat-input model picker.
 *
 * The picker has three mutually-exclusive UIs. Centralizing the truth table
 * here keeps the chevron on the trigger button and the popover content
 * branch in agreement, and makes the rule trivially unit-testable.
 *
 * Precedence (highest first):
 *   1. unavailable     — current connection is gone / error state
 *   2. switcher        — multiple connections configured (any session state)
 *                        so every added provider's models stay selectable
 *   3. flat            — list models for the only / active connection
 *
 * Both `flat` and `switcher` use the same list/row chrome (names, checks,
 * nested thinking under the current connection). Single-connection must not
 * land on a separate effort-first overview card.
 *
 * Multimodal capability is configured in Settings, not in this picker.
 */

export type PickerMode = 'unavailable' | 'switcher' | 'flat'

export interface PickerModeInput {
  connectionUnavailable: boolean
  /** Total number of configured connections in the workspace. */
  connectionCount: number
}

export function derivePickerMode(input: PickerModeInput): PickerMode {
  if (input.connectionUnavailable) return 'unavailable'
  if (input.connectionCount > 1) return 'switcher'
  return 'flat'
}

/** Controls for the active model belong only on its connection's page. */
export function pickerPageShowsCurrentConnection(mode: PickerMode, shown: string | null | undefined, current: string | null | undefined): boolean {
  return mode === 'flat' || (mode === 'switcher' && !!current && shown === current)
}
