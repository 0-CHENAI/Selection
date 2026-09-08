/**
 * RPC handlers for the Tasks Conductor.
 *
 * Channels (all REMOTE_ELIGIBLE — tasks are workspace content):
 *   tasks:validate — lint/dry-run a task.yaml string (no side effects)
 *   tasks:create   — write task.yaml + create the orchestrator parent session
 *   tasks:run      — start a run (returns the run snapshot)
 *   tasks:pause | resume | stop — run control
 *   tasks:get      — spec + (optional) active run-state
 *   tasks:list     — task slugs with a task.yaml
 *
 * The legacy `tasks:getOutput` (background-task remnant) is handled in sessions.ts
 * and intentionally left untouched; retiring it is a separate cleanup.
 */
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  TaskGenerateRequest,
  TaskGenerateAck,
  TaskCreateRequest,
  TaskCreateResult,
  TaskSaveRequest,
  TaskSaveResult,
  TaskRunRequest,
  TaskValidationResultDto,
  TaskGetResult,
  TaskResultsDto,
  TaskControlResultDto,
  TaskRunSnapshotDto,
  TaskRespondApprovalRequest,
  TaskUpdateRunLimitsRequest,
  TaskApplyRunRevisionRequest,
  TaskApplyRunRevisionResult,
  TaskTemplateSaveRequest,
  TaskTemplateSaveResult,
  TaskTemplateSummaryDto,
  TaskTemplateDetailDto,
  TaskCreateFromTemplateRequest,
} from '@craft-agent/shared/protocol'
import { createHash } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { getWorkspaceByNameOrId, getLlmConnections } from '@craft-agent/shared/config'
import {
  buildGeneratorPrompt,
  buildRepairPrompt,
  parseTaskYaml,
  parseTaskDocument,
  parseTaskImport,
  loadTaskDocument,
  saveTaskDocument,
  taskYamlPath,
  listTaskSlugs,
  listRunIds,
  loadTaskResults,
  TaskEtagConflictError,
  definitionDiff,
  mergeRunDefinition,
  previewV3Migration,
  readLatestSpecRevision,
  serializeTaskYaml,
  listTaskTemplateSummaries,
  loadTaskTemplate,
  saveTaskTemplate,
  deleteTaskTemplate,
  specFromTemplate,
  redactTemplateSource,
} from '@craft-agent/shared/tasks'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { TaskRunner, TaskControlError, createTaskFromSpec, clearSubmittedDefinition, resolveGeneratedYaml } from '../../tasks'

import { createLogger } from '@craft-agent/shared/utils'
const tasksLog = createLogger('tasks-generate')
const GENERATE_TIMEOUT_MS = 180_000
const MAX_GENERATE_ATTEMPTS = 2

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tasks.VALIDATE,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.SAVE,
  RPC_CHANNELS.tasks.GENERATE,
  RPC_CHANNELS.tasks.RUN,
  RPC_CHANNELS.tasks.PAUSE,
  RPC_CHANNELS.tasks.RESUME,
  RPC_CHANNELS.tasks.STOP,
  RPC_CHANNELS.tasks.CONTINUE,
  RPC_CHANNELS.tasks.RESPOND_APPROVAL,
  RPC_CHANNELS.tasks.UPDATE_RUN_LIMITS,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.LIST_TEMPLATES,
  RPC_CHANNELS.tasks.GET_TEMPLATE,
  RPC_CHANNELS.tasks.SAVE_TEMPLATE,
  RPC_CHANNELS.tasks.DELETE_TEMPLATE,
  RPC_CHANNELS.tasks.CREATE_FROM_TEMPLATE,
  RPC_CHANNELS.tasks.LIST_RUNS,
  RPC_CHANNELS.tasks.APPLY_RUN_REVISION,
  RPC_CHANNELS.tasks.GET_RESULTS,
] as const

/** Map a shared ValidationResult (+ parsed spec) onto the wire DTO. */
function toValidationDto(result: ReturnType<typeof parseTaskYaml>): TaskValidationResultDto {
  const issue = (i: { path: string; message: string; severity: 'error' | 'warning'; suggestion?: string }) => ({
    path: i.path,
    message: i.message,
    severity: i.severity,
    ...(i.suggestion ? { suggestion: i.suggestion } : {}),
  })
  const sessionNodeCount = result.spec?.nodes.filter((n) => n.kind === 'session').length ?? 0
  return {
    valid: result.valid,
    errors: result.errors.map(issue),
    warnings: result.warnings.map(issue),
    estimate: result.spec ? { nodeCount: result.spec.nodes.length, sessionNodeCount } : undefined,
    ...(result.spec ? { spec: result.spec } : {}),
  }
}

export function registerTasksHandlers(server: RpcServer, deps: HandlerDeps): void {
  // One Conductor per workspace, created on demand. Holds active runs in memory.
  const runners = new Map<string, TaskRunner>()

  function workspaceOrThrow(workspaceId: string) {
    const ws = getWorkspaceByNameOrId(workspaceId)
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`)
    return ws
  }

  function runnerFor(workspaceId: string): TaskRunner {
    let runner = runners.get(workspaceId)
    if (!runner) {
      const ws = workspaceOrThrow(workspaceId)
      runner = new TaskRunner({
        host: deps.sessionManager,
        workspaceId: ws.id,
        workspaceRoot: ws.rootPath,
        // Dynamic nodes may only name a model exposed by a configured
        // connection. The global registry is a catalog, not proof that this
        // workspace can actually dispatch the model.
        allowedModels: new Set(
          getLlmConnections().flatMap((connection) => [
            ...(connection.defaultModel ? [connection.defaultModel] : []),
            ...(connection.models ?? []).map((model) => typeof model === 'string' ? model : model.id),
          ]),
        ),
        onRunChanged: (snapshot) => {
          pushTyped(server, RPC_CHANNELS.tasks.RUN_CHANGED, { to: 'workspace', workspaceId: ws.id }, ws.id, snapshot)
        },
      })
      runners.set(workspaceId, runner)
      runner.scanUnfinished()
    }
    return runner
  }

  function controlResult(
    runner: TaskRunner,
    slug: string,
    runId: string,
    fn: () => TaskRunSnapshotDto | Promise<TaskRunSnapshotDto>,
  ): Promise<TaskControlResultDto> {
    return Promise.resolve()
      .then(fn)
      .then((snapshot) => ({ snapshot }))
      .catch((err: unknown) => {
        if (err instanceof TaskControlError) {
          // Preserve the authoritative run snapshot on conflicts. Returning an
          // empty placeholder makes the renderer briefly lose node/revision and
          // budget state precisely when it needs to explain the blocker.
          const snapshot = runner.getRunState(slug, runId) ?? {
            slug,
            runId,
            taskId: slug,
            status: err.status,
            nodes: [],
            tokensUsed: 0,
          }
          return { snapshot, conflict: { code: 'conflict' as const, message: err.message } }
        }
        throw err
      })
  }

  deps.sessionManager.setTaskRunnerLookup((workspaceId) => runnerFor(workspaceId))

  // tasks:validate — lint/dry-run; no side effects.
  server.handle(RPC_CHANNELS.tasks.VALIDATE, async (_ctx, _workspaceId: string, yaml: string): Promise<TaskValidationResultDto> => {
    return toValidationDto(parseTaskDocument(yaml))
  })

  async function persistImportedYaml(workspaceId: string, yaml: string, confirmV3Migration?: boolean): Promise<TaskCreateResult> {
    const ws = workspaceOrThrow(workspaceId)
    const parsed = parseTaskImport(yaml)
    const validation = toValidationDto(parsed)
    if (!parsed.valid || !parsed.spec) {
      return { slug: '', orchestratorSessionId: '', validation }
    }
    const spec = parsed.spec
    const existing = loadTaskDocument(ws.rootPath, spec.id)
    if (existing) throw new Error('A task with this id already exists. Import with a new id or edit the existing task.')
    const saved = saveTaskDocument(ws.rootPath, yaml, null, { confirmV3Migration })

    // YAML imports create a fresh orchestrator without adopting generation drafts.
    try {
      const created = await createTaskFromSpec(deps.sessionManager, workspaceId, ws.rootPath, saved.spec!, { save: false })
      validation.warnings.push(...created.warnings.map(message => ({ path: 'session', message, severity: 'warning' as const })))
      return { slug: created.slug, orchestratorSessionId: created.orchestratorSessionId, validation, taskLabelId: created.taskLabelId }
    } catch (error) {
      // Remove only this import's unchanged file, allowing retry after session creation fails.
      if (loadTaskDocument(ws.rootPath, spec.id)?.etag === saved.etag) {
        unlinkSync(taskYamlPath(ws.rootPath, spec.id))
      }
      throw error
    }
  }

  // tasks:create — write task.yaml + create the orchestrator parent session.
  server.handle(RPC_CHANNELS.tasks.CREATE, async (_ctx, workspaceId: string, req: TaskCreateRequest): Promise<TaskCreateResult> => {
    if (req.attachToExistingSession || req.orchestratorSessionId) {
      throw new Error('Import cannot adopt or bind an existing session. Import a new task instead.')
    }
    return persistImportedYaml(workspaceId, req.yaml, req.confirmV3Migration)
  })

  // tasks:save — etag-guarded write that stamps schema_version 2 or 3 and backups a v1 original.
  server.handle(RPC_CHANNELS.tasks.SAVE, async (_ctx, workspaceId: string, req: TaskSaveRequest): Promise<TaskSaveResult> => {
    const ws = workspaceOrThrow(workspaceId)
    try {
      const incoming = parseTaskDocument(req.yaml)
      if (!incoming.spec || !loadTaskDocument(ws.rootPath, incoming.spec.id)) {
        throw new Error('Save requires an existing task. Create the workflow in the editor first.')
      }
      const saved = saveTaskDocument(ws.rootPath, req.yaml, req.expectedEtag, {
        confirmV3Migration: req.confirmV3Migration,
      })
      return {
        slug: saved.slug,
        validation: toValidationDto({ valid: saved.valid, errors: saved.errors, warnings: saved.warnings, spec: saved.spec }),
        spec: saved.spec,
        yaml: saved.yaml,
        etag: saved.etag,
        sourceVersion: saved.sourceVersion,
        migrationWarnings: saved.migrationWarnings,
      }
    } catch (err) {
      if (err instanceof TaskEtagConflictError) {
        return {
          slug: '',
          validation: {
            valid: false,
            errors: [{ path: 'etag', message: err.message, severity: 'error' }],
            warnings: [],
          },
          conflict: { code: 'etag-conflict', expected: err.expected, actual: err.actual },
          etag: err.actual,
        }
      }
      throw err
    }
  })

  // Proposal only: acknowledge a temporary safe-mode session, publish its validated
  // definition asynchronously, then dispose it. CREATE is a separate user action.
  server.handle(RPC_CHANNELS.tasks.GENERATE, async (_ctx, workspaceId: string, req: TaskGenerateRequest): Promise<TaskGenerateAck> => {
    workspaceOrThrow(workspaceId)
    if (!req.goal?.trim() || req.goal.length > 50_000) throw new Error('A goal of 1–50000 characters is required')
    if (req.currentYaml !== undefined && (typeof req.currentYaml !== 'string' || req.currentYaml.length > 1_000_000)) throw new Error('Invalid proposal input')
    const orchestrator = await deps.sessionManager.createSession(workspaceId, {
      name: req.title?.trim() || 'New task',
      // Hidden and never adopted into a persistent task.
      taskDraft: true,
      // Bind the draft to the project so it authors against the project's <project_context>.
      ...(req.projectId ? { projectId: req.projectId } : {}),
      // Seed the orchestrator with the cwd chosen in the composer so the authored spec and any
      // dispatched children inherit it. Omitted → project/workspace default working directory.
      ...(req.cwd ? { workingDirectory: req.cwd } : {}),
      ...(req.model ? { model: req.model } : {}),
      // Non-default (pi/*) models need their serving connection to resolve a backend — without it the
      // authoring turn completes instantly with no output, producing an invalid/empty spec.
      ...(req.llmConnection ? { llmConnection: req.llmConnection } : {}),
      // Task-level sources become the draft's enabled set (omitted → workspace default).
      ...(req.enabledSourceSlugs?.length ? { enabledSourceSlugs: req.enabledSourceSlugs } : {}),
      // Seed the visible task autonomy so authoring runs at the chosen mode, not the workspace default.
      permissionMode: 'safe',
    })
    const sessionId = orchestrator.id
    tasksLog.info('generate started', {
      workspaceId,
      sessionId,
      hasCwd: Boolean(req.cwd),
      model: req.model,
      projectId: req.projectId,
      hasConnection: Boolean(req.llmConnection),
      permissionMode: req.permissionMode,
    })

    // Send `prompt` to the orchestrator and await its next final turn. Subscribe BEFORE
    // sending so a fast turn can't complete before we listen; a timeout keeps a hung turn
    // from blocking forever.
    const askOrchestrator = (prompt: string) =>
      new Promise<{ text: string; generation: number }>((resolve, reject) => {
        clearSubmittedDefinition(sessionId)
        let settled = false
        let off: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          off?.()
          if (timer) clearTimeout(timer)
          fn()
        }
        off = deps.sessionManager.onSessionComplete((evt) => {
          if (evt.sessionId !== sessionId) return
          if (evt.reason && evt.reason !== 'complete') {
            finish(() => reject(new Error(`Proposal session ended with ${evt.reason}. Check the model connection and retry.`)))
            return
          }
          const text = evt.finalText ?? deps.sessionManager.getSessionFinalText(sessionId) ?? ''
          finish(() => resolve({ text, generation: evt.generation }))
        })
        timer = setTimeout(() => finish(() => {
          clearSubmittedDefinition(sessionId)
          reject(new Error('Task generation timed out'))
        }), GENERATE_TIMEOUT_MS)
        void Promise.resolve(deps.sessionManager.sendMessage(sessionId, prompt))
          .catch((err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))))
      })

    // Run the generate→repair loop in the background and push the result when done. Awaiting
    // here would re-introduce the synchronous-RPC-over-WS timeout this async path exists to avoid.
    void (async () => {
      const startedAt = Date.now()
      try {
        // Generate, then auto-repair: the orchestrator still holds the conversation, so if the
        // authored spec fails validation (commonly a ${nodes.X.output} ref to an undeclared
        // node) hand the concrete errors back and re-validate. Bounded so a model that can't
        // self-correct can't loop forever — the last attempt's validation is returned as-is.
        let prompt = buildGeneratorPrompt(req.goal, req.title)
        if (req.currentYaml) prompt += '\nRevise this existing definition according to the user goal. Preserve its id and untouched fields:\n' + req.currentYaml
        let yaml = ''
        let parsed = parseTaskYaml(yaml)
        let attempts = 0
        for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
          attempts = attempt + 1
          const turn = await askOrchestrator(prompt)
          try {
            yaml = resolveGeneratedYaml(sessionId, turn.generation, turn.text)
          } catch (error) {
            if (attempt + 1 >= MAX_GENERATE_ATTEMPTS) throw error
            prompt = 'Submit the COMPLETE V3 definition with submit_task_definition. No task has been created.'
            continue
          }
          parsed = parseTaskYaml(yaml)
          if (parsed.valid) break
          prompt = buildRepairPrompt(parsed.errors)
        }
        const validation = toValidationDto(parsed)
        // Do NOT persist here. tasks:create is the only writer of the live task.yaml — writing
        // eagerly on generation would clobber an existing task before the user confirms the edit.
        // The authored spec is delivered below via tasks:generated and saved on save/create.
        tasksLog.info('generate finished', {
          sessionId,
          valid: parsed.valid,
          attempts,
          elapsedMs: Date.now() - startedAt,
          slug: parsed.spec?.id ?? '',
        })
        pushTyped(server, RPC_CHANNELS.tasks.GENERATED, { to: 'workspace', workspaceId }, workspaceId, {
          orchestratorSessionId: sessionId,
          slug: parsed.spec?.id ?? '',
          spec: parsed.spec,
          yaml,
          validation,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        tasksLog.error('generate failed', { sessionId, elapsedMs: Date.now() - startedAt, error: message })
        // Preserve the caller's draft and report failure; cleanup runs in finally.
        pushTyped(server, RPC_CHANNELS.tasks.GENERATED, { to: 'workspace', workspaceId }, workspaceId, {
          orchestratorSessionId: sessionId,
          slug: '',
          yaml: '',
          validation: { valid: false, errors: [], warnings: [] },
          error: message,
        })
      } finally {
        clearSubmittedDefinition(sessionId)
        await deps.sessionManager.deleteSession(sessionId).catch(error => tasksLog.error('draft cleanup failed', { sessionId, error: String(error) }))
      }
    })()

    return { orchestratorSessionId: sessionId }
  })

  // tasks:run — start an existing run.
  server.handle(RPC_CHANNELS.tasks.RUN, async (_ctx, workspaceId: string, req: TaskRunRequest) => {
    const orchestrator = req.orchestratorSessionId
      ? await deps.sessionManager.getSession(req.orchestratorSessionId)
      : null
    return runnerFor(workspaceId).run(req.slug, {
      runId: req.runId,
      orchestratorSessionId: req.orchestratorSessionId,
      params: req.params,
      orchestrateAllowed: orchestrator?.swarmEnabled === true,
    })
  })

  server.handle(RPC_CHANNELS.tasks.PAUSE, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, slug, runId, () => runner.pause(slug, runId))
  })

  server.handle(RPC_CHANNELS.tasks.RESUME, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, slug, runId, () => runner.resume(slug, runId))
  })

  server.handle(RPC_CHANNELS.tasks.STOP, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, slug, runId, () => runner.stop(slug, runId))
  })

  server.handle(RPC_CHANNELS.tasks.CONTINUE, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, slug, runId, () => runner.continue(slug, runId))
  })

  server.handle(RPC_CHANNELS.tasks.RESPOND_APPROVAL, async (_ctx, workspaceId: string, req: TaskRespondApprovalRequest) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, req.slug, req.runId, () => runner.respondApproval(req.slug, req.runId, req.nodeId, req.approved, req.feedback, req.feedbackOnly))
  })

  server.handle(RPC_CHANNELS.tasks.UPDATE_RUN_LIMITS, async (_ctx, workspaceId: string, req: TaskUpdateRunLimitsRequest) => {
    const runner = runnerFor(workspaceId)
    return controlResult(runner, req.slug, req.runId, () => runner.updateRunLimits(req.slug, req.runId, req.tokenBudget, req.params))
  })

  // tasks:get — spec + (optional) active run-state.
  server.handle(RPC_CHANNELS.tasks.GET, async (_ctx, workspaceId: string, slug: string, runId?: string): Promise<TaskGetResult> => {
    const ws = workspaceOrThrow(workspaceId)
    const loaded = loadTaskDocument(ws.rootPath, slug)
    if (!loaded) {
      return {
        slug,
        validation: { valid: false, errors: [{ path: 'root', message: `Task "${slug}" not found`, severity: 'error' }], warnings: [] },
        run: null,
      }
    }
    const runner = runnerFor(workspaceId)
    const run = runId ? runner.getRunState(slug, runId) : null
    return {
      slug,
      validation: toValidationDto({ valid: loaded.valid, errors: loaded.errors, warnings: loaded.warnings, spec: loaded.spec }),
      spec: loaded.spec,
      yaml: loaded.yaml,
      etag: loaded.etag,
      sourceVersion: loaded.sourceVersion,
      migrationWarnings: loaded.migrationWarnings,
      run,
      latestRun: run ?? runner.getLatestRun(slug),
    }
  })

  // tasks:list — slugs with a task.yaml.
  server.handle(RPC_CHANNELS.tasks.LIST, async (_ctx, workspaceId: string): Promise<string[]> => {
    return listTaskSlugs(workspaceOrThrow(workspaceId).rootPath)
  })

  server.handle(RPC_CHANNELS.tasks.LIST_TEMPLATES, async (_ctx, workspaceId: string): Promise<TaskTemplateSummaryDto[]> => {
    return listTaskTemplateSummaries(workspaceOrThrow(workspaceId).rootPath)
  })

  server.handle(RPC_CHANNELS.tasks.GET_TEMPLATE, async (_ctx, workspaceId: string, id: string): Promise<TaskTemplateDetailDto> => {
    const loaded = loadTaskTemplate(workspaceOrThrow(workspaceId).rootPath, id)
    if (!loaded) throw new Error(`Template "${id}" was not found.`)
    const { spec, yaml, ...summary } = loaded
    return { ...summary, spec, yaml }
  })

  server.handle(RPC_CHANNELS.tasks.SAVE_TEMPLATE, async (_ctx, workspaceId: string, req: TaskTemplateSaveRequest): Promise<TaskTemplateSaveResult> => {
    if (typeof req?.yaml !== 'string' || !req.yaml.trim()) throw new Error('Template YAML is required.')
    if (typeof req.name !== 'string' || !req.name.trim()) throw new Error('A template name is required.')
    const yaml = redactTemplateSource(req.yaml)
    const imported = parseTaskImport(yaml)
    const validation = toValidationDto(imported)
    if (!imported.valid || !imported.spec) return { id: '', validation }
    const saved = saveTaskTemplate(workspaceOrThrow(workspaceId).rootPath, {
      name: req.name,
      description: req.description,
      tags: req.tags,
      sourceTaskSlug: req.sourceTaskSlug,
      yaml,
    })
    return { id: saved.id, validation }
  })

  server.handle(RPC_CHANNELS.tasks.DELETE_TEMPLATE, async (_ctx, workspaceId: string, id: string): Promise<{ deleted: boolean }> => {
    return { deleted: deleteTaskTemplate(workspaceOrThrow(workspaceId).rootPath, id) }
  })

  server.handle(RPC_CHANNELS.tasks.CREATE_FROM_TEMPLATE, async (_ctx, workspaceId: string, req: TaskCreateFromTemplateRequest): Promise<TaskCreateResult> => {
    if (typeof req?.templateId !== 'string' || !req.templateId.trim()) throw new Error('Template id is required.')
    const spec = specFromTemplate(workspaceOrThrow(workspaceId).rootPath, req.templateId, req.projectId)
    return persistImportedYaml(workspaceId, serializeTaskYaml(spec))
  })

  server.handle(RPC_CHANNELS.tasks.LIST_RUNS, async (_ctx, workspaceId: string, slug: string): Promise<string[]> => {
    return listRunIds(workspaceOrThrow(workspaceId).rootPath, slug)
  })

  // tasks:getResults — storage-backed read of a run's outcome (verdict + per-node output).
  // Reads the durable artifacts (run-log.jsonl, nodes/<id>.json, per-run spec.json snapshot), so it
  // works after restart and without an active in-memory run — unlike tasks:get's run snapshot.
  server.handle(RPC_CHANNELS.tasks.GET_RESULTS, async (_ctx, workspaceId: string, slug: string, runId?: string): Promise<TaskResultsDto> => {
    return loadTaskResults(workspaceOrThrow(workspaceId).rootPath, slug, runId)
  })

  server.handle(RPC_CHANNELS.tasks.APPLY_RUN_REVISION, async (_ctx, workspaceId: string, req: TaskApplyRunRevisionRequest): Promise<TaskApplyRunRevisionResult> => {
    const ws = workspaceOrThrow(workspaceId)
    const live = loadTaskDocument(ws.rootPath, req.slug)
    if (!live?.spec) {
      return {
        diff: { added: [], removed: [], changed: [] },
        validation: { valid: false, errors: [{ path: 'root', message: `Task "${req.slug}" not found`, severity: 'error' }], warnings: [] },
      }
    }
    const runner = runnerFor(workspaceId)
    const activeSnapshot = runner.getRunState(req.slug, req.runId)
    const activeSpec = runner.currentRunSpec(req.slug, req.runId)
    const runRevision = activeSpec && activeSnapshot
      ? { revision: activeSnapshot.revision ?? 0, spec: activeSpec }
      : readLatestSpecRevision(ws.rootPath, req.slug, req.runId)
    if (!runRevision) {
      return {
        diff: { added: [], removed: [], changed: [] },
        validation: { valid: false, errors: [{ path: 'run', message: `No run spec for ${req.runId}`, severity: 'error' }], warnings: [] },
      }
    }
    const runSpecHash = createHash('sha256')
      .update(JSON.stringify(runRevision.spec.nodes))
      .digest('hex')
    const merged = mergeRunDefinition(live.spec, runRevision.spec)
    const diff = definitionDiff(live.spec, merged)
    const yaml = serializeTaskYaml(merged)
    const parsed = parseTaskYaml(yaml)
    const incoming = parseTaskDocument(yaml)
    const validation = toValidationDto(parsed)
    const migrationWarnings = [
      ...incoming.migrationWarnings,
      ...(live.sourceVersion < 3 && incoming.sourceVersion === 3 && incoming.spec
        ? previewV3Migration(incoming.spec).warnings
        : []),
    ]
    const resultBase = {
      diff,
      validation,
      yaml,
      runRevision: runRevision.revision,
      runSpecHash,
      sourceVersion: incoming.sourceVersion,
      migrationWarnings,
    }
    if (!req.confirm) return resultBase
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
      return resultBase
    }
    if (req.expectedRunRevision === undefined || req.expectedRunSpecHash === undefined) {
      return {
        ...resultBase,
        validation: {
          ...validation,
          valid: false,
          errors: [...validation.errors, {
            path: 'run',
            message: 'Run revision confirmation requires the preceding preview identity',
            severity: 'error' as const,
          }],
        },
      }
    }
    if (req.expectedRunRevision !== runRevision.revision) {
      return {
        ...resultBase,
        conflict: { code: 'run-revision-conflict', expected: req.expectedRunRevision, actual: runRevision.revision },
      }
    }
    if (req.expectedRunSpecHash !== runSpecHash) {
      return {
        ...resultBase,
        conflict: { code: 'run-spec-conflict', expected: req.expectedRunSpecHash, actual: runSpecHash },
      }
    }
    try {
      const saved = saveTaskDocument(ws.rootPath, yaml, req.expectedEtag, {
        confirmV3Migration: req.confirmV3Migration === true,
      })
      return {
        ...resultBase,
        validation: toValidationDto({ valid: saved.valid, errors: saved.errors, warnings: saved.warnings, spec: saved.spec }),
        applied: true,
        etag: saved.etag,
        yaml: saved.yaml,
        sourceVersion: saved.sourceVersion,
        migrationWarnings: saved.migrationWarnings,
      }
    } catch (err) {
      if (err instanceof TaskEtagConflictError) {
        return { ...resultBase, conflict: { code: 'etag-conflict', expected: err.expected, actual: err.actual } }
      }
      const message = err instanceof Error ? err.message : String(err)
      if (/without confirmation/.test(message)) {
        return {
          ...resultBase,
          validation: {
            ...validation,
            valid: false,
            errors: [...validation.errors, { path: 'schema_version', message, severity: 'error' as const }],
          },
        }
      }
      throw err
    }
  })
}
