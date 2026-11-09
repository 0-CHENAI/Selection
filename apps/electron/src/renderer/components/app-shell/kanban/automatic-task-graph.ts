import type { TaskNodeRunStateDto, TaskResultsDto, TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import type { TaskRunInspection } from '@craft-agent/shared/tasks'

/** Read the exact run revision; never substitute the current authored task.yaml. */
export async function readAutomaticTaskGraph(
  inspect: (workspaceId: string, slug: string, runId: string) => Promise<TaskRunInspection>,
  workspaceId: string,
  run: TaskRunSnapshotDto,
) {
  const inspection = await inspect(workspaceId, run.slug, run.runId)
  if (!inspection.readOnly || !inspection.spec || inspection.snapshot.runId !== run.runId
    || inspection.snapshot.slug !== run.slug || (inspection.snapshot.revision ?? 0) !== (run.revision ?? 0)
    || (inspection.snapshot.orchestratorSessionId && inspection.snapshot.orchestratorSessionId !== run.orchestratorSessionId)) {
    throw new Error('The exact task run revision is unavailable.')
  }
  return inspection.spec
}

export function automaticTaskGraphKey(workspaceId: string | undefined, run: TaskRunSnapshotDto | null) {
  return JSON.stringify([workspaceId, run?.slug, run?.runId, run?.orchestratorSessionId, run?.revision ?? 0])
}

/** Keep outputs tied to the selected run and execution, including retries and reused nodes. */
export function currentTaskNodeResults(results: TaskResultsDto, run: TaskRunSnapshotDto, instances: TaskNodeRunStateDto[]) {
  if (results.runId !== run.runId || results.slug !== run.slug || (results.revision ?? 0) !== (run.revision ?? 0)
    || (results.orchestratorSessionId && results.orchestratorSessionId !== run.orchestratorSessionId)) return []
  return results.nodes.filter(result => instances.some(instance => {
    if (instance.id !== result.id || (result.attempt ?? 1) !== instance.attempt) return false
    if (instance.sessionId && result.sessionId && instance.sessionId !== result.sessionId) return false
    const attemptRevision = instance.attempts?.find(attempt => attempt.attempt === instance.attempt)?.revision
    return attemptRevision === undefined || result.revision === attemptRevision
  }))
}
