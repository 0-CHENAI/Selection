export type SwarmBadgeState = 'idle' | 'enabled' | 'running'

export function resolveSwarmBadgeState(enabled: boolean, running: boolean): SwarmBadgeState {
  if (running) return 'running'
  return enabled ? 'enabled' : 'idle'
}
