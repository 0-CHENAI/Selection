export type OrchestrationDisplayState = 'running' | 'completed' | 'need-to-check' | null

/**
 * Worker and reviewer sessions are implementation details of a Swarm run.
 * They remain directly addressable from run details, but never appear as peers
 * of their parent in ordinary session/project lists.
 */
export function isOrdinarySessionVisible(session: {
  hidden?: boolean
  orchestrationRole?: string
}): boolean {
  if (session.hidden) return false
  return session.orchestrationRole !== 'worker' && session.orchestrationRole !== 'reviewer'
}

/**
 * Collapse internal run states into the three title treatments promised by the
 * preview. Unknown non-terminal states fail closed into need-to-check.
 */
export function deriveOrchestrationDisplayState(status?: string): OrchestrationDisplayState {
  if (!status) return null
  if (status === 'completed') return 'completed'
  if (status === 'running' || status === 'verifying' || status === 'repairing' || status === 'pausing') {
    return 'running'
  }
  return 'need-to-check'
}
