/**
 * Storage-backed read of a Conductor run's outcome.
 * Shared by tasks:get_results RPC and the get_task_results session tool.
 */
import {
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS_CAP,
  nodeTitle,
} from './schema.ts'
import {
  deriveRunStatusFromLog,
  listRunIds,
  readNodeOutput,
  readRunLog,
  committedRunLog,
  readRunState,
} from './storage.ts'
import { loadResearchResults } from './research-storage.ts'
import { readSpecRevision } from './revisions.ts'

export interface LoadedTaskResults {
  research?: import('./research.ts').ResearchSummary
  artifactAvailability?: { nodeIds: string[]; reason: string }
  workers?: import('./planner').TaskWorkerRecord[]
  resumedFrom?: string
  supersededBy?: string
  taskId?: string
  orchestratorSessionId?: string
  slug: string
  runId: string | null
  runIds: string[]
  verdict?: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }
  verdicts?: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }[]
  repair?: { used: number; max: number }
  runStatus?: string
  tokensUsed?: number
  acceptanceCriteria?: string
  nodes: Array<{
    id: string
    title: string
    state: string
    sessionId?: string
    output?: string
    attempt?: number
    revision?: number
    failureReason?: string
    outputs?: Record<string, unknown>
    artifacts?: unknown[]
  }>
  revision?: number
}

export function loadTaskResults(root: string, slug: string, runId?: string): LoadedTaskResults {
  const runIds = listRunIds(root, slug)
  const chosen = runId ?? runIds.at(-1) ?? null
  if (!chosen) return { slug, runId: null, runIds, nodes: [] }

  const log = committedRunLog(readRunLog(root, slug, chosen), readRunState(root, slug, chosen))
  // A revision file can precede its commit event during a crash. Use the same
  // durable revision as TaskRunner recovery, never the newest file on disk.
  const revision = readRunState(root, slug, chosen)?.revision
    ?? log.reduce((latest, entry) => Math.max(latest, entry.revision ?? 0), 0)
  const snapshot = readSpecRevision(root, slug, chosen, revision)
  const started = log.find(entry => entry.kind === 'run-started')
  const titleById = new Map<string, string>()
  if (snapshot) for (const n of snapshot.nodes) titleById.set(n.id, nodeTitle(n))

  const byId = new Map<string, { id: string; state: string; sessionId?: string; attempt: number; revision?: number; failureReason?: string }>()
  const ensure = (id: string) => {
    let e = byId.get(id)
    if (!e) {
      e = { id, state: 'pending', attempt: 0 }
      byId.set(id, e)
    }
    return e
  }
  const verdicts: NonNullable<LoadedTaskResults['verdicts']> = []
  let currentVerdict: LoadedTaskResults['verdict']
  let tokensUsed: number | undefined
  for (const entry of log) {
    if (entry.kind === 'node-scheduled') {
      const node = ensure(entry.nodeId)
      node.attempt += 1
      node.revision = entry.revision ?? 0
    } else if (entry.kind === 'node-spawned') {
      const node = ensure(entry.nodeId)
      node.sessionId = entry.sessionId
      node.revision ??= entry.revision ?? 0
    } else if (entry.kind === 'artifact-results-invalidated') {
      for (const nodeId of entry.nodeIds) {
        const node = ensure(nodeId)
        node.state = 'invalid'
        node.failureReason = entry.reason
      }
      currentVerdict = undefined
    } else if (entry.kind === 'node-finished') {
      const e = ensure(entry.nodeId)
      e.state = entry.state
      if (entry.sessionId) e.sessionId = entry.sessionId
      if (entry.state === 'done') delete e.failureReason
      if (entry.reason && (entry.state === 'failed' || entry.state === 'invalid' || entry.state === 'interrupted')) {
        e.failureReason = entry.reason
      }
    } else if (entry.kind === 'verdict') {
      verdicts.push({
        result: entry.result,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nodes?.length ? { nodes: entry.nodes } : {}),
      })
      currentVerdict = verdicts.at(-1)
    } else if ('tokensUsed' in entry && typeof entry.tokensUsed === 'number') {
      tokensUsed = entry.tokensUsed
    }
  }
  const runStatus = log.length > 0 ? deriveRunStatusFromLog(log) : undefined

  const nodes = [...byId.values()].map((e) => {
    const out = readNodeOutput(root, slug, chosen, e.id)
    return {
      id: e.id,
      title: titleById.get(e.id) ?? e.id,
      state: e.state,
      attempt: e.attempt,
      ...(e.revision !== undefined ? { revision: e.revision } : {}),
      ...(e.sessionId ? { sessionId: e.sessionId } : {}),
      ...(e.failureReason ? { failureReason: e.failureReason } : {}),
      ...(out?.text ? { output: out.text } : {}),
      ...(out?.params ? { outputs: out.params } : {}),
      ...(out?.params && Object.values(out.params).some((v) => v && typeof v === 'object' && 'hash' in (v as object))
        ? { artifacts: Object.values(out.params).filter((v) => v && typeof v === 'object' && 'hash' in (v as object)) }
        : {}),
    }
  })

  const repairUsed = verdicts.filter((v) => v.result === 'fail').length
  const repairMax = Math.min(snapshot?.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP)
  const superseded = log.findLast(event => event.kind === 'run-superseded')
  // The new run's start is the canonical lineage receipt. Reconstruct the old
  // side if publication was interrupted between the two history notifications.
  const successor = superseded?.kind === 'run-superseded' ? superseded.supersededBy : runIds.find(id => id !== chosen
    && readRunLog(root, slug, id).some(event => event.kind === 'run-started' && event.resumedFrom === chosen))

  return {
    ...(started?.kind === 'run-started' ? { taskId: started.taskId, orchestratorSessionId: started.orchestratorSessionId } : {}),
    slug,
    resumedFrom: started?.kind === 'run-started' ? started.resumedFrom : undefined,
    supersededBy: successor,
    ...(snapshot?.research ? { research: loadResearchResults(root, slug, chosen) } : {}),
    artifactAvailability: (() => {
      const event = log.findLast(entry => entry.kind === 'artifact-availability');
      return event?.kind === 'artifact-availability' && event.nodeIds.length ? { nodeIds: event.nodeIds, reason: event.reason } : undefined;
    })(),
    runId: chosen,
    runIds,
    verdict: currentVerdict,
    verdicts,
    repair: { used: repairUsed, max: repairMax },
    ...(runStatus ? { runStatus } : {}),
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
    ...(snapshot?.acceptance_criteria ? { acceptanceCriteria: snapshot.acceptance_criteria } : {}),
    nodes,
    workers: [...new Map(log.filter(event => event.kind === 'task-worker').map(event => [event.worker.workerId, event.worker])).values()],
    revision: snapshot ? revision : undefined,
  }
}
