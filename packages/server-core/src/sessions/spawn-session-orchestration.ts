import type {
  SpawnSessionQualification,
  SpawnSessionResultStatus,
} from '@craft-agent/shared/agent'

export const MAX_SWARM_CHILDREN_PER_PARENT = 3
export const MAX_SWARM_DEPTH = 2
export const MAX_SWARM_LIVE_NODES = 12

export function resolveInheritedSwarmEnabled(input: {
  requested?: boolean
  parent?: boolean
  branchSource?: boolean
}): boolean {
  return input.requested ?? input.parent ?? input.branchSource ?? false
}

export interface SpawnQualificationAssessment {
  eligible: boolean
  reasons: string[]
}

/**
 * Fail-closed qualification gate for autonomous spawning.
 *
 * The model must provide the planning evidence; this helper deliberately does
 * not infer eligibility from prompt keywords. Unique track names keep the
 * contract auditable and every track must name its tool/evidence requirements.
 */
export function assessSpawnQualification(
  qualification: SpawnSessionQualification | undefined,
): SpawnQualificationAssessment {
  const reasons: string[] = []
  if (!qualification) {
    return { eligible: false, reasons: ['missing qualification contract'] }
  }

  if (!Array.isArray(qualification.tracks) || qualification.tracks.length < 2) {
    reasons.push('at least two independent tracks are required')
  }

  const names = new Set<string>()
  for (const [index, track] of (qualification.tracks ?? []).entries()) {
    const prefix = `track ${index + 1}`
    const name = track.name?.trim()
    if (!name) reasons.push(`${prefix} is missing a name`)
    if (name && names.has(name)) reasons.push(`${prefix} duplicates another track name`)
    if (name) names.add(name)
    if (!track.input?.trim()) reasons.push(`${prefix} is missing input`)
    if (!track.expectedOutput?.trim()) reasons.push(`${prefix} is missing expected output`)
    if (!track.evidence?.trim()) reasons.push(`${prefix} is missing evidence contract`)
    if (!Array.isArray(track.toolKinds) || !track.toolKinds.some(kind => kind.trim().length > 0)) {
      reasons.push(`${prefix} must require at least one tool kind`)
    }
  }

  if (!qualification.parallelBenefit?.trim()) {
    reasons.push('parallel benefit is missing')
  }
  if (!qualification.finalAggregation?.trim()) {
    reasons.push('final aggregation or verification contract is missing')
  }

  return { eligible: reasons.length === 0, reasons }
}

export interface SwarmSessionSnapshot {
  id: string
  parentSessionId?: string
  taskNodeId?: string
  isProcessing: boolean
  orchestrationId?: string
  orchestrationDepth?: number
  orchestrationLifecycle?: 'managed' | 'detached'
  orchestrationStatus?: 'running' | 'completed' | 'need-to-check' | 'stopped'
}

export function isLiveSwarmSession(session: SwarmSessionSnapshot): boolean {
  return session.orchestrationStatus === 'running' || session.isProcessing
}

export function countLiveSwarmChildren(
  sessions: Iterable<SwarmSessionSnapshot>,
  parentSessionId: string,
): number {
  let count = 0
  for (const session of sessions) {
    if (
      session.parentSessionId === parentSessionId
      && !session.taskNodeId
      && isLiveSwarmSession(session)
    ) count++
  }
  return count
}

export function countLiveSwarmNodes(
  sessions: Iterable<SwarmSessionSnapshot>,
  orchestrationId: string,
): number {
  let count = 0
  for (const session of sessions) {
    if (session.orchestrationId === orchestrationId && isLiveSwarmSession(session)) count++
  }
  return count
}

export interface SwarmLimitAssessment {
  allowed: boolean
  error?: string
}

export function assessSwarmSpawnLimits(input: {
  sessions: Iterable<SwarmSessionSnapshot>
  parentSessionId: string
  parentDepth: number
  orchestrationId: string
  pendingChildren?: number
  pendingNodes?: number
}): SwarmLimitAssessment {
  const targetDepth = input.parentDepth + 1
  if (targetDepth > MAX_SWARM_DEPTH) {
    return {
      allowed: false,
      error: `Swarm depth limit exceeded: requested ${targetDepth}, maximum ${MAX_SWARM_DEPTH}`,
    }
  }

  const snapshots = Array.from(input.sessions)
  const direct = countLiveSwarmChildren(snapshots, input.parentSessionId) + (input.pendingChildren ?? 0)
  if (direct >= MAX_SWARM_CHILDREN_PER_PARENT) {
    return {
      allowed: false,
      error: `Swarm child concurrency limit exceeded: maximum ${MAX_SWARM_CHILDREN_PER_PARENT} per parent`,
    }
  }

  const total = countLiveSwarmNodes(snapshots, input.orchestrationId) + (input.pendingNodes ?? 0)
  if (total >= MAX_SWARM_LIVE_NODES) {
    return {
      allowed: false,
      error: `Swarm live-node limit exceeded: maximum ${MAX_SWARM_LIVE_NODES}`,
    }
  }

  return { allowed: true }
}

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

export function recoverPersistedSwarmStatus(status: string | undefined): {
  status: 'need-to-check'
  blocker: string
} | undefined {
  if (status !== 'running') return undefined
  return {
    status: 'need-to-check',
    blocker: 'Swarm execution was interrupted by an application restart; review the run before continuing.',
  }
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

export function buildManagedSwarmNudge(opts: {
  orchestrationId: string
  children: Array<{
    sessionId: string
    name?: string
    status: string
    summary?: string
    blocker?: string
  }>
}): string {
  const lines = opts.children.map(child => {
    const label = child.name ? `${child.name}; Session ID: ${child.sessionId}` : `Session ID: ${child.sessionId}`
    const detail = child.summary || child.blocker
    return `- ${label}: ${child.status}${detail ? ` — ${detail}` : ''}`
  })
  return [
    '[managed-swarm-settled] All managed workers for this Swarm have reached terminal states.',
    `Orchestration ID: ${opts.orchestrationId}`,
    ...lines,
    'Review every worker result, apply the declared aggregation/verification contract, and present exactly one final answer to the user. Do NOT spawn replacement workers unless a structured repair decision requires it.',
  ].join('\n')
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
  /** Coordinators may emit an ordinary turn completion while descendants still run. */
  acceptCompletion?: (evt: SpawnCompletionEvent) => boolean
  /** Lets descendant-driven subtree failure settle a wait without another coordinator turn. */
  getTerminalOutcome?: () => SpawnWaitOutcome | undefined
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
      if (opts.acceptCompletion && !opts.acceptCompletion(evt)) return
      finish({
        status: mapCompletionReasonToSpawnStatus(evt.reason),
        finalText: evt.finalText,
      })
    })

    timer = setTimeout(() => {
      finish({ status: 'timeout' })
    }, opts.timeoutMs)

    poll = setInterval(() => {
      const terminal = opts.getTerminalOutcome?.()
      if (terminal) {
        finish(terminal)
        return
      }
      if (opts.isParentInterrupted()) {
        finish({ status: 'interrupted' })
      }
    }, 200)
  })
}
