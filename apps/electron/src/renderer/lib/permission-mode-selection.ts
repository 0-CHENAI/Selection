import type { PermissionMode } from '@craft-agent/shared/agent/modes'

/**
 * Parent handlers that gate Full Takeover return `false` when the user
 * cancels (or dismisses) the risk dialog. Void/true means the change
 * was applied or will be applied via the `permissionMode` prop.
 */
export type PermissionModeChangeHandler = (
  mode: PermissionMode,
) => unknown

/**
 * Paint the selected permission mode immediately. If the parent change
 * handler rejects the change (`false` — e.g. Full Takeover confirmation
 * cancelled), revert the optimistic display to `currentMode`.
 *
 * A void or true result keeps the optimistic mode. Callers that apply
 * synchronously (playground) return void; ChatPage returns true after
 * `setPermissionMode`.
 */
export async function applyOptimisticPermissionModeChange(args: {
  nextMode: PermissionMode
  currentMode: PermissionMode
  setOptimisticMode: (mode: PermissionMode) => void
  onChange?: PermissionModeChangeHandler
}): Promise<PermissionMode> {
  const { nextMode, currentMode, setOptimisticMode, onChange } = args
  setOptimisticMode(nextMode)
  if (nextMode === currentMode) return currentMode
  const accepted = await onChange?.(nextMode)
  if (accepted === false) {
    setOptimisticMode(currentMode)
    return currentMode
  }
  return nextMode
}

/**
 * Next mode after Shift+Tab lands on Full Takeover and the user declines.
 * Skip past `allow-all` so cycling continues; return null to stay put
 * (never apply Full Takeover after a declined confirmation).
 */
export function nextModeAfterDeclinedTakeover(
  modes: readonly PermissionMode[],
  declinedIndex: number,
  currentMode: PermissionMode,
): PermissionMode | null {
  if (modes.length === 0) return null
  const nextMode = modes[(declinedIndex + 1) % modes.length]
  if (!nextMode || nextMode === 'allow-all' || nextMode === currentMode) return null
  return nextMode
}
