/**
 * Task creation core — shared by the tasks:create RPC handler (fresh-create
 * path) and the create_task session tool. Creates the task on the board only:
 * task.yaml + orchestrator parent session + reserved TASK label + spec sources.
 * Never starts a run — running is tasks:run / TaskRunner.
 */
import { saveTaskDocument, serializeTaskYaml, type TaskSpec } from '@craft-agent/shared/tasks'
import { createLogger } from '@craft-agent/shared/utils'
import type { ISessionManager } from '../handlers/session-manager-interface'

const log = createLogger('tasks-create')

export interface TaskOrchestratorSetupResult {
  taskLabelId?: string
  warnings: string[]
}

export interface CreateTaskFromSpecResult {
  slug: string
  orchestratorSessionId: string
  taskLabelId?: string
  warnings: string[]
}

/**
 * Agent-created Tasks follow the same project inheritance rule as spawned
 * sessions: an explicit project wins; otherwise keep work in the invoking
 * session's project. An unbound invoking session leaves the Task unbound.
 */
export function resolveCreateTaskProjectId(
  requestedProjectId: string | undefined,
  currentProjectId: string | undefined,
): string | undefined {
  return requestedProjectId ?? currentProjectId
}

/**
 * Agent-created Tasks inherit the invoking session's model and connection
 * unless `spec.defaults` already names them. Node-level overrides still win
 * at dispatch.
 */
export function inheritTaskExecutionDefaults(
  spec: TaskSpec,
  session: { model?: string; llmConnection?: string },
): TaskSpec {
  const model = spec.defaults?.model || session.model
  const llmConnection = spec.defaults?.llmConnection || session.llmConnection
  if (model === spec.defaults?.model && llmConnection === spec.defaults?.llmConnection) {
    return spec
  }
  return {
    ...spec,
    defaults: {
      ...spec.defaults,
      ...(model ? { model } : {}),
      ...(llmConnection ? { llmConnection } : {}),
    },
  }
}

/**
 * Post-create setup shared by ALL orchestrator paths (attach / adopt / fresh):
 * apply the reserved "Task" label and enable the spec's sources on the
 * orchestrator session. Fail-soft — neither a label nor a sources problem may
 * fail task creation; problems surface as warnings instead.
 */
export async function finishTaskOrchestrator(
  sessionManager: ISessionManager,
  orchestratorSessionId: string,
  spec: TaskSpec,
): Promise<TaskOrchestratorSetupResult> {
  const warnings: string[] = []
  const applied = await sessionManager.applyTaskLabel(orchestratorSessionId).catch((err: unknown) => {
    log.warn('applyTaskLabel failed for orchestrator', { orchestratorSessionId, err })
    warnings.push('The reserved Task label could not be applied.')
    return undefined
  })
  if (spec.sources?.length) {
    await Promise.resolve(sessionManager.setSessionSources(orchestratorSessionId, spec.sources)).catch(
      (err: unknown) => {
        log.warn('setSessionSources failed for orchestrator', { orchestratorSessionId, err })
        warnings.push(`Sources could not be enabled on the orchestrator: ${spec.sources!.join(', ')}`)
      },
    )
  }
  return { taskLabelId: applied?.labelId, warnings }
}

/**
 * Fresh-create: persist task.yaml (unless the caller already saved it) and
 * create the orchestrator parent session bound to the slug. Creation only —
 * no child sessions, no run log, no TaskRunner.
 */
export async function createTaskFromSpec(
  sessionManager: ISessionManager,
  workspaceId: string,
  workspaceRoot: string,
  spec: TaskSpec,
  opts?: { save?: boolean },
): Promise<CreateTaskFromSpecResult> {
  if (opts?.save !== false) {
    saveTaskDocument(workspaceRoot, serializeTaskYaml({ ...spec, schema_version: 2 }), null)
  }

  const orchestrator = await sessionManager.createSession(workspaceId, {
    name: spec.title,
    projectId: spec.project,
    // Stable linkage: this session orchestrates task `spec.id` across all of its runs.
    taskSlug: spec.id,
    // Explicit cwd from the spec seeds the orchestrator; children inherit it at dispatch.
    // Omitted → orchestrator falls back to the project/workspace default working directory.
    ...(spec.cwd ? { workingDirectory: spec.cwd } : {}),
    ...(spec.defaults?.model ? { model: spec.defaults.model } : {}),
    ...(spec.defaults?.llmConnection ? { llmConnection: spec.defaults.llmConnection } : {}),
    // Persisted task autonomy also seeds the orchestrator session (children read it via the runner).
    ...(spec.defaults?.permissionMode ? { permissionMode: spec.defaults.permissionMode } : {}),
  })
  const setup = await finishTaskOrchestrator(sessionManager, orchestrator.id, spec)
  return { slug: spec.id, orchestratorSessionId: orchestrator.id, ...setup }
}
