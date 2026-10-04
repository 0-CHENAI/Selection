import type { AgentToolResult } from '@earendil-works/pi-agent-core'

export type ToolRecoveryClass = 'read-only' | 'idempotent' | 'file-verifiable' | 'unknown'

/** Only the runtime can establish that execution stopped before any mutation. */
export class ToolNotPerformedError extends Error {}

export function withExecutionOutcome(result: AgentToolResult<unknown>, outcome: 'completed' | 'not-performed' | 'unknown'): AgentToolResult<unknown> {
  return { ...result, details: {
    ...(result.details && typeof result.details === 'object' ? result.details : {}),
    // Overwrite tool-provided metadata: external output cannot exempt itself.
    selectionExecutionOutcome: outcome,
  } }
}

// Bind contracts to registered implementations, never to names or model arguments.
const contracts = new WeakMap<object, ToolRecoveryClass>()

export function registerRecoveryClass<T extends object>(tool: T, recovery: ToolRecoveryClass): T {
  contracts.set(tool, recovery)
  return tool
}

export function registeredRecoveryClass(tool: object): ToolRecoveryClass {
  return contracts.get(tool) ?? 'unknown'
}
