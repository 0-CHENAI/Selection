import type { TaskNodeRunStateDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { overlayState } from './conductor-graph'

const TERMINAL_TASK_RUN_STATUSES = new Set(['completed', 'failed', 'stopped'])

export interface SpecProgressNode {
  id: string
  title?: string
}

export interface OrchestrationProgressRow {
  id: string
  title: string
  state: string
  sessionId?: string
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

export function shouldShowOrchestrationRunProgress(input: {
  isTaskOrchestrator: boolean
  orchestrationStatus?: string | null
  runStatus?: string | null
}): boolean {
  if (!input.isTaskOrchestrator) return false
  if (input.orchestrationStatus === 'running') return true
  return !!input.runStatus
}

function relatedRunNodes(nodes: TaskNodeRunStateDto[], nodeId: string): TaskNodeRunStateDto[] {
  return nodes.filter((node) => node.id === nodeId || node.definitionId === nodeId || node.id.startsWith(`${nodeId}#`))
}

export function sessionIdForProgressRow(nodes: TaskNodeRunStateDto[], nodeId: string): string | undefined {
  return nodes.find(node => node.id === nodeId)?.sessionId
}

export function buildOrchestrationProgressRows(
  specNodes: SpecProgressNode[] | undefined,
  liveRun: TaskRunSnapshotDto | null | undefined,
): OrchestrationProgressRow[] {
  const nodes = liveRun?.nodes ?? []
  const toRow = (node: TaskNodeRunStateDto, title: string): OrchestrationProgressRow => ({
    id: node.id, title, state: node.state, sessionId: node.sessionId,
    ...(node.attempt > 1 ? { attempt: node.attempt } : {}),
    ...(node.attempts?.length ? { attempts: node.attempts } : {}),
  })
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
