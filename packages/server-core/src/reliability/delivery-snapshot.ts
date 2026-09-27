import type { SwarmRunNodeDto } from '@craft-agent/shared/protocol'
import type { IsolatedWorkspace } from './isolated-workspace'

/** The server owns presentation state, including interrupted transient stages. */
export function deliverySnapshot(state: IsolatedWorkspace | undefined, active: boolean): SwarmRunNodeDto['artifactDelivery'] {
  if (!state?.deliveryContract) return undefined
  const progress = state.deliveryProgress
  const phase = state.delivery ? 'integrated'
    : progress?.phase === 'conflict' || progress?.phase === 'validation-failed' ? progress.phase
      : !active ? 'needs-attention'
        : state.pendingDelivery ? 'integrating'
          : progress?.phase ?? 'executing'
  return {
    phase,
    outputs: { ...state.deliveryContract.outputs },
    checks: [...(state.delivery?.checks ?? progress?.checks ?? [])],
    conflicts: state.delivery ? [] : [...(progress?.conflicts ?? [])],
  }
}
