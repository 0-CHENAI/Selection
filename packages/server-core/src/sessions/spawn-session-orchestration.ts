import type { SpawnSessionResultStatus } from '@craft-agent/shared/agent'

export type SpawnCompletionReason = 'complete' | 'interrupted' | 'error' | 'timeout'

export interface SpawnCompletionEvent {
  sessionId: string
  reason: SpawnCompletionReason
  finalText?: string
}

export function mapCompletionReasonToSpawnStatus(
  reason: SpawnCompletionReason,
): Exclude<SpawnSessionResultStatus, 'started' | 'timeout'> {
  if (reason === 'complete') return 'completed'
  if (reason === 'interrupted') return 'interrupted'
  return 'failed'
}

export function mapCompletionReasonToTaskStatus(
  reason: SpawnCompletionReason,
): 'completed' | 'failed' | 'stopped' {
  if (reason === 'complete') return 'completed'
  if (reason === 'interrupted') return 'stopped'
  return 'failed'
}

export function shouldOrphanBackgroundTask(
  info: { status: string; source?: string },
  keepAlive: boolean,
): boolean {
  if (info.status !== 'running') return false
  if (info.source === 'spawn_session') return false
  return !keepAlive
}

export function shouldWakeOnTaskCompleted(opts: {
  isProcessing: boolean
  wasAlreadyTerminal: boolean
  keepAlive: boolean
  source?: string
}): boolean {
  if (opts.isProcessing || opts.wasAlreadyTerminal) return false
  return opts.keepAlive || opts.source === 'spawn_session'
}

/** spawn_session completions that land mid-turn must wake the parent after it goes idle. */
export function shouldDeferSpawnWake(opts: {
  isProcessing: boolean
  wasAlreadyTerminal: boolean
  source?: string
}): boolean {
  return Boolean(opts.isProcessing && !opts.wasAlreadyTerminal && opts.source === 'spawn_session')
}

/** Running first-class spawn children. Parent stop does not cancel them. */
export function countRunningSpawnChildren(input: {
  registry: Iterable<{ taskId: string; status: string; source?: string }>
  parentId?: string
  sessions?: Iterable<{
    id: string
    isProcessing: boolean
    parentSessionId?: string
    taskNodeId?: string
  }>
}): number {
  const ids = new Set<string>()
  const live = new Map<string, {
    isProcessing: boolean
    parentSessionId?: string
    taskNodeId?: string
  }>()
  if (input.sessions) {
    for (const session of input.sessions) live.set(session.id, session)
  }

  for (const task of input.registry) {
    if (task.source !== 'spawn_session' || task.status !== 'running') continue
    const child = live.get(task.taskId)
    if (child && !child.isProcessing) continue
    ids.add(task.taskId)
  }

  if (input.parentId) {
    for (const [id, session] of live) {
      if (
        session.parentSessionId === input.parentId
        && session.isProcessing
        && !session.taskNodeId
      ) {
        ids.add(id)
      }
    }
  }

  return ids.size
}

export function buildBackgroundTaskNudge(opts: {
  status: string
  taskId: string
  intent?: string
  summary?: string
  outputFile?: string
}): string {
  const label = opts.intent ? `"${opts.intent}"` : `session ${opts.taskId}`
  if (opts.status === 'completed') {
    return [
      `[background-task-completed] The background session you launched (${label}) has finished.`,
      `Session ID: ${opts.taskId}`,
      opts.summary ? `Summary:\n${opts.summary}` : '',
      opts.outputFile ? `Full output is also saved at: ${opts.outputFile}` : '',
      `Use get_session_info with that sessionId (or open it in the session list) and present the findings to the user now. Do NOT spawn another background session.`,
    ].filter(Boolean).join('\n')
  }
  return [
    `[background-task-${opts.status}] The background session you launched (${label}) ended with status "${opts.status}".`,
    `Session ID: ${opts.taskId}`,
    opts.summary ? `Summary:\n${opts.summary}` : '',
    opts.outputFile ? `Any partial output is at: ${opts.outputFile}.` : '',
    `Briefly let the user know it did not complete successfully. Do NOT spawn another background session.`,
  ].filter(Boolean).join('\n')
}

export type SpawnWaitOutcome = {
  status: Exclude<SpawnSessionResultStatus, 'started'>
  finalText?: string
}

export async function waitForChildSessionCompletion(opts: {
  childSessionId: string
  timeoutMs: number
  isParentInterrupted: () => boolean
  subscribe: (listener: (evt: SpawnCompletionEvent) => void) => () => void
  onAttach?: (settle: (result: SpawnWaitOutcome) => void) => void
}): Promise<SpawnWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let unsub = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      unsub()
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
    }
    const finish = (result: SpawnWaitOutcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    opts.onAttach?.(finish)

    unsub = opts.subscribe((evt) => {
      if (evt.sessionId !== opts.childSessionId) return
      finish({
        status: mapCompletionReasonToSpawnStatus(evt.reason),
        finalText: evt.finalText,
      })
    })

    timer = setTimeout(() => {
      finish({ status: 'timeout' })
    }, opts.timeoutMs)

    poll = setInterval(() => {
      if (opts.isParentInterrupted()) {
        finish({ status: 'interrupted' })
      }
    }, 200)
  })
}
