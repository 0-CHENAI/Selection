import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import type { ActivityItem, Turn } from '@craft-agent/ui'
import { taskAssignmentSummary } from '@craft-agent/ui/chat/task-message-presentation'
import { overlayState } from './conductor-graph'
import { resolveNodeStatePill } from './node-state-pill'
import { runStatusLabelKey } from './task-labels'

const TERMINAL_TASK_RUN_STATUSES = new Set(['completed', 'failed', 'stopped'])

export interface SpecProgressNode {
  id: string
  title?: string
}

export interface OrchestrationProgressRow {
  id: string
  title: string
  description?: string
  state: string
  sessionId?: string
  startedAt?: number
  attempt?: number
  attempts?: TaskNodeRunStateDto["attempts"]
  children?: OrchestrationProgressRow[]
}

export function isActiveTaskRunStatus(status?: string | null): boolean {
  return !!status && !TERMINAL_TASK_RUN_STATUSES.has(status)
}

export function isTaskRunOwnedBySession(
  run: Pick<TaskRunSnapshotDto, 'orchestratorSessionId'>,
  sessionId?: string | null,
): boolean {
  if (!sessionId || !run.orchestratorSessionId) return true
  return run.orchestratorSessionId === sessionId
}

export function isTaskRunEventForProgress(
  workspaceId: string,
  taskSlug: string,
  sessionId: string | undefined,
  eventWorkspaceId: string,
  snapshot: Pick<TaskRunSnapshotDto, 'slug' | 'orchestratorSessionId'>,
): boolean {
  if (eventWorkspaceId && eventWorkspaceId !== workspaceId) return false
  if (snapshot.slug !== taskSlug) return false
  return isTaskRunOwnedBySession(snapshot, sessionId)
}

export function pickStoppableTaskRun(
  run: TaskRunSnapshotDto | null | undefined,
  sessionId: string,
): TaskRunSnapshotDto | null {
  if (!run || !isActiveTaskRunStatus(run.status)) return null
  if (!isTaskRunOwnedBySession(run, sessionId)) return null
  return run
}

export function canPreviewOrchestrationChild(
  parentSessionId: string,
  childMeta: { parentSessionId?: string } | undefined,
): boolean {
  if (!childMeta?.parentSessionId) return true
  return childMeta.parentSessionId === parentSessionId
}

function relatedRunNodes(nodes: TaskNodeRunStateDto[], nodeId: string): TaskNodeRunStateDto[] {
  return nodes.filter((node) => node.id === nodeId || node.definitionId === nodeId || node.id.startsWith(`${nodeId}#`))
}

export function sessionIdForProgressRow(nodes: TaskNodeRunStateDto[], nodeId: string): string | undefined {
  return nodes.find(node => node.id === nodeId)?.sessionId
}

/** A historical worker keeps its own attempt state, not the latest retry's. */
export function nodeStateForSession(runs: TaskRunSnapshotDto[], sessionId: string | null): string | undefined {
  if (!sessionId) return undefined
  for (let index = runs.length - 1; index >= 0; index--) {
    // An actor can reuse one worker session for successive tasks.
    for (const node of runs[index]!.nodes.toSorted((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
      if (node.sessionId === sessionId) return node.state
      const attempt = node.attempts?.find(item => item.sessionId === sessionId)
      if (attempt) return attempt.state
    }
  }
  return undefined
}

export function buildOrchestrationProgressRows(
  specNodes: SpecProgressNode[] | undefined,
  liveRun: TaskRunSnapshotDto | null | undefined,
): OrchestrationProgressRow[] {
  const nodes = liveRun?.nodes ?? []
  const toRow = (node: TaskNodeRunStateDto, title: string): OrchestrationProgressRow => {
    const description = taskAssignmentSummary({ kind: 'assignment', instruction: node.instruction })
    const readableTitle = title === node.id && description ? description
      : taskAssignmentSummary({ kind: 'assignment', instruction: title }) || description || title
    return {
      id: node.id, title: readableTitle, state: node.state, sessionId: node.sessionId, description,
      ...(Number.isFinite(node.startedAt) ? { startedAt: node.startedAt } : {}),
      ...(node.attempt > 1 ? { attempt: node.attempt } : {}),
      ...(node.attempts?.length ? { attempts: node.attempts } : {}),
    }
  }
  // Run titles/definitions come from its frozen spec, not today's edited task.
  const definitions = liveRun?.nodes.length
    ? nodes.filter(node => !node.definitionId || node.definitionId === node.id).filter(node => !node.id.includes('#'))
        .map(node => ({ id: node.id, title: node.title ?? specNodes?.find(spec => spec.id === node.id)?.title }))
    : specNodes ?? []
  const seen = new Set<string>()
  const rows = definitions.map(node => {
    seen.add(node.id)
    const current = nodes.find(item => item.id === node.id)
    const children = relatedRunNodes(nodes, node.id).filter(item => item.id !== node.id)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map(item => { seen.add(item.id); return toRow(item, item.id) })
    const row = current ? toRow(current, node.title?.trim() || node.id)
      : { id: node.id, title: node.title?.trim() || node.id, state: overlayState(node.id, liveRun) ?? 'pending', sessionId: undefined }
    return children.length ? { ...row, sessionId: undefined, children } : row
  })
  // Keep orphaned/dynamic nodes visible even if a later graph revision removed them.
  for (const node of nodes) if (!seen.has(node.id)) rows.push(toRow(node, node.title ?? node.id))
  return rows
}

export function countFinishedProgressRows(rows: OrchestrationProgressRow[]): number {
  return rows.filter((row) => row.state === 'done' || row.state === 'skipped').length
}

/** Put child states at their first dispatch time in the matching work chain. */
export function withOrchestrationProgress(
  turns: Turn[], run: TaskRunSnapshotDto,
  t: (key: string, options?: { count: number }) => string,
): Turn[] {
  const index = turns.findLastIndex(turn => turn.type === 'assistant' && turn.taskRunId === run.runId)
  const latest = turns[index]
  if (latest?.type !== 'assistant') return turns
  const rows = buildOrchestrationProgressRows(undefined, run)
  const summary = `${t('session.executionChildren', { count: rows.length })} · ${countFinishedProgressRows(rows)}/${rows.length} · ${t(runStatusLabelKey(run.status) ?? 'tasks.starting')}`
  // Undispatched/legacy nodes follow known work without inventing execution times.
  const fallbackTimestamp = run.nodes.reduce((time, node) => Number.isFinite(node.startedAt) ? Math.max(time, node.startedAt!) : time,
    latest.activities.reduce((time, activity) => Math.max(time, activity.timestamp), latest.timestamp))
  const statusRows = (nodes: OrchestrationProgressRow[]): ActivityItem[] => nodes.flatMap(row => [{
    id: `task-node:${run.runId}:${row.id}`, type: 'status' as const,
    statusType: 'task_node',
    taskNode: { title: row.title, description: row.description, sessionId: row.sessionId,
      stateLabel: t(resolveNodeStatePill(row.state).labelKey ?? 'tasks.nodeStateInterrupted'),
    },
    status: ['done', 'skipped'].includes(row.state) ? 'completed' as const
      : ['failed', 'invalid'].includes(row.state) ? 'error' as const
      : ['running', 'verifying'].includes(row.state) ? 'running' as const : 'pending' as const,
    content: `${row.title} · ${t(resolveNodeStatePill(row.state).labelKey ?? 'tasks.nodeStateInterrupted')}`,
    timestamp: row.startedAt ?? fallbackTimestamp,
  }, ...statusRows(row.children ?? [])])
  const activities = [...latest.activities, ...statusRows(rows), {
    id: `task-progress:${run.runId}`, type: 'status' as const,
    statusType: 'task_progress',
    status: ['running', 'waiting-coordinator', 'verifying', 'repairing'].includes(run.status) ? 'running' as const
      : run.status === 'failed' ? 'error' as const : run.status === 'completed' ? 'completed' as const : 'pending' as const,
    content: summary, timestamp: fallbackTimestamp,
  }]
  return turns.map((turn, turnIndex) => turnIndex === index ? { ...latest, activities, intent: summary } : turn)
}
