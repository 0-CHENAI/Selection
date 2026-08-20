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
  acceptanceCriteria?: string
  nodes: Array<{
    id: string
    title: string
    state: string
    sessionId?: string
    output?: string
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

  const byId = new Map<string, { id: string; state: string; sessionId?: string }>()
  const ensure = (id: string) => {
    let e = byId.get(id)
    if (!e) {
      e = { id, state: 'pending' }
      byId.set(id, e)
    }
    return e
  }
  const verdicts: NonNullable<LoadedTaskResults['verdicts']> = []
  let runStatus: string | undefined
  for (const entry of log) {
    if (entry.kind === 'node-scheduled' || entry.kind === 'node-spawned') {
      const e = ensure(entry.nodeId)
      if (entry.kind === 'node-spawned') e.sessionId = entry.sessionId
    } else if (entry.kind === 'node-finished') {
      const e = ensure(entry.nodeId)
      e.state = entry.state
      if (entry.sessionId) e.sessionId = entry.sessionId
    } else if (entry.kind === 'verdict') {
      verdicts.push({
        result: entry.result,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nodes?.length ? { nodes: entry.nodes } : {}),
      })
    } else if (entry.kind === 'run-completed') {
      runStatus = 'completed'
    } else if (entry.kind === 'run-failed') {
      runStatus = 'failed'
    } else if (entry.kind === 'run-stopped') {
      runStatus = 'stopped'
    } else if (entry.kind === 'run-verifying') {
      runStatus = 'verifying'
    }
  }

  const nodes = [...byId.values()].map((e) => {
    const out = readNodeOutput(root, slug, chosen, e.id)
    return {
      id: e.id,
      title: titleById.get(e.id) ?? e.id,
      state: e.state,
      ...(e.sessionId ? { sessionId: e.sessionId } : {}),
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
    ...(snapshot?.acceptance_criteria ? { acceptanceCriteria: snapshot.acceptance_criteria } : {}),
    nodes,
  }
}
