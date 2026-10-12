import type { Agent, AgentToolResult } from '@earendil-works/pi-agent-core'

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

/** SDK argument validation and before-tool blocks bypass the tool wrapper entirely. */
export function installToolExecutionOutcomeTracking(agent: Agent): void {
  const executed = new WeakSet<AgentToolResult<unknown>['content']>(), afterToolCall = agent.afterToolCall
  agent.afterToolCall = async (context, signal) => {
    // The SDK reaches this hook only after invoking execute, including thrown errors.
    // Its finalizer keeps this content reference, even for concurrent reused IDs.
    try {
      const result = await afterToolCall?.(context, signal)
      const content = result?.content ?? context.result.content ?? []
      executed.add(content)
      return { ...result, content }
    } catch (error) {
      const content = [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }]
      executed.add(content)
      return { content, details: {}, isError: true }
    }
  }
  agent.subscribe(event => {
    if (event.type === 'tool_execution_end' && event.isError && !executed.has(event.result.content)) {
      event.result.details = withExecutionOutcome(event.result, 'not-performed').details
    }
  })
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
