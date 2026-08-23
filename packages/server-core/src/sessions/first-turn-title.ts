/**
 * First-turn AI title scheduling (#46).
 *
 * The truncated placeholder is shown immediately. The model title is a
 * background job that must not start until the session is idle, so it cannot
 * occupy the live agent's mini-completion channel before the first prompt.
 */

export type FirstTurnTitleFlushPoint = 'agent-ready' | 'prompt-in-flight' | 'session-idle'

export function shouldQueueFirstTurnAiTitle(input: {
  visibleUserCount: number
  isHidden: boolean
  hasExistingName: boolean
  isAutomation: boolean
}): boolean {
  return (
    input.visibleUserCount === 1
    && !input.isHidden
    && !input.hasExistingName
    && !input.isAutomation
  )
}

export function shouldFlushFirstTurnAiTitle(input: {
  hasPending: boolean
  flushPoint: FirstTurnTitleFlushPoint
  queueLength: number
}): boolean {
  return input.hasPending && input.flushPoint === 'session-idle' && input.queueLength === 0
}
