/** Default chip width so parallel sub-agent rows line up. */
export const TASK_CHIP_WIDTH_CLASS = 'w-[220px]'

export function shortenTaskId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

function looksLikePrompt(text: string): boolean {
  if (text.includes('\n')) return true
  return /^(please\b|use\b|using\b|请使用|请用)/i.test(text)
}

/**
 * Chip main text is a short title (spawn name / session name), never the prompt.
 * Unnamed tasks fall back to a shortened id.
 */
export function resolveBackgroundTaskChipLabel(input: {
  taskId: string
  intent?: string
  sessionName?: string
}): string {
  const name = input.sessionName?.trim()
  if (name && name !== input.taskId && !looksLikePrompt(name)) return name
  const intent = input.intent?.trim()
  if (intent && intent !== input.taskId && !looksLikePrompt(intent)) return intent
  return shortenTaskId(input.taskId)
}

/** Running/stale agent chips preview in an overlay instead of navigating away. */
export function shouldPreviewBackgroundTask(task?: {
  type?: string
  status?: string
}): boolean {
  return task?.type === 'agent' && (task.status === 'running' || task.status === 'stale')
}
