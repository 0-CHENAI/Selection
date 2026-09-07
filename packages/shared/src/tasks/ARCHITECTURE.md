# Tasks / Conductor Architecture

Frozen contracts for the Tasks kanban Conductor. Implementation lives in
`@craft-agent/shared/tasks` (spec, validation, storage) and
`@craft-agent/server-core/tasks` (runner). This document replaces the missing
`sessions/.../tasks-architecture.md` referenced by earlier schema comments.

The technical preview is developed on `codex/swarm-conductor-preview`, based
on `origin/test`. Do not commit Conductor work directly onto `test`.
User-facing copy lives in `USER-GUIDE.md`. New tasks enter only through explicit V3 YAML import.
The import RPC rejects older/missing versions and existing task IDs. The save RPC requires
an existing document. Legacy reading and explicit migration remain separate contracts.
Agent creation and natural-language generation are disabled at the tool and RPC boundaries.
`orchestrate` is off outside preview builds unless explicitly enabled.

## 1. Product modes

- `runner` is a run *strategy*, not a node kind.
- `conduct`: freeze revision 0 at start; schedule only that graph.
- `orchestrate`: the task parent session (system Coordinator) may apply
  constrained patches to pending nodes of the current run. Requires the feature
  flag (or preview build) and a Swarm-enabled parent session.
- `kind: orchestrator` migrates to a normal `session` in v2. Dynamic coordination
  is never a DAG node.
- Automations / Agent Events are out of scope.

## 2. v1 / v2 dual runtime

- No `schema_version` → `sourceVersion: 1`. Editor may in-memory migrate for
  display and must surface `migrationWarnings`. Disk is unchanged until the
  first explicit v2 save.
- **Unsaved v1 files keep v1 execution**: only `session` and the legacy
  `orchestrator` kind run; every other kind is `skipped` and satisfies
  dependents. This is the characterization contract locked by
  `TaskRunner.test.ts` (`skips non-session node kinds…`, `treats skipped nodes
  as satisfied dependencies`).
- First v2 save: copy the original YAML to `tasks/<slug>/.history/`, then write
  `schema_version: 2`.
- v2 runs: unknown/unimplemented kinds **refuse to start**. Never silent-skip.
- v2 parse is Zod `.strict()`. Unknown fields are errors. Saves require
  `expectedEtag`; mismatch refuses overwrite.
- `ui.layout` is editor-only and ignored at runtime.

## 3. Run and node state

Run: `running | pausing | paused | waiting-approval | waiting-budget |
waiting-coordinator | verifying | repairing | interrupted | stopped |
completed | failed`.

Node: `pending | ready | running | retry-wait | waiting-approval | done |
failed | invalid | cancelled | skipped | interrupted`.

Promotion rules:

- `pausing`: stop dispatching; in-flight continue; become `paused` at
  `inFlight === 0`.
- `waiting-approval` / `waiting-budget` promote to *run* status only when there
  is no in-flight work and no other ready node. Otherwise the run stays
  `running` and the snapshot carries `blockers[]`.
- `interrupted` is written only by startup scan. Scan never schedules.
- `skipped` is v1 unimplemented kinds, or a v2 `route` branch that was not
  taken. A v2 unimplemented kind is not `skipped`.

## 4. Control RPC

Do not reuse v1 `resume()` auto-continue after restart.

| Action | Legal from | Behavior |
|---|---|---|
| Startup scan | any non-terminal on disk | Hydrate from the **run spec snapshot**, mark prior `running`/`retry-wait` as `interrupted`, restore `waiting-approval`, **do not schedule** |
| `tasks:resume` | `paused` \| `pausing` | Resume dispatch. Idempotent snapshot. |
| `tasks:continue` | `interrupted` | Reuse `done` outputs; re-dispatch `interrupted` nodes. |
| `tasks:stop` | any non-terminal | Cancel in-flight children; from P3 run ready `finally` nodes; then `stopped`. |
| `tasks:pause` | `running` | Enter `pausing` then `paused`. |

Illegal transitions return a typed conflict. Repeats return the current snapshot.
Hydration **must** read `spec.json` / `spec-revisions/0000.json`, never live
`task.yaml`.

Background-task chip “Stop Task” is a different surface and must keep distinct
copy.

## 5. Orchestration status and legacy cards

Scheduling and terminal correctness use only `TaskRunSnapshotDto` and the
durable run state machine. Session status, labels, and kanban columns are never
inputs to DAG/Swarm scheduling. The card updates below are compatibility mirrors
for existing boards and may be removed without changing run semantics.

Top-level orchestrator card:

- Start → status `in-progress`.
- Success, failure, or user stop → status `needs-review`.
- Pause / approval / budget / interrupted keep the card open.
- Never auto-set top-level `done` or `cancelled`.
- Column: first project column whose `dropStatusId` matches the target status;
  if none, keep the current column. Default three-column boards still use
  built-in `todo` / `in-progress` / `done`.

Child session cards:

- `running` → `in-progress`
- `done` → `done`
- `failed` / `invalid` → `needs-review`
- `cancelled` / `interrupted` → `todo` (never session status `cancelled`)
- Columns use the same `dropStatusId` resolver. No hardcoded column ids.

Board progress and pills read `TaskRunSnapshotDto` from `tasks:runChanged`.
`KanbanBoardContainer.deriveRunState` heuristics are retired.

`ConductorSessionHost.resolveKanbanColumn(sessionId, statusId)` looks up the
session project’s `kanbanColumns`. Missing match returns `null` (keep column).

Child sessions default `permissionMode` to `safe` when the spec omits one.
Never fall through to a more permissive workspace default. Tasks that require
write access must declare an explicit task ceiling and node permission.

## 6. Persistence

```
tasks/<slug>/task.yaml
tasks/<slug>/.history/<timestamp>.yaml   # original v1 bytes on first v2 save
tasks/<slug>/runs/<runId>/run-log.jsonl  # source of truth (seq, t, revision, event)
tasks/<slug>/runs/<runId>/run-state.json # atomic derived checkpoint
tasks/<slug>/runs/<runId>/spec.json      # v1 snapshot (keep; dual-read)
tasks/<slug>/runs/<runId>/spec-revisions/0000.json
tasks/<slug>/runs/<runId>/nodes/<id>.json                 # v1
tasks/<slug>/runs/<runId>/nodes/<instanceId>/attempt-n.json
```

Append the event and checkpoint, then push UI. Idempotency key:
`runId + seq + decisionId`. Never rewrite historical v1 logs or `nodes/<id>.json`.
Readers accept both layouts.

## 7. Node semantics (v2)

Caps: 64 definition nodes, depth 24, width 24, loop.max ≤ 50, 256 live
instances per run. Exceeding 256 fails the run (no silent truncate).

- `session`: spawn one child session and run `prompt`.
- `parallel`: model-less fork anchor. `depends_on` fan-out already works;
  generators must not insert an empty `parallel` on every branch.
- `route`: ordered cases + required `default`. Untaken branches are `skipped`.
- `map`: one instance per array item (`${item}`, `${index}`), honor local
  `max_parallel`, aggregate in source order. `instanceId` = `{nodeId}#{index}`.
- `loop`: each iteration is an instance with index + previous output. `max` is
  required. Exhaustion fails or takes `else`.
- `approval`: `waiting-approval`. Reject fails the node. Timeout fails the
  node. Never auto-approve. Persist the deadline; a dead process evaluates
  expiry on scan.
- `synthesize` / `verify` / `judge` / `filter` / `aggregate` / `finally`:
  see the implementation plan. `finally` runs after dependents terminate
  (`all_done` default). Its failure cannot overwrite the original failure.
  User stop cancels in-flight sessions, still runs ready `finally`, then
  `stopped`.
- Downstream `depends_on: [map_or_loop]` waits for every instance.
- Repair targeting a definition node re-runs all of its non-cancelled instances.
- “Apply this run graph to the definition” writes definition nodes only —
  never expanded instances.

Conditions are a structured AST (no JavaScript):

```
leaf   = { ref, op, value? }
op     = exists | eq | ne | gt | gte | lt | lte | contains | in
combo  = { all: [...] } | { any: [...] } | { not: ... }
```

Refs may only name task params, completed node outputs, and map/loop locals.

Outputs: `{ name, kind, type, required, enum, description }`.
`kind: param` = string/number/boolean/enum/json/text.
`kind: artifact` = workspace-relative path; server resolves the real path,
rejects absolute paths and symlink escape from the workspace root, and records
only the relative path, MIME, size, and hash.

`submit_task_output({ text?, values })` is required when a node declares
outputs. Missing call → `invalid` (retryable). Nodes with no outputs still
use final assistant text (v1 compat).

`submit_task_verdict` replaces free-text `VERDICT:`. Historical v1 runs keep
the text parser. Human chat on the parent session is never a verdict; the
runner owns a correlated turn queue.

Retry triggers: `error | empty | invalid`. v2 `cache:pure` is same-run only.
v3 cache is `none | run-pure | workspace-pure`. `workspace-pure` is opt-in,
fingerprint-complete, 7-day TTL, and never applies to verify/judge/approval/
finally or coordinator decisions.

Sensitive params are omitted from logs and plaintext persistence. Resume /
continue must re-prompt. Residual risk: once interpolated into a child prompt,
the session transcript may still contain the value. Diagnostics redact; we do
not rewrite history.

Token budget: stop dispatching new nodes, allow in-flight to finish, enter
`waiting-budget` when idle. Only the user may raise the budget or stop.
The model cannot change the budget.

## 8. Orchestrate patches (P4)

Coordinator turns at: before first schedule; on node failure / approval
response / budget wait / no ready nodes; before final verify. Optional
“after every ready batch” is off by default.

`submit_orchestration_patch` carries `runId`, `decisionId`, `baseRevision`,
rationale, add / update-pending / cancel-pending, and continue / pause /
complete / fail.

Running, done, failed nodes and historical outputs are immutable. Patches
cannot change task id, goal, project, cwd, sources, skills, runner, budget,
or permission ceiling. New node permissions cannot exceed the task ceiling.
Models must come from the current workspace. Post-patch graph must be
acyclic, fully referenced, and inside caps. Stale revision, replayed
`decisionId`, or wrong `runId` are rejected. Max 8 graph revisions per run;
max two invalid-patch retries, then pause for review.

A legal patch is persisted as a new revision before scheduling. Apply-to-
definition shows a definition-level diff and requires confirmation.

## 9. Characterization baseline (P0)

These files pin current v1 behavior. Do not “fix” them in P0. P1/P3
intentionally rewrite the contracts listed below.

Core:

- `packages/server-core/src/tasks/TaskRunner.test.ts`
- `packages/server-core/src/tasks/create-task.test.ts`
- `packages/shared/src/tasks/schema.test.ts`
- `packages/shared/src/tasks/slug.test.ts`
- `packages/session-tools-core/src/handlers/create-task.test.ts`
- `packages/session-tools-core/src/handlers/run-task.test.ts`
- `packages/session-tools-core/src/handlers/get-task-results.test.ts`
- `apps/electron/src/renderer/components/app-shell/kanban/__tests__/task-spec-form.test.ts`
- `apps/electron/src/renderer/components/app-shell/kanban/__tests__/subtask-merge.test.ts`
- `apps/electron/src/renderer/components/app-shell/kanban/__tests__/node-state-pill.test.ts`

Adjacent (do not treat as Conductor contract):

- `packages/server-core/src/sessions/adopt-task-draft.test.ts`
- `packages/session-tools-core/src/handlers/list-background-tasks.test.ts`
- `apps/electron/src/renderer/components/app-shell/__tests__/background-task-chip-state.test.ts`

P1 will rewrite these TaskRunner contracts:

- orchestrator tile moves to `done` on completion
- `pause` is immediately `paused` (becomes `pausing` → `paused`)
- `stop` does not update the top-level card (becomes `needs-review`)
- `resume()` after restart auto-schedules (becomes scan + `continue`)

P3 will rewrite skip-as-satisfied-dependency for **v2** files only. Unsaved
v1 files keep those tests.

## 10. Public IPC additions

Keep `tasks:create`. Add `tasks:save`, `tasks:runChanged`, `tasks:listRuns`,
`tasks:continue`, `tasks:respondApproval`, `tasks:updateRunLimits`,
`tasks:applyRunRevision`. Control RPCs return `TaskRunSnapshotDto`.

`TaskGetResult` grows `yaml`, `etag`, `sourceVersion`, `migrationWarnings`,
`latestRun`.
