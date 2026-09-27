export type ToolRecoveryClass = 'read-only' | 'idempotent' | 'file-verifiable' | 'unknown'

// Bind contracts to registered implementations, never to names or model arguments.
const contracts = new WeakMap<object, ToolRecoveryClass>()

export function registerRecoveryClass<T extends object>(tool: T, recovery: ToolRecoveryClass): T {
  contracts.set(tool, recovery)
  return tool
}

export function registeredRecoveryClass(tool: object): ToolRecoveryClass {
  return contracts.get(tool) ?? 'unknown'
}
