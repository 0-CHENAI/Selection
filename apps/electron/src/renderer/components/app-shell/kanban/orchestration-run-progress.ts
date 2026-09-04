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
}

export function isActiveTaskRunStatus(status?: string | null): boolean {
  return !!status && !TERMINAL_TASK_RUN_STATUSES.has(status)
}

export function shouldShowOrchestrationRunProgress(input: {
  isTaskOrchestrator: boolean
  orchestrationStatus?: string | null
  runStatus?: string | null
}): boolean {
  if (!input.isTaskOrchestrator) return false
  if (input.orchestrationStatus === 'running') return true
  return isActiveTaskRunStatus(input.runStatus)
}

function relatedRunNodes(nodes: TaskNodeRunStateDto[], nodeId: string): TaskNodeRunStateDto[] {
  return nodes.filter((node) => node.id === nodeId || node.definitionId === nodeId || node.id.startsWith(`${nodeId}#`))
}

export function sessionIdForProgressRow(nodes: TaskNodeRunStateDto[], nodeId: string): string | undefined {
  const related = relatedRunNodes(nodes, nodeId)
  return related.find((node) => node.sessionId && (node.state === 'running' || node.state === 'retry-wait'))?.sessionId
    ?? related.find((node) => node.sessionId)?.sessionId
}

export function buildOrchestrationProgressRows(
  specNodes: SpecProgressNode[] | undefined,
  liveRun: TaskRunSnapshotDto | null | undefined,
): OrchestrationProgressRow[] {
  if (specNodes && specNodes.length > 0) {
    return specNodes.map((node) => ({
      id: node.id,
      title: node.title?.trim() || node.id,
      state: overlayState(node.id, liveRun) ?? 'pending',
      sessionId: liveRun ? sessionIdForProgressRow(liveRun.nodes, node.id) : undefined,
    }))
  }
  if (!liveRun?.nodes.length) return []
  return liveRun.nodes.map((node) => ({
    id: node.id,
    title: node.id,
    state: node.state,
    sessionId: node.sessionId,
  }))
}

export function countFinishedProgressRows(rows: OrchestrationProgressRow[]): number {
  return rows.filter((row) => row.state === 'done' || row.state === 'skipped').length
}
