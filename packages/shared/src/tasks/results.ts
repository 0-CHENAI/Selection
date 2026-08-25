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
  readRunSpecSnapshot,
} from './storage.ts'

export interface LoadedTaskResults {
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
    failureReason?: string
  }>
}

export function loadTaskResults(root: string, slug: string, runId?: string): LoadedTaskResults {
  const runIds = listRunIds(root, slug)
  const chosen = runId ?? runIds.at(-1) ?? null
  if (!chosen) return { slug, runId: null, runIds, nodes: [] }

  const log = readRunLog(root, slug, chosen)
  const snapshot = readRunSpecSnapshot(root, slug, chosen)
  const titleById = new Map<string, string>()
  if (snapshot) for (const n of snapshot.nodes) titleById.set(n.id, nodeTitle(n))

  const byId = new Map<string, { id: string; state: string; sessionId?: string; attempt: number; failureReason?: string }>()
  const ensure = (id: string) => {
    let e = byId.get(id)
    if (!e) {
      e = { id, state: 'pending', attempt: 0 }
      byId.set(id, e)
    }
    return e
  }
  const verdicts: NonNullable<LoadedTaskResults['verdicts']> = []
  let tokensUsed: number | undefined
  for (const entry of log) {
    if (entry.kind === 'node-scheduled') {
      ensure(entry.nodeId).attempt += 1
    } else if (entry.kind === 'node-spawned') {
      ensure(entry.nodeId).sessionId = entry.sessionId
    } else if (entry.kind === 'node-finished') {
      const e = ensure(entry.nodeId)
      e.state = entry.state
      if (entry.sessionId) e.sessionId = entry.sessionId
      if (entry.reason && (entry.state === 'failed' || entry.state === 'invalid' || entry.state === 'interrupted')) {
        e.failureReason = entry.reason
      }
    } else if (entry.kind === 'verdict') {
      verdicts.push({
        result: entry.result,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nodes?.length ? { nodes: entry.nodes } : {}),
      })
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
      ...(e.sessionId ? { sessionId: e.sessionId } : {}),
      ...(e.failureReason ? { failureReason: e.failureReason } : {}),
      ...(out?.text ? { output: out.text } : {}),
    }
  })

  const repairUsed = verdicts.filter((v) => v.result === 'fail').length
  const repairMax = Math.min(snapshot?.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP)

  return {
    slug,
    runId: chosen,
    runIds,
    verdict: verdicts.at(-1),
    verdicts,
    repair: { used: repairUsed, max: repairMax },
    ...(runStatus ? { runStatus } : {}),
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
    ...(snapshot?.acceptance_criteria ? { acceptanceCriteria: snapshot.acceptance_criteria } : {}),
    nodes,
  }
}
