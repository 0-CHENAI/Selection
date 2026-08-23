import { atom } from 'jotai'

export type CreationKind = 'source' | 'skill' | 'automation'
export type CreationJobStatus = 'running' | 'waiting-input' | 'completed' | 'failed' | 'cancelled'
export type CreationJobPhase =
  | 'preparing'
  | 'running'
  | 'validating'
  | 'waiting-input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface CreationJobResult {
  id: string
}

export interface CreationJob {
  id: string
  workspaceId: string
  contextKey: string
  kind: CreationKind
  sessionId?: string
  status: CreationJobStatus
  phase: CreationJobPhase
  /** Monotonic turn number used to reject stale validation/cancel results. */
  attempt: number
  baseline: string[]
  /** Last submitted request, retained for naming and failure recovery. */
  request?: string
  /** Output marker present before this attempt; prevents validating stale turns. */
  baselineFinalMessageId?: string
  baselineMessageRole?: CreationJobMessageRole
  observedProcessing?: boolean
  result?: CreationJobResult
  error?: string
  createdAt: number
  updatedAt: number
}

export interface ClaimCreationJobInput {
  workspaceId: string
  contextKey: string
  kind: CreationKind
  baseline: string[]
  request?: string
  baselineFinalMessageId?: string
  baselineMessageRole?: CreationJobMessageRole
  now?: number
  id?: string
}

export type CreationJobMessageRole = 'user' | 'assistant' | 'plan' | 'tool' | 'error'

export type CreationJobAction =
  | { type: 'upsert'; job: CreationJob }
  | { type: 'patch'; id: string; patch: Partial<Omit<CreationJob, 'id' | 'createdAt'>>; now?: number }
  | { type: 'remove'; id: string }

const MAX_TERMINAL_CREATION_JOBS = 50

export function creationJobsReducer(state: CreationJob[], action: CreationJobAction): CreationJob[] {
  switch (action.type) {
    case 'upsert': {
      const withoutExisting = state.filter((job) => job.id !== action.job.id)
      const combined = [action.job, ...withoutExisting]
      const active = combined.filter(isActiveCreationJob)
      const terminal = combined.filter((job) => !isActiveCreationJob(job)).slice(0, MAX_TERMINAL_CREATION_JOBS)
      return [...active, ...terminal]
    }
    case 'patch':
      return state.map((job) => job.id === action.id
        ? { ...job, ...action.patch, updatedAt: action.now ?? Date.now() }
        : job)
    case 'remove':
      return state.filter((job) => job.id !== action.id)
  }
}

export function isActiveCreationJob(job: CreationJob): boolean {
  return job.status === 'running' || job.status === 'waiting-input'
}

export type CreationSessionResolution =
  | { type: 'create' }
  | { type: 'wait' }
  | { type: 'reuse'; sessionId: string }

/** Existing sessions accept follow-up answers; only an unresolved creation RPC waits. */
export function resolveCreationSession(job: CreationJob | undefined): CreationSessionResolution {
  if (!job) return { type: 'create' }
  if (job.sessionId) return { type: 'reuse', sessionId: job.sessionId }
  return { type: 'wait' }
}

/** Validation is a one-way transition and never restarts from a terminal or validating phase. */
export function shouldValidateCreationJob(job: CreationJob): boolean {
  return job.status === 'running' && job.phase === 'running' && Boolean(job.sessionId)
}

export function hasNewTerminalCreationOutput(
  job: CreationJob,
  meta: { lastFinalMessageId?: string; lastMessageRole?: CreationJobMessageRole },
): boolean {
  const outputChanged = meta.lastFinalMessageId !== job.baselineFinalMessageId
    || meta.lastMessageRole !== job.baselineMessageRole
  const hasTerminalOutput = Boolean(meta.lastFinalMessageId) || meta.lastMessageRole === 'error'
  return hasTerminalOutput && (Boolean(job.observedProcessing) || outputChanged)
}

export function findActiveCreationJob(
  jobs: CreationJob[],
  workspaceId: string,
  contextKey: string,
  kind?: CreationKind,
): CreationJob | undefined {
  return jobs.find((job) =>
    job.workspaceId === workspaceId
    && job.contextKey === contextKey
    && (!kind || job.kind === kind)
    && isActiveCreationJob(job)
  )
}

export function findLatestCreationJob(
  jobs: CreationJob[],
  workspaceId: string,
  contextKey: string,
): CreationJob | undefined {
  return jobs
    .filter((job) => job.workspaceId === workspaceId && job.contextKey === contextKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function claimCreationJob(
  jobs: CreationJob[],
  input: ClaimCreationJobInput,
): { jobs: CreationJob[]; job: CreationJob; deduped: boolean } {
  // Resource validation is based on a workspace-wide ID diff. Serializing each
  // kind prevents two context variants from claiming one another's new IDs.
  const existing = jobs.find((job) =>
    job.workspaceId === input.workspaceId
    && job.kind === input.kind
    && isActiveCreationJob(job)
  )
  if (existing) return { jobs, job: existing, deduped: true }

  const now = input.now ?? Date.now()
  const job: CreationJob = {
    id: input.id ?? crypto.randomUUID(),
    workspaceId: input.workspaceId,
    contextKey: input.contextKey,
    kind: input.kind,
    status: 'running',
    phase: 'preparing',
    attempt: 1,
    baseline: [...new Set(input.baseline)].sort(),
    request: input.request,
    baselineFinalMessageId: input.baselineFinalMessageId,
    baselineMessageRole: input.baselineMessageRole,
    observedProcessing: false,
    createdAt: now,
    updatedAt: now,
  }
  return { jobs: creationJobsReducer(jobs, { type: 'upsert', job }), job, deduped: false }
}

export type CreationDismissReason = 'close' | 'route-change' | 'explicit-stop'

/** Closing UI only detaches it. Cancellation is reserved for an explicit Stop action. */
export function shouldCancelCreationJob(reason: CreationDismissReason): boolean {
  return reason === 'explicit-stop'
}

export const creationJobsAtom = atom<CreationJob[]>([])

export const claimCreationJobAtom = atom(
  null,
  (get, set, input: ClaimCreationJobInput) => {
    const claimed = claimCreationJob(get(creationJobsAtom), input)
    if (!claimed.deduped) set(creationJobsAtom, claimed.jobs)
    return claimed
  },
)

export const patchCreationJobAtom = atom(
  null,
  (get, set, input: {
    id: string
    patch: Partial<Omit<CreationJob, 'id' | 'createdAt'>>
    now?: number
    expectedAttempt?: number
    expectedStatus?: CreationJobStatus
    expectedPhase?: CreationJobPhase
  }) => {
    const current = get(creationJobsAtom).find((job) => job.id === input.id)
    if (!current) return false
    if (input.expectedAttempt !== undefined && current.attempt !== input.expectedAttempt) return false
    if (input.expectedStatus !== undefined && current.status !== input.expectedStatus) return false
    if (input.expectedPhase !== undefined && current.phase !== input.expectedPhase) return false
    set(creationJobsAtom, creationJobsReducer(get(creationJobsAtom), {
      type: 'patch',
      id: input.id,
      patch: input.patch,
      now: input.now,
    }))
    return true
  },
)

/** Atomically grants one caller the right to send the next waiting-input turn. */
export const beginCreationJobAttemptAtom = atom(
  null,
  (get, set, input: { id: string; request: string; now?: number }) => {
    const current = get(creationJobsAtom).find((job) => job.id === input.id)
    if (!current || current.status !== 'waiting-input' || !current.sessionId) return null
    const next: CreationJob = {
      ...current,
      status: 'running',
      phase: 'running',
      attempt: current.attempt + 1,
      request: input.request,
      error: undefined,
      result: undefined,
      observedProcessing: false,
      updatedAt: input.now ?? Date.now(),
    }
    set(creationJobsAtom, creationJobsReducer(get(creationJobsAtom), { type: 'upsert', job: next }))
    return next
  },
)

/** Atomically retries a terminal attempt in its existing session and baseline. */
export const restartCreationJobAttemptAtom = atom(
  null,
  (get, set, input: { id: string; request: string; now?: number }) => {
    const current = get(creationJobsAtom).find((job) => job.id === input.id)
    if (
      !current
      || !current.sessionId
      || (current.status !== 'failed' && current.status !== 'cancelled')
    ) return null
    const conflictingJob = get(creationJobsAtom).find((candidate) =>
      candidate.id !== current.id
      && candidate.workspaceId === current.workspaceId
      && candidate.kind === current.kind
      && isActiveCreationJob(candidate)
    )
    if (conflictingJob) return null
    const next: CreationJob = {
      ...current,
      status: 'running',
      phase: 'running',
      attempt: current.attempt + 1,
      request: input.request,
      error: undefined,
      result: undefined,
      observedProcessing: false,
      updatedAt: input.now ?? Date.now(),
    }
    set(creationJobsAtom, creationJobsReducer(get(creationJobsAtom), { type: 'upsert', job: next }))
    return next
  },
)

export const removeCreationJobAtom = atom(
  null,
  (get, set, id: string) => {
    const job = get(creationJobsAtom).find((candidate) => candidate.id === id)
    if (!job || isActiveCreationJob(job)) return false
    set(creationJobsAtom, creationJobsReducer(get(creationJobsAtom), { type: 'remove', id }))
    return true
  },
)

// Promise-level dedupe covers multiple mounted EditPopover instances for the same
// context. Atom claiming prevents duplicate jobs; this map prevents those callers
// from racing two hidden-session RPCs before the first session id is attached.
const sessionCreationPromises = new Map<string, Promise<string>>()

export function getOrCreateCreationSession(
  jobId: string,
  factory: () => Promise<string>,
): Promise<string> {
  const existing = sessionCreationPromises.get(jobId)
  if (existing) return existing

  const pending = factory().finally(() => {
    if (sessionCreationPromises.get(jobId) === pending) sessionCreationPromises.delete(jobId)
  })
  sessionCreationPromises.set(jobId, pending)
  return pending
}
