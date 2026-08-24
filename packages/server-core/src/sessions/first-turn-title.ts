/**
 * First-turn AI title scheduling (#46).
 *
 * The truncated placeholder is shown immediately. The model title waits until
 * the session is idle so it cannot occupy the live agent's mini-completion
 * channel before the first prompt.
 */

export type PendingFirstTurnAiTitle = {
  prompt: string
  placeholder: string
}

export type FirstTurnAiTitleDecision = 'start' | 'defer' | 'drop'

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
  queueLength: number
}): boolean {
  return input.hasPending && input.queueLength === 0
}

/**
 * Decide whether a queued first-turn title may call the model now.
 * `defer` puts the job back on the session so the next idle flush retries it.
 * `drop` abandons it (deleted session or the user already renamed).
 */
export function decidePendingFirstTurnAiTitle(input: {
  sessionAlive: boolean
  isProcessing: boolean
  queueLength: number
  currentName: string | undefined
  placeholder: string
}): FirstTurnAiTitleDecision {
  if (!input.sessionAlive) return 'drop'
  if (input.currentName !== input.placeholder) return 'drop'
  if (input.isProcessing || input.queueLength > 0) return 'defer'
  return 'start'
}

export function shouldCommitFirstTurnAiTitle(input: {
  sessionAlive: boolean
  currentName: string | undefined
  placeholder: string
}): boolean {
  return input.sessionAlive && input.currentName === input.placeholder
}
