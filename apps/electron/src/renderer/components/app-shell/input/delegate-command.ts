export const DELEGATE_COMMAND_PREFIX = '/delegate'

export type DelegateCommandParseResult =
  | { kind: 'ordinary'; message: string }
  | { kind: 'delegate'; message: string }

export type DelegateCommandSubmission =
  | { allowed: true; kind: 'ordinary' | 'delegate'; message: string }
  | {
      allowed: false
      kind: 'delegate'
      message: string
      reason: 'empty-task' | 'session-processing'
    }

/**
 * Parse only the explicit slash-command prefix. Natural-language references to
 * agents, parallel work, or delegation are intentionally ordinary messages.
 */
export function parseDelegateCommand(input: string): DelegateCommandParseResult {
  const message = input.trim()
  const match = /^\/delegate(?:\s+([\s\S]*))?$/i.exec(message)
  if (!match) return { kind: 'ordinary', message: input }
  return { kind: 'delegate', message: (match[1] ?? '').trim() }
}

/**
 * Delegation cannot enter the normal mid-stream queue. Its authorization is
 * scoped to the turn that starts immediately from this visible user action.
 */
export function assessDelegateCommandSubmission(
  input: string,
  sessionIsProcessing: boolean,
): DelegateCommandSubmission {
  const parsed = parseDelegateCommand(input)
  if (parsed.kind === 'ordinary') return { ...parsed, allowed: true }
  if (!parsed.message) return { ...parsed, allowed: false, reason: 'empty-task' }
  if (sessionIsProcessing) {
    return { ...parsed, allowed: false, reason: 'session-processing' }
  }
  return { ...parsed, allowed: true }
}

/** Keep the authorization command visible while the user writes the task. */
export function buildDelegateCommandDraft(remainder: string): string {
  const task = remainder.trim()
  return task ? `${DELEGATE_COMMAND_PREFIX} ${task}` : `${DELEGATE_COMMAND_PREFIX} `
}
