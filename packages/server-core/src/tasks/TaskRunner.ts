/**
 * The Conductor — an in-process DAG runner for Tasks.
 *
 * A `task.yaml` (parsed + validated in @craft-agent/shared/tasks) describes a
 * graph of nodes; each node is a child session. The Conductor:
 *   1. schedules ready nodes (deps satisfied) honoring `max_parallel`,
 *   2. dispatches each as a child session (create + sendMessage), interpolating
 *      `${nodes.<id>.output}` / `${params.<name>}` / `${inputs.<name>}` into the prompt,
 *   3. subscribes to SessionManager's in-process `onSessionComplete` seam,
 *   4. on completion reads the child's final assistant text as the node output,
 *      feeds it to dependents, and reschedules,
 *   5. drives child `sessionStatus` + `kanbanColumn` so the board renders the live DAG,
 *   6. persists an append-only run-log under `tasks/<slug>/runs/<runId>/`.
 *
 * v1 executes `kind: 'session'` nodes wired by `depends_on` + `inputs`.
 * v2 dispatches implemented kinds (session/control/map/loop/transforms).
 *
 * The runner depends on a minimal `ConductorSessionHost` interface (which
 * SessionManager structurally satisfies) so it is unit-testable with a mock.
 */
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import {
  type TaskSpec,
  type TaskNode,
  type NodeOutput,
  type RunLogEntry,
  type NodeRunState,
  type RunStatus,
  nodeTitle,
  interpolateRefs,
  interpolateLocals,
  instanceId,
  definitionId,
  parseForEach,
  resolveArtifact,
  sensitiveParamNames,
  missingSensitive,
  materializeDeps,
  appendRunLog,
  writeRunState,
  readRunState,
  writeNodeOutput,
  writeNodeAttempt,
  readNodeOutput,
  readRunLog,
  loadTaskDocument,
  writeSpecRevision,
  readSpecRevision,
  readLatestSpecRevision,
  listTaskSlugs,
  listRunIds,
  deriveRunStatusFromLog,
  isTerminalRunStatus,
  resolveKanbanColumnId,
  evaluateCondition,
  conditionFromLegacyWhen,
  type ConditionAst,
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS_CAP,
  validateOrchestrationPatch,
  type OrchestrationPatch,
} from '@craft-agent/shared/tasks';
import { isTasksOrchestrateEnabled } from '@craft-agent/shared/feature-flags';
import { createLogger } from '@craft-agent/shared/utils';
import { createHash } from 'crypto';
import { MAX_RUN_INSTANCES, isSessionLikeKind, isControlKind, unimplementedV2Nodes } from './executors';

const conductorLog = createLogger('tasks-conductor');

export { V2_IMPLEMENTED_KINDS, MAX_RUN_INSTANCES } from './executors';

// ---------------------------------------------------------------------------
// Host interface (SessionManager satisfies this structurally)
// ---------------------------------------------------------------------------

export interface ConductorSessionHost {
  /** Creates the child session AND announces it to the renderer (createSession emits
   *  session_created by default), so the subtask appears on the board with its real title. */
  createSession(workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  setSessionStatus(sessionId: string, status: string): Promise<void>;
  setKanbanColumn(sessionId: string, column: string | null): Promise<void>;
  /** Map a session status to a board column. Return null to keep the current column. */
  resolveKanbanColumn?(sessionId: string, statusId: string): Promise<string | null>;
  /** Records the total DAG node count on the orchestrator session for a stable board progress denominator. */
  setTaskNodeCount(sessionId: string, count: number): Promise<void>;
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>;
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void;
  getSessionFinalText(sessionId: string): string | undefined;
  /** Resolved working directory of a session, so children inherit the orchestrator's cwd. */
  getSessionWorkingDirectory(sessionId: string): string | undefined;
}

export interface TaskRunnerDeps {
  host: ConductorSessionHost;
  workspaceId: string;
  workspaceRoot: string;
  /** Optional output summarizer (call_llm/Haiku). When absent, summarize-flagged inputs pass through. */
  summarize?: (text: string) => Promise<string>;
  /** Default `max_parallel` when the spec omits it. */
  defaultMaxParallel?: number;
  /** Injectable clock (run-log timestamps) + run-id generator, for determinism in tests. */
  now?: () => string;
  genRunId?: () => string;
  /** Push a typed snapshot after every durable run/node/budget/approval change. */
  onRunChanged?: (snapshot: RunSnapshot) => void;
}

export interface RunOptions {
  /** The task's persistent parent/orchestrator session (author + final verifier). */
  orchestratorSessionId?: string;
  /** Resolved task param values (merged over the spec's declared defaults). */
  params?: Record<string, unknown>;
  /** Explicit run id (otherwise generated). */
  runId?: string;
  /** When the run completes, message the orchestrator to verify the result. Default true. */
  verifyOnComplete?: boolean;
  /** Disk source version. Unsaved v1 files keep skip semantics; v2 refuses unimplemented kinds. */
  sourceVersion?: 1 | 2;
}

export type { RunStatus };

export class TaskControlError extends Error {
  readonly code = 'conflict' as const;
  constructor(
    readonly status: RunStatus,
    message: string,
  ) {
    super(message);
    this.name = 'TaskControlError';
  }
}

export interface NodeRunStatus {
  id: string;
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
}

export interface RunSnapshot {
  slug: string;
  runId: string;
  taskId: string;
  status: RunStatus;
  orchestratorSessionId?: string;
  nodes: NodeRunStatus[];
  /** Sum of each child's (input + output) tokens observed at completion. */
  tokensUsed: number;
  /** Node ids that currently block the run (approval, budget, interrupt). */
  blockers?: string[];
  revision?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARALLEL = 4;
// Explicit, unattended-safe default for a subtask's permission mode when neither the node nor the task
// defaults set one. Conductor children run with no human to answer an `ask` prompt, so we must NOT fall
// through to the workspace default (which may be `ask` → the child hangs, or read-only `safe` → it
// silently produces nothing). The task editor now persists an explicit `defaults.permissionMode`, so
// this constant only governs hand-authored specs that omit it — and it is never `ask`.
const AUTONOMOUS_DEFAULT_MODE = 'allow-all' as const;
const RUNNING_STATUS = 'in-progress';
const DONE_STATUS = 'done';
const TODO_STATUS = 'todo';
// There is no 'failed' session status (the fixed set is todo|in-progress|needs-review|done|cancelled).
// Failed children and the settled top-level card use 'needs-review'. Runs never auto-close
// the orchestrator tile to done/cancelled — see ARCHITECTURE.md §5.
const FAILED_STATUS = 'needs-review';
const REVIEW_STATUS = 'needs-review';

// A malformed verdict (no parseable VERDICT line) is re-asked this many times before we give up and
// fail the run. These re-asks are format-only — they do NOT consume the repair (max_iterations) budget.
const MAX_UNPARSED_REASKS = 2;

const INPUTS_REF_RE = /\$\{\s*inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g;

function isExecutableTaskNode(node: TaskNode): boolean {
  return node.kind === 'session' || node.kind === 'orchestrator';
}

function isTerminalNodeState(state: NodeRunState | undefined): boolean {
  return (
    state === 'done' ||
    state === 'skipped' ||
    state === 'failed' ||
    state === 'invalid' ||
    state === 'cancelled'
  );
}

/** Distributive Omit so the run-log discriminated union keeps its per-variant fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RunLogEntryInput = DistributiveOmit<RunLogEntry, 't'>;

interface NodeStateEntry {
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
  /** Reason the previous attempt failed, fed back into the retry prompt (failure-aware retry). */
  lastFailure?: string;
  approvalDeadline?: string;
}

// ---------------------------------------------------------------------------
// ActiveRun — a single run's state machine
// ---------------------------------------------------------------------------

class ActiveRun {
  private readonly state = new Map<string, NodeStateEntry>();
  private readonly sessionToNode = new Map<string, string>();
  private readonly outputs: Record<string, NodeOutput> = {};
  private edges: Map<string, Set<string>>;
  private readonly maxParallel: number;
  private inFlight = 0;
  private tokensUsed = 0;
  /** Last observed cumulative (input+output) tokens per child session — for delta accounting. */
  private readonly sessionTokens = new Map<string, number>();
  private runStatus: RunStatus = 'running';
  private unsubscribe?: () => void;
  /** Detaches the one-shot orchestrator-verdict listener while a run is `verifying`. */
  private verdictOff?: () => void;
  /** FAIL verdicts that have triggered a repair pass (bounded by `maxRepairs`). */
  private repairsUsed = 0;
  /** Malformed-verdict re-asks issued (bounded by MAX_UNPARSED_REASKS); not a repair. */
  private unparsedReAsks = 0;
  /** Resolved repair cap = min(spec.max_iterations ?? DEFAULT, CAP). */
  private readonly maxRepairs: number;
  /** Inverted edges: node id → set of nodes that (directly) depend on it. Built lazily for the frontier. */
  private dependents?: Map<string, Set<string>>;
  private settled = false;
  private settleResolvers: ((s: RunSnapshot) => void)[] = [];
  private readonly sourceVersion: 1 | 2;
  private tokenBudget: number | undefined;
  private instanceCount = 0;
  private stopRequested = false;
  private originalFailed = false;
  private readonly submittedOutputs = new Map<string, NodeOutput>();
  private verdictLocked = false;
  private readonly instances = new Map<string, NodeStateEntry>();
  private readonly instanceOutputs = new Map<string, NodeOutput>();
  private readonly mapItems = new Map<string, unknown[]>();
  private readonly loopIndex = new Map<string, number>();
  private readonly promptCache = new Map<string, NodeOutput>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private revision = 0;
  private readonly seenDecisionIds = new Set<string>();
  private invalidPatchCount = 0;
  private nextSeq = 1;
  private readonly approvalTimers = new Set<ReturnType<typeof setTimeout>>();
  private suppressSchedule = false;

  constructor(
    private spec: TaskSpec,
    private readonly slug: string,
    private readonly runId: string,
    private readonly opts: Required<Pick<RunOptions, 'verifyOnComplete'>> & RunOptions,
    private readonly deps: TaskRunnerDeps,
  ) {
    this.sourceVersion = opts.sourceVersion ?? (spec.schema_version === 2 ? 2 : 1);
    this.tokenBudget = spec.token_budget;
    this.edges = materializeDeps(spec);
    this.maxParallel = spec.max_parallel ?? deps.defaultMaxParallel ?? DEFAULT_MAX_PARALLEL;
    // Runner-side clamp (belt-and-suspenders: the schema already caps `max_iterations` at the same
    // bound, so a parsed spec can't exceed it — but a programmatically built spec might).
    this.maxRepairs = Math.min(spec.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP);
    for (const node of spec.nodes) this.state.set(node.id, { state: 'pending', attempt: 0 });
  }

  // --- lifecycle ---

  start(): void {
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    // Snapshot the spec for this run so the Results view labels nodes by run-time titles even after
    // the live task.yaml is edited. Best-effort: a snapshot failure must not abort the run.
    try {
      writeSpecRevision(this.deps.workspaceRoot, this.slug, this.runId, 0, this.spec);
    } catch {
      // ignore — Results falls back to run-log node ids when no snapshot exists
    }
    this.log({ kind: 'run-started', taskId: this.spec.id, runId: this.runId, orchestratorSessionId: this.opts.orchestratorSessionId });
    this.runStatus = 'running';
    // v1 unsaved files keep skip semantics. v2 never silent-skips unimplemented kinds
    // (those runs are refused before start()).
    for (const node of this.spec.nodes) {
      if (this.sourceVersion === 1 && !isExecutableTaskNode(node)) {
        const st = this.state.get(node.id)!;
        st.state = 'skipped';
        this.log({ kind: 'node-finished', nodeId: node.id, sessionId: '', state: 'skipped' });
      }
    }
    if (this.opts.orchestratorSessionId) {
      this.applyCard(this.opts.orchestratorSessionId, RUNNING_STATUS);
      // Publish the executable node count so deferred kinds don't inflate the board.
      const executableCount = this.spec.nodes.filter(isExecutableTaskNode).length;
      void this.deps.host.setTaskNodeCount(this.opts.orchestratorSessionId, executableCount);
    }
    this.coordinatorCheckpoint('first-schedule');
    this.scheduleReady();
    this.emitChanged();
  }

  pause(): RunSnapshot {
    if (this.runStatus === 'pausing' || this.runStatus === 'paused') return this.snapshot();
    if (this.isTerminal() || this.runStatus === 'interrupted') {
      throw new TaskControlError(this.runStatus, `Cannot pause a ${this.runStatus} run`);
    }
    if (this.inFlight === 0) {
      this.runStatus = 'paused';
      this.log({ kind: 'run-paused' });
    } else {
      this.runStatus = 'pausing';
      this.log({ kind: 'run-pausing' });
    }
    this.emitChanged();
    return this.snapshot();
  }

  resume(): RunSnapshot {
    if (this.runStatus === 'running') return this.snapshot();
    if (this.runStatus !== 'paused' && this.runStatus !== 'pausing') {
      throw new TaskControlError(this.runStatus, `Cannot resume a ${this.runStatus} run; use continue after interrupt`);
    }
    this.assertSensitiveReady();
    // Cancelled nodes return to pending so they re-dispatch. Nodes that exhausted their `retry`
    // budget stay 'failed' — automatic retry happens in failNode within the run, not on resume.
    for (const [, st] of this.state) if (st.state === 'cancelled') st.state = 'pending';
    this.runStatus = 'running';
    this.log({ kind: 'run-resumed' });
    this.scheduleReady();
    this.emitChanged();
    return this.snapshot();
  }

  continueAfterInterrupt(): RunSnapshot {
    if (this.runStatus === 'running') return this.snapshot();
    if (this.runStatus !== 'interrupted') {
      throw new TaskControlError(this.runStatus, `Cannot continue a ${this.runStatus} run`);
    }
    this.assertSensitiveReady();
    for (const [, st] of this.state) {
      if (st.state === 'interrupted' || st.state === 'cancelled') st.state = 'pending';
    }
    this.runStatus = 'running';
    this.log({ kind: 'run-resumed' });
    this.scheduleReady();
    this.emitChanged();
    return this.snapshot();
  }

  restoreCheckpoint(
    checkpoint: {
      seq: number;
      revision: number;
      tokensUsed: number;
      tokenBudget?: number;
      seenDecisionIds: string[];
      invalidPatchCount: number;
    } | null,
    revisionFallback: number,
  ): void {
    this.revision = checkpoint?.revision ?? revisionFallback;
    if (!checkpoint) return;
    this.nextSeq = checkpoint.seq + 1;
    this.tokensUsed = checkpoint.tokensUsed;
    if (checkpoint.tokenBudget !== undefined) this.tokenBudget = checkpoint.tokenBudget;
    this.invalidPatchCount = checkpoint.invalidPatchCount;
    for (const id of checkpoint.seenDecisionIds) this.seenDecisionIds.add(id);
  }

  /**
   * Rebuild run state from a persisted run-log. Done nodes reuse recorded output.
   * `mode: 'scan'` marks leftover running nodes interrupted and does not schedule.
   * `mode: 'hydrate'` restores the durable run status (paused / waiting-*) as-is.
   */
  hydrate(
    log: RunLogEntry[],
    loadOutput: (nodeId: string) => NodeOutput | null,
    mode: 'scan' | 'hydrate' = 'hydrate',
  ): void {
    this.suppressSchedule = true;
    for (const e of log) {
      const entrySeq = (e as RunLogEntry & { seq?: number }).seq;
      if (typeof entrySeq === 'number') this.nextSeq = Math.max(this.nextSeq, entrySeq + 1);
      if ('tokensUsed' in e && typeof e.tokensUsed === 'number') this.tokensUsed = e.tokensUsed;
      if (e.kind === 'node-spawned') {
        const st = this.state.get(e.nodeId) ?? this.ensureInstanceState(e.nodeId);
        if (st) {
          st.sessionId = e.sessionId;
          this.sessionToNode.set(e.sessionId, e.nodeId);
        }
      } else if (e.kind === 'node-scheduled') {
        const st = this.state.get(e.nodeId) ?? this.ensureInstanceState(e.nodeId);
        if (st) {
          st.attempt += 1;
          if (st.state === 'pending' || st.state === 'ready' || st.state === 'retry-wait') st.state = 'running';
        }
      } else if (e.kind === 'node-finished') {
        const st = this.state.get(e.nodeId) ?? this.ensureInstanceState(e.nodeId);
        if (st) st.state = e.state;
      } else if (e.kind === 'node-waiting-approval') {
        const st = this.state.get(e.nodeId);
        if (st) {
          st.state = 'waiting-approval';
          st.approvalDeadline = e.deadline;
        }
      } else if (e.kind === 'verdict') {
        if (e.result === 'fail') this.repairsUsed += 1;
        else if (e.result === 'unparsed') this.unparsedReAsks += 1;
        else if (e.result === 'pass') this.unparsedReAsks = 0;
      }
    }
    this.runStatus = deriveRunStatusFromLog(log);
    for (const [nodeId, st] of this.state) {
      if (st.state === 'done') {
        const out = loadOutput(nodeId);
        if (out) this.outputs[nodeId] = out;
        else st.state = 'pending';
      } else if (st.state === 'running' || st.state === 'retry-wait') {
        if (mode === 'scan' && this.runStatus !== 'paused' && this.runStatus !== 'pausing') {
          st.state = 'interrupted';
          this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId ?? '', state: 'interrupted', reason: 'startup-scan' });
        } else {
          // Paused hydrate: leftover in-flight nodes re-dispatch on resume.
          st.state = 'pending';
        }
      }
    }
    this.inFlight = 0;
    this.restoreExpansionState(loadOutput);
    if (mode === 'scan' && !this.isTerminal() && this.runStatus !== 'paused' && this.runStatus !== 'waiting-approval' && this.runStatus !== 'waiting-budget') {
      this.runStatus = 'interrupted';
      this.log({ kind: 'run-interrupted' });
    }
    if (this.runStatus === 'pausing') this.runStatus = 'paused';
    this.expireApprovals(this.deps.now?.());
    this.suppressSchedule = false;
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    this.emitChanged();
  }

  private ensureInstanceState(nodeId: string): NodeStateEntry | undefined {
    if (!nodeId.includes('#')) return undefined;
    let st = this.instances.get(nodeId);
    if (!st) {
      st = { state: 'pending', attempt: 0 };
      this.instances.set(nodeId, st);
      this.instanceCount += 1;
    }
    return st;
  }

  private restoreExpansionState(loadOutput: (nodeId: string) => NodeOutput | null): void {
    for (const node of this.spec.nodes) {
      if (node.kind === 'map' && this.state.get(node.id)?.state === 'running') {
        try {
          this.mapItems.set(node.id, parseForEach(this.resolveForEach(node)));
        } catch {
          this.mapItems.set(node.id, []);
        }
      }
      if (node.kind === 'loop') {
        let maxIdx = -1;
        for (const iid of this.instances.keys()) {
          if (definitionId(iid) !== node.id) continue;
          const idx = Number(iid.slice(node.id.length + 1));
          if (Number.isInteger(idx)) maxIdx = Math.max(maxIdx, idx);
          const out = loadOutput(iid);
          if (out) this.instanceOutputs.set(iid, out);
        }
        if (maxIdx >= 0) this.loopIndex.set(node.id, maxIdx + (this.instances.get(instanceId(node.id, maxIdx))?.state === 'done' ? 1 : 0));
      }
    }
  }

  async stop(): Promise<RunSnapshot> {
    if (this.isTerminal()) return this.snapshot();
    this.stopRequested = true;
    for (const [nodeId, st] of [...this.state, ...this.instances]) {
      if (st.state === 'running' || st.state === 'interrupted') {
        st.state = 'cancelled';
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId ?? '', state: 'cancelled', reason: 'stopped' });
        if (st.sessionId) {
          void this.deps.host.cancelProcessing(st.sessionId, true);
          this.applyCard(st.sessionId, TODO_STATUS);
        }
      }
    }
    for (const [sessionId, nodeId] of this.sessionToNode) {
      if (this.instances.get(nodeId)?.state === 'cancelled') {
        void this.deps.host.cancelProcessing(sessionId, true);
        this.applyCard(sessionId, TODO_STATUS);
      }
    }
    const hasFinally =
      this.sourceVersion === 2 && this.spec.nodes.some((n) => n.kind === 'finally' && this.isFinallyReady(n));
    if (hasFinally) {
      this.runStatus = 'running';
      this.scheduleReady();
      return this.snapshot();
    }
    this.finish('stopped');
    return this.snapshot();
  }

  waitUntilSettled(): Promise<RunSnapshot> {
    if (this.settled) return Promise.resolve(this.snapshot());
    return new Promise((resolve) => this.settleResolvers.push(resolve));
  }

  snapshot(): RunSnapshot {
    const blockers = [...this.state.entries()]
      .filter(([, st]) => st.state === 'waiting-approval' || st.state === 'interrupted')
      .map(([id]) => id);
    if (this.isOverBudget() && this.hasPendingNodes()) blockers.push('budget');
    return {
      slug: this.slug,
      runId: this.runId,
      taskId: this.spec.id,
      status: this.runStatus,
      orchestratorSessionId: this.opts.orchestratorSessionId,
      tokensUsed: this.tokensUsed,
      blockers: blockers.length ? blockers : undefined,
      revision: this.revision,
      nodes: this.spec.nodes.map((n) => {
        const st = this.state.get(n.id)!;
        return { id: n.id, state: st.state, sessionId: st.sessionId, attempt: st.attempt };
      }),
    };
  }

  // --- scheduling ---

  private scheduleReady(): void {
    if (this.suppressSchedule) return;
    if (this.runStatus === 'pausing') {
      if (this.inFlight === 0) {
        this.runStatus = 'paused';
        this.log({ kind: 'run-paused' });
        this.emitChanged();
      }
      return;
    }
    if (this.runStatus !== 'running') return;
    // Resume/hydrate of a v1 run can leave deferred kinds pending; never dispatch them as sessions.
    if (this.sourceVersion === 1) {
      for (const node of this.spec.nodes) {
        if (isExecutableTaskNode(node)) continue;
        const st = this.state.get(node.id)!;
        if (st.state !== 'pending') continue;
        st.state = 'skipped';
        this.log({ kind: 'node-finished', nodeId: node.id, sessionId: '', state: 'skipped' });
      }
    }
    for (const node of this.spec.nodes) {
      if (this.inFlight >= this.maxParallel && isSessionLikeKind(node.kind)) break;
      if (!this.isReady(node)) continue;
      if (node.kind !== 'filter' && !this.whenAllows(node)) {
        this.skipNode(node.id, 'when');
        continue;
      }
      if (this.isOverBudget() && isSessionLikeKind(node.kind)) {
        this.pauseForBudget();
        return;
      }
      if (this.instanceCount >= MAX_RUN_INSTANCES) {
        this.originalFailed = true;
        this.finish('failed');
        return;
      }
      this.dispatchByKind(node);
    }
    this.maybePromoteWaiting();
    this.maybeFinish();
  }

  private isReady(node: TaskNode): boolean {
    if (this.state.get(node.id)!.state !== 'pending') return false;
    if (this.sourceVersion === 2 && node.kind === 'finally') return this.isFinallyReady(node);
    for (const dep of this.edges.get(node.id) ?? []) {
      const depState = this.state.get(dep)?.state;
      if (depState !== 'done' && depState !== 'skipped') return false;
    }
    return true;
  }

  private isFinallyReady(node: TaskNode): boolean {
    const explicit = [...(this.edges.get(node.id) ?? [])];
    const watched =
      explicit.length > 0
        ? explicit
        : this.spec.nodes.filter((n) => n.kind !== 'finally' && n.id !== node.id).map((n) => n.id);
    return watched.every((id) => isTerminalNodeState(this.state.get(id)?.state));
  }

  private markRunning(node: TaskNode): void {
    const st = this.state.get(node.id)!;
    st.state = 'running';
    st.attempt += 1;
    this.inFlight += 1;
    this.instanceCount += 1;
    this.log({ kind: 'node-scheduled', nodeId: node.id });
  }

  private dispatchByKind(node: TaskNode): void {
    if (this.sourceVersion === 2 && isControlKind(node.kind)) {
      this.instanceCount += 1;
      if (node.kind === 'route') this.executeRoute(node);
      else this.completeControlNode(node.id, 'parallel');
      return;
    }
    if (this.sourceVersion === 2 && node.kind === 'approval') {
      this.instanceCount += 1;
      this.enterApproval(node);
      return;
    }
    if (this.sourceVersion === 2 && node.kind === 'map') {
      this.executeMap(node);
      return;
    }
    if (this.sourceVersion === 2 && node.kind === 'loop') {
      this.executeLoop(node);
      return;
    }
    if (this.sourceVersion === 2 && node.kind === 'filter') {
      this.instanceCount += 1;
      this.executeFilter(node);
      return;
    }
    if (this.sourceVersion === 2 && node.kind === 'aggregate') {
      this.instanceCount += 1;
      this.executeAggregate(node);
      return;
    }
    const cached = this.cachedOutput(node);
    if (cached) {
      this.instanceCount += 1;
      this.completeControlNode(node.id, cached.text, cached.params);
      return;
    }
    this.markRunning(node);
    void this.dispatch(node);
  }

  private skipNode(nodeId: string, reason: string): void {
    const st = this.state.get(nodeId);
    if (!st || st.state === 'skipped') return;
    st.state = 'skipped';
    this.log({ kind: 'node-finished', nodeId, sessionId: '', state: 'skipped', reason });
  }

  private completeControlNode(nodeId: string, text: string, values?: Record<string, unknown>): void {
    const st = this.state.get(nodeId)!;
    st.state = 'done';
    const output: NodeOutput = { text, ...(values ? { params: values } : {}) };
    this.outputs[nodeId] = output;
    writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, nodeId, output);
    this.log({ kind: 'node-finished', nodeId, sessionId: '', state: 'done' });
    this.emitChanged();
  }

  private executeRoute(node: TaskNode): void {
    const selected = this.selectRouteTarget(node);
    this.completeControlNode(node.id, selected, { selected });
    if (!node.route) return;
    const targets = new Set([...node.route.cases.map((c) => c.goto), node.route.default]);
    for (const target of targets) {
      if (target === selected) continue;
      if (this.spec.nodes.some((n) => n.id === target)) this.skipNode(target, 'route');
    }
  }

  private selectRouteTarget(node: TaskNode): string {
    if (!node.route) return node.id;
    for (const c of node.route.cases) {
      if (this.evalWhen(c.when)) return c.goto;
    }
    return node.route.default;
  }

  private executeMap(node: TaskNode): void {
    const items = parseForEach(this.resolveForEach(node));
    if (this.instanceCount + Math.max(items.length, 1) > MAX_RUN_INSTANCES) {
      this.originalFailed = true;
      this.finish('failed');
      return;
    }
    const st = this.state.get(node.id)!;
    st.state = 'running';
    st.attempt += 1;
    this.log({ kind: 'node-scheduled', nodeId: node.id });
    this.mapItems.set(node.id, items);
    if (items.length === 0) {
      this.completeControlNode(node.id, '[]', { items: [] });
      return;
    }
    this.scheduleMapInstances(node);
  }

  private scheduleMapInstances(node: TaskNode): void {
    const items = this.mapItems.get(node.id) ?? [];
    const parallel = node.max_parallel ?? this.maxParallel;
    let running = 0;
    for (let i = 0; i < items.length; i++) {
      const iid = instanceId(node.id, i);
      if (this.instances.get(iid)?.state === 'running') running += 1;
    }
    for (let i = 0; i < items.length; i++) {
      if (running >= parallel) break;
      const iid = instanceId(node.id, i);
      const existing = this.instances.get(iid);
      if (existing && existing.state !== 'pending') continue;
      if (this.instanceCount >= MAX_RUN_INSTANCES) {
        this.originalFailed = true;
        this.finish('failed');
        return;
      }
      if (existing) {
        existing.state = 'running';
        existing.attempt += 1;
        existing.sessionId = undefined;
      } else {
        this.instances.set(iid, { state: 'running', attempt: 1 });
      }
      this.instanceCount += 1;
      this.inFlight += 1;
      this.log({ kind: 'node-scheduled', nodeId: iid });
      void this.dispatch(node, { id: iid, item: items[i], index: i });
      running += 1;
    }
  }

  private finishMap(node: TaskNode): void {
    const items = this.mapItems.get(node.id) ?? [];
    const ordered: unknown[] = [];
    const texts: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const iid = instanceId(node.id, i);
      const out = this.instanceOutputs.get(iid);
      const st = this.instances.get(iid);
      if (st && (st.state === 'failed' || st.state === 'invalid')) {
        this.failNode(node.id, `map instance ${iid} ${st.state}`);
        return;
      }
      texts.push(out?.text ?? '');
      ordered.push(out?.params?.item ?? out?.text ?? '');
    }
    this.completeControlNode(node.id, texts.join('\n'), { items: ordered });
  }

  private executeLoop(node: TaskNode): void {
    if (!node.loop) {
      this.failNode(node.id, 'loop.max is required');
      return;
    }
    const st = this.state.get(node.id)!;
    if (st.state === 'pending') {
      st.state = 'running';
      st.attempt += 1;
      this.log({ kind: 'node-scheduled', nodeId: node.id });
      this.loopIndex.set(node.id, 0);
    }
    this.startLoopIteration(node);
  }

  private startLoopIteration(node: TaskNode): void {
    const index = this.loopIndex.get(node.id) ?? 0;
    const max = node.loop?.max ?? 0;
    if (index >= max) {
      this.exhaustLoop(node);
      return;
    }
    if (this.instanceCount >= MAX_RUN_INSTANCES) {
      this.originalFailed = true;
      this.finish('failed');
      return;
    }
    const iid = instanceId(node.id, index);
    const prev = index > 0 ? this.instanceOutputs.get(instanceId(node.id, index - 1))?.text : undefined;
    this.instances.set(iid, { state: 'running', attempt: 1 });
    this.instanceCount += 1;
    this.inFlight += 1;
    this.log({ kind: 'node-scheduled', nodeId: iid });
    void this.dispatch(node, { id: iid, index, prev });
  }

  private afterLoopInstance(node: TaskNode, instanceKey: string, output: NodeOutput): void {
    this.instanceOutputs.set(instanceKey, output);
    writeNodeAttempt(this.deps.workspaceRoot, this.slug, this.runId, instanceKey, 1, output);
    const until = node.loop?.until;
    if (
      until &&
      this.evalWhen(until, {
        item: output.text,
        index: this.loopIndex.get(node.id) ?? 0,
        prev: output.text,
        nodes: {
          ...((this.conditionCtx().nodes as Record<string, unknown> | undefined) ?? {}),
          [node.id]: { output: output.text },
        },
      })
    ) {
      this.completeControlNode(node.id, output.text, { iterations: (this.loopIndex.get(node.id) ?? 0) + 1 });
      return;
    }
    this.loopIndex.set(node.id, (this.loopIndex.get(node.id) ?? 0) + 1);
    this.startLoopIteration(node);
  }

  private exhaustLoop(node: TaskNode): void {
    const elseId = node.loop?.else;
    if (elseId) {
      this.completeControlNode(node.id, 'exhausted', { exhausted: true, else: elseId });
      for (const [id, deps] of this.edges) {
        if (id !== elseId && deps.has(node.id)) this.skipNode(id, 'loop-else');
      }
      return;
    }
    this.failNode(node.id, 'loop-exhausted');
  }

  private executeFilter(node: TaskNode): void {
    const items = parseForEach(this.resolveForEach(node));
    const kept = items.filter((item, index) => {
      if (!node.when) return true;
      return this.evalWhen(node.when, { item, index });
    });
    this.completeControlNode(node.id, JSON.stringify(kept), { items: kept });
  }

  private executeAggregate(node: TaskNode): void {
    const deps = [...(this.edges.get(node.id) ?? [])];
    const texts = deps.map((id) => this.outputs[id]?.text ?? '');
    if (node.aggregate === 'majority' || node.aggregate === 'vote') {
      const counts = new Map<string, number>();
      for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
      let winner = texts[0] ?? '';
      let best = 0;
      for (const [t, n] of counts) if (n > best) {
        winner = t;
        best = n;
      }
      this.completeControlNode(node.id, winner, { votes: Object.fromEntries(counts) });
      return;
    }
    this.completeControlNode(node.id, texts.join('\n'), { items: texts });
  }

  private resolveForEach(node: TaskNode): string {
    const expr = node.for_each;
    if (expr) {
      return interpolateRefs(expr, { nodeOutputs: this.outputs, params: this.opts.params });
    }
    const firstDep = [...(this.edges.get(node.id) ?? [])][0];
    return firstDep ? (this.outputs[firstDep]?.text ?? '') : '';
  }

  private cachedOutput(node: TaskNode): NodeOutput | undefined {
    if (node.cache !== 'pure') return undefined;
    const key = this.cacheKey(node);
    return this.promptCache.get(key);
  }

  private cacheKey(node: TaskNode, locals?: { item?: unknown; index?: number; prev?: string }): string {
    const prompt = interpolateLocals(
      interpolateRefs(node.prompt ?? '', { nodeOutputs: this.outputs, params: this.opts.params }),
      locals ?? {},
    );
    return createHash('sha256').update(`${node.id}\n${prompt}`).digest('hex');
  }

  private rememberCache(node: TaskNode, output: NodeOutput, locals?: { item?: unknown; index?: number; prev?: string }): void {
    if (node.cache === 'pure') this.promptCache.set(this.cacheKey(node, locals), output);
  }

  private assertSensitiveReady(): void {
    const missing = missingSensitive(this.opts.params, sensitiveParamNames(this.spec.params));
    if (missing.length) {
      throw new TaskControlError(this.runStatus, `Sensitive params must be re-entered: ${missing.join(', ')}`);
    }
  }

  private enterApproval(node: TaskNode): void {
    const st = this.state.get(node.id)!;
    st.state = 'waiting-approval';
    if (node.timeout && node.timeout > 0) {
      const nowMs = this.deps.now ? Date.parse(this.deps.now()) : Date.now();
      const deadline = new Date(nowMs + node.timeout * 1000).toISOString();
      st.approvalDeadline = deadline;
      this.log({ kind: 'node-waiting-approval', nodeId: node.id, deadline });
      if (!this.deps.now) {
        const timer = setTimeout(() => {
          this.approvalTimers.delete(timer);
          this.expireApprovals();
        }, node.timeout * 1000);
        this.approvalTimers.add(timer);
      }
    } else {
      this.log({ kind: 'node-waiting-approval', nodeId: node.id });
    }
    this.emitChanged();
  }

  respondApproval(nodeId: string, approved: boolean): RunSnapshot {
    const st = this.state.get(nodeId);
    if (!st || st.state !== 'waiting-approval') {
      throw new TaskControlError(this.runStatus, `Node ${nodeId} is not waiting for approval`);
    }
    if (approved) {
      this.completeControlNode(nodeId, 'approved', { approved: true });
    } else {
      this.failNode(nodeId, 'approval-rejected', st.sessionId, 'error');
    }
    if (this.runStatus === 'waiting-approval') this.runStatus = 'running';
    this.coordinatorCheckpoint('approval');
    this.scheduleReady();
    this.emitChanged();
    return this.snapshot();
  }

  acceptOutput(sessionId: string, payload: { text?: string; values?: Record<string, unknown> }): { ok: true } | { ok: false; error: string } {
    const nodeId = this.sessionToNode.get(sessionId);
    if (!nodeId) return { ok: false, error: 'Session is not a node in this run' };
    const node = this.spec.nodes.find((n) => n.id === nodeId || n.id === definitionId(nodeId));
    if (!node) return { ok: false, error: 'Unknown node' };
    const declared = node.outputs ?? [];
    const values = { ...(payload.values ?? {}) };
    if (declared.length) {
      for (const decl of declared) {
        if (decl.required !== false && !(decl.name in values)) {
          return { ok: false, error: `Missing required output "${decl.name}"` };
        }
        if (decl.kind === 'artifact' && values[decl.name] != null) {
          const resolved = resolveArtifact(this.deps.workspaceRoot, this.spec.cwd, String(values[decl.name]));
          if (!resolved.ok) return { ok: false, error: resolved.error };
          values[decl.name] = resolved.artifact;
        }
      }
    }
    this.submittedOutputs.set(nodeId, { text: payload.text ?? '', params: values });
    return { ok: true };
  }

  submitStructuredVerdict(payload: { result: 'pass' | 'fail'; reason?: string; nodes?: string[] }): RunSnapshot {
    if (this.runStatus !== 'verifying') {
      throw new TaskControlError(this.runStatus, 'Run is not waiting for a verdict');
    }
    this.handleVerdictObject({ result: payload.result, reason: payload.reason, nodes: payload.nodes });
    return this.snapshot();
  }

  updateLimits(tokenBudget?: number, params?: Record<string, unknown>): RunSnapshot {
    if (tokenBudget !== undefined) this.tokenBudget = tokenBudget;
    if (params) this.opts.params = { ...this.opts.params, ...params };
    if (this.runStatus === 'waiting-budget') {
      this.runStatus = 'running';
      this.log({ kind: 'run-resumed' });
      this.scheduleReady();
    }
    this.emitChanged();
    return this.snapshot();
  }

  hasSession(sessionId: string): boolean {
    return this.sessionToNode.has(sessionId) || this.opts.orchestratorSessionId === sessionId;
  }

  expireApprovals(nowIso?: string): void {
    const now = nowIso ? Date.parse(nowIso) : Date.now();
    for (const [id, st] of this.state) {
      if (st.state !== 'waiting-approval' || !st.approvalDeadline) continue;
      if (Date.parse(st.approvalDeadline) > now) continue;
      if (this.runStatus === 'waiting-approval') this.runStatus = 'running';
      this.failNode(id, 'approval-timeout', st.sessionId, 'error');
    }
  }

  private whenAllows(node: TaskNode): boolean {
    if (!node.when) return true;
    return this.evalWhen(node.when);
  }

  private evalWhen(when: string | ConditionAst, extra?: Record<string, unknown>): boolean {
    const cond = typeof when === 'string' ? conditionFromLegacyWhen(when) : when;
    return evaluateCondition(cond, { ...this.conditionCtx(), ...extra });
  }

  private conditionCtx(): Record<string, unknown> {
    const nodes: Record<string, unknown> = {};
    for (const [id, out] of Object.entries(this.outputs)) {
      nodes[id] = { output: out.text, ...(out.params ?? {}) };
    }
    return { params: this.opts.params ?? {}, nodes };
  }

  private maybePromoteWaiting(): void {
    if (this.runStatus !== 'running' || this.inFlight > 0) return;
    if (this.spec.nodes.some((n) => this.isReady(n) && this.whenAllows(n))) return;
    const approval = [...this.state.entries()].filter(([, st]) => st.state === 'waiting-approval').map(([id]) => id);
    if (approval.length) {
      this.runStatus = 'waiting-approval';
      this.log({ kind: 'run-waiting-approval' });
      this.coordinatorCheckpoint('approval');
      this.emitChanged();
      return;
    }
    if (this.isOverBudget() && this.hasPendingNodes()) {
      this.runStatus = 'waiting-budget';
      this.log({ kind: 'run-waiting-budget' });
      this.coordinatorCheckpoint('budget');
      this.emitChanged();
    }
  }

  private async dispatch(node: TaskNode, instance?: { id: string; item?: unknown; index?: number; prev?: string }): Promise<void> {
    try {
      // Task-level skills ride as [skill:slug] mentions on every child prompt — the agent
      // pipeline resolves each SKILL.md and blocks tools until it is read (skills-as-context).
      const prompt = skillsPreamble(this.spec.skills) + (await this.buildPrompt(node, instance));
      // Children run where the parent runs: inherit the orchestrator's resolved working directory,
      // falling back to the spec's declared `cwd`. Without this they default to the workspace cwd
      // rather than the parent session's (project) directory.
      const cwd =
        (this.opts.orchestratorSessionId
          ? this.deps.host.getSessionWorkingDirectory(this.opts.orchestratorSessionId)
          : undefined) ?? this.spec.cwd;
      const options: CreateSessionOptions = {
        parentSessionId: this.opts.orchestratorSessionId,
        // Link the child back to the task / run / node so the manual subtask composer can
        // tell Conductor-owned children apart from hand-authored subtasks (it skips the former).
        taskSlug: this.slug,
        taskRunId: this.runId,
        taskNodeId: definitionId(instance?.id ?? node.id),
        name: instance?.id ?? nodeTitle(node),
        model: node.model ?? this.spec.defaults?.model,
        // Required for non-default (e.g. pi/*) models to resolve a backend — without it the
        // child session completes instantly with no output.
        llmConnection: node.llmConnection ?? this.spec.defaults?.llmConnection,
        // Node override → task default (persisted by the editor, visible to the user) → explicit
        // unattended-safe fallback. Never the workspace default (which could be `ask` → hang).
        permissionMode: node.permissionMode ?? this.spec.defaults?.permissionMode ?? AUTONOMOUS_DEFAULT_MODE,
        labels: node.labels,
        // Inherit the orchestrator's task number (task::N) so the whole run filters as one task.
        applyTaskLabel: true,
        // Task-level sources become the child's enabled-sources set (spec omitted → workspace default).
        ...(this.spec.sources?.length ? { enabledSourceSlugs: this.spec.sources } : {}),
        projectId: this.spec.project,
        ...(cwd ? { workingDirectory: cwd } : {}),
        sessionStatus: RUNNING_STATUS,
      };
      // createSession announces the child to the renderer by default, so it nests under the task
      // tile with its real title instead of a fabricated "New Chat" (or never appearing).
      const child = await this.deps.host.createSession(this.deps.workspaceId, options);
      const key = instance?.id ?? node.id;
      const st = this.instances.get(key) ?? this.state.get(node.id)!;
      st.sessionId = child.id;
      this.sessionToNode.set(child.id, key);
      this.log({ kind: 'node-spawned', nodeId: key, sessionId: child.id });
      this.applyCard(child.id, RUNNING_STATUS);
      await this.deps.host.sendMessage(child.id, prompt);
    } catch (err) {
      this.failNode(instance?.id ?? node.id, `dispatch failed: ${(err as Error).message}`);
    }
  }

  /** Resolve a node's prompt: declared inputs (+ optional summarize) then ${…} interpolation. */
  private async buildPrompt(node: TaskNode, instance?: { id: string; item?: unknown; index?: number; prev?: string }): Promise<string> {
    const inputValues: Record<string, unknown> = {};
    for (const [name, ref] of Object.entries(node.inputs ?? {})) {
      const fromExpr = typeof ref === 'string' ? ref : ref.from;
      const summarize = typeof ref === 'string' ? false : !!ref.summarize;
      let resolved = interpolateRefs(fromExpr, { nodeOutputs: this.outputs, params: this.opts.params });
      if (summarize && this.deps.summarize) resolved = await this.deps.summarize(resolved);
      inputValues[name] = resolved;
    }
    let text = interpolateRefs(node.prompt ?? '', { nodeOutputs: this.outputs, params: this.opts.params });
    text = interpolateLocals(text, instance ?? {});
    text = text.replace(INPUTS_REF_RE, (raw, name: string) => (name in inputValues ? String(inputValues[name]) : raw));

    // Failure-aware retry: prepend the prior failure so a retried session knows what went wrong
    // instead of blindly repeating a deterministic failure.
    const st = (instance ? this.instances.get(instance.id) : undefined) ?? this.state.get(node.id)!;
    if (st.attempt > 1 && st.lastFailure) {
      text = `${st.lastFailure}\n\n${text}`;
    }
    return text;
  }

  // --- completion ---

  private onSessionComplete(evt: SessionCompletionEvent): void {
    const nodeId = this.sessionToNode.get(evt.sessionId);
    if (!nodeId) return; // not one of our child nodes
    const defId = definitionId(nodeId);
    const st = this.instances.get(nodeId) ?? this.state.get(defId);
    if (!st || st.state !== 'running') return; // already settled/cancelled

    if (evt.tokenUsage) {
      // `tokenUsage` is cumulative-per-session; add only the delta since this session's last
      // observed total so a node that ever runs >1 turn (future retry/loop) can't double-count.
      const cumulative = (evt.tokenUsage.inputTokens ?? 0) + (evt.tokenUsage.outputTokens ?? 0);
      const prev = this.sessionTokens.get(evt.sessionId) ?? 0;
      this.tokensUsed += Math.max(0, cumulative - prev);
      this.sessionTokens.set(evt.sessionId, cumulative);
    }

    // Completion-time budget check: pause immediately on breach (not only at schedule-time), but
    // only while pending work remains — never block a run that is about to finish.
    if (this.isOverBudget() && this.runStatus === 'running' && this.hasPendingNodes()) {
      this.pauseForBudget();
    }

    if (evt.reason === 'complete') {
      const text = evt.finalText ?? this.deps.host.getSessionFinalText(evt.sessionId) ?? '';
      const node = this.spec.nodes.find((n) => n.id === defId);
      const submitted = this.submittedOutputs.get(nodeId) ?? this.submittedOutputs.get(defId);
      const declared = node?.outputs?.length ?? 0;

      if (
        this.sourceVersion === 2 &&
        declared > 0 &&
        !submitted &&
        node &&
        (isSessionLikeKind(node.kind) || nodeId !== defId)
      ) {
        this.failNode(nodeId, 'completed without submit_task_output', evt.sessionId, 'invalid');
        return;
      }
      if (declared > 0 && !submitted && text.trim() === '') {
        this.failNode(nodeId, 'completed without producing declared output', evt.sessionId, 'empty');
        return;
      }

      const output: NodeOutput = submitted ?? { text };
      st.state = 'done';
      this.inFlight = Math.max(0, this.inFlight - 1);
      writeNodeAttempt(this.deps.workspaceRoot, this.slug, this.runId, nodeId, st.attempt || 1, output);
      this.log({ kind: 'node-finished', nodeId, sessionId: evt.sessionId, state: 'done' });
      this.applyCard(evt.sessionId, DONE_STATUS);
      if (node && (node.kind === 'map' || node.kind === 'loop')) {
        this.instanceOutputs.set(nodeId, output);
        if (node.kind === 'map') {
          const items = this.mapItems.get(defId) ?? [];
          const allDone = items.every((_, i) => isTerminalNodeState(this.instances.get(instanceId(defId, i))?.state));
          if (allDone) this.finishMap(node);
          else this.scheduleMapInstances(node);
        } else {
          this.afterLoopInstance(node, nodeId, output);
        }
        this.emitChanged();
        this.scheduleReady();
        return;
      }
      this.outputs[defId] = output;
      writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, defId, output);
      if (node) this.rememberCache(node, output);
      this.emitChanged();
      this.scheduleReady();
    } else if (evt.reason === 'interrupted') {
      // Externally aborted while running → cancelled (re-dispatched on resume). We do not
      // auto-retry here to avoid a stop/retry loop.
      st.state = 'cancelled';
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.log({ kind: 'node-finished', nodeId, sessionId: evt.sessionId, state: 'cancelled', reason: 'interrupted' });
      this.applyCard(evt.sessionId, TODO_STATUS);
      this.emitChanged();
      this.scheduleReady();
    } else {
      // 'error' | 'timeout'
      this.failNode(nodeId, evt.reason, evt.sessionId);
    }
  }

  private failNode(nodeId: string, reason: string, sessionId?: string, failure: 'error' | 'empty' | 'invalid' = 'error'): void {
    const defId = definitionId(nodeId);
    const st = this.state.get(defId);
    if (!st) return;
    const inst = this.instances.get(nodeId);
    const node = this.spec.nodes.find((n) => n.id === defId);
    if (inst && node?.kind === 'map') {
      this.failMapInstance(node, nodeId, inst, reason, sessionId, failure);
      return;
    }
    const expanding = this.mapItems.has(defId) || this.loopIndex.has(defId);
    if (inst?.state === 'running' || (st.state === 'running' && !expanding)) {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
    if (inst) inst.state = failure === 'invalid' ? 'invalid' : 'failed';

    const retry = node?.retry;
    if (retry && st.attempt <= retry.limit && retryMatches(retry.when, failure)) {
      st.lastFailure = `Previous attempt failed: ${reason}. Address the cause before retrying.`;
      const delay = retryBackoffMs(retry, st.attempt);
      const sid = sessionId ?? st.sessionId;
      if (sid) this.applyCard(sid, TODO_STATUS);
      this.log({ kind: 'node-retry', nodeId: defId, attempt: st.attempt, reason });
      if (delay > 0) {
        st.state = 'retry-wait';
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          if (st.state === 'retry-wait') {
            st.state = 'pending';
            this.scheduleReady();
          }
        }, delay);
        this.retryTimers.add(timer);
      } else {
        st.state = 'pending';
        this.scheduleReady();
      }
      this.emitChanged();
      return;
    }

    st.state = failure === 'invalid' ? 'invalid' : 'failed';
    if (node?.kind !== 'finally') this.originalFailed = true;
    const sid = sessionId ?? st.sessionId;
    this.log({ kind: 'node-finished', nodeId: defId, sessionId: sid ?? '', state: st.state, reason });
    if (sid) this.applyCard(sid, FAILED_STATUS);
    this.emitChanged();
    this.coordinatorCheckpoint('node-failed');
    this.scheduleReady();
  }

  private failMapInstance(
    node: TaskNode,
    instanceKey: string,
    inst: NodeStateEntry,
    reason: string,
    sessionId: string | undefined,
    failure: 'error' | 'empty' | 'invalid',
  ): void {
    if (inst.state === 'running') this.inFlight = Math.max(0, this.inFlight - 1);
    const failedState = failure === 'invalid' ? 'invalid' : 'failed';
    const retry = node.retry;
    const sid = sessionId ?? inst.sessionId;

    if (retry && inst.attempt <= retry.limit && retryMatches(retry.when, failure)) {
      inst.lastFailure = `Previous attempt failed: ${reason}. Address the cause before retrying.`;
      this.submittedOutputs.delete(instanceKey);
      this.instanceOutputs.delete(instanceKey);
      const delay = retryBackoffMs(retry, inst.attempt);
      if (sid) this.applyCard(sid, TODO_STATUS);
      this.log({ kind: 'node-retry', nodeId: instanceKey, attempt: inst.attempt, reason });
      if (delay > 0) {
        inst.state = 'retry-wait';
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          if (inst.state === 'retry-wait') {
            inst.state = 'pending';
            this.scheduleMapInstances(node);
            this.emitChanged();
          }
        }, delay);
        this.retryTimers.add(timer);
      } else {
        inst.state = 'pending';
      }
      this.scheduleMapInstances(node);
      this.emitChanged();
      return;
    }

    inst.state = failedState;
    this.log({ kind: 'node-finished', nodeId: instanceKey, sessionId: sid ?? '', state: failedState, reason });
    if (sid) this.applyCard(sid, FAILED_STATUS);
    const items = this.mapItems.get(node.id) ?? [];
    const allDone = items.every((_, i) => isTerminalNodeState(this.instances.get(instanceId(node.id, i))?.state));
    if (allDone) this.finishMap(node);
    else this.scheduleMapInstances(node);
    this.emitChanged();
    this.scheduleReady();
  }

  private maybeFinish(): void {
    if (this.runStatus !== 'running' && !this.stopRequested) return;
    if (this.inFlight > 0) return;
    if (this.spec.nodes.some((n) => this.isReady(n))) return;
    if ([...this.state.values()].some((st) => st.state === 'waiting-approval')) return;

    if (this.stopRequested) {
      this.finish('stopped');
      return;
    }

    const allGood = this.spec.nodes.every((n) => {
      const s = this.state.get(n.id)!.state;
      return s === 'done' || s === 'skipped';
    });
    if (!allGood || this.originalFailed) {
      this.finish('failed');
      return;
    }
    if (this.opts.verifyOnComplete && this.opts.orchestratorSessionId) {
      this.enterVerifying();
    } else {
      this.finish('completed');
    }
  }

  /** Enter the non-terminal `verifying` state and ask the orchestrator for a verdict. Does NOT finalize. */
  private enterVerifying(): void {
    this.verdictLocked = false;
    this.coordinatorCheckpoint('before-verify');
    this.runStatus = 'verifying';
    this.log({ kind: 'run-verifying' });
    void this.sendVerification();
  }

  private finish(status: RunStatus): void {
    this.runStatus = status;
    const kind =
      status === 'completed' ? 'run-completed' : status === 'stopped' ? 'run-stopped' : 'run-failed';
    this.log({ kind, tokensUsed: this.tokensUsed });
    // Top-level card stays open: success and failure both go to needs-review. Only the
    // user can close the tile. Column moves only when dropStatusId matches.
    if (this.opts.orchestratorSessionId) this.applyCard(this.opts.orchestratorSessionId, REVIEW_STATUS);
    this.emitChanged();
    this.finalize();
  }

  private finalize(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.verdictOff?.();
    this.verdictOff = undefined;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    for (const timer of this.approvalTimers) clearTimeout(timer);
    this.approvalTimers.clear();
    if (this.settled) return;
    this.settled = true;
    const snap = this.snapshot();
    for (const resolve of this.settleResolvers) resolve(snap);
    this.settleResolvers = [];
  }

  private async sendVerification(): Promise<void> {
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) {
      this.finish('completed');
      return;
    }
    if (this.sourceVersion === 1) this.attachVerdictListener(orchestrator);
    const sections = this.spec.nodes.map((n) => {
      const out = this.outputs[n.id];
      return `### ${nodeTitle(n)} (${n.id})\n${out ? out.text : '(no output)'}`;
    });
    const rubric = this.spec.acceptance_criteria
      ? `Acceptance criteria:\n${this.spec.acceptance_criteria}`
      : `Goal: ${this.spec.goal}`;
    const message = [
      `The task "${this.spec.title}" has finished running.`,
      '',
      rubric,
      '',
      'Node outputs:',
      ...sections,
      '',
      'Verify the final result against the criteria above and summarize the outcome.',
      this.sourceVersion === 2
        ? 'Call submit_task_verdict with result pass or fail. Parent chat messages are not verdicts.'
        : [
            'End your reply with a verdict line, on its own line, in exactly one of these forms:',
            'VERDICT: PASS',
            'VERDICT: FAIL — <one-line reason>',
            'If only some subtasks need redoing, name them so only those (and their dependents) re-run:',
            'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
          ].join('\n'),
    ].join('\n');
    await this.sendToOrchestrator(orchestrator, message);
  }

  /**
   * Attach the one-shot orchestrator-verdict listener (separate from the run's main subscription).
   * It catches the orchestrator's next completion, detaches itself, and routes the text to handleVerdict.
   */
  private attachVerdictListener(orchestrator: string): void {
    this.verdictOff?.();
    this.verdictOff = this.deps.host.onSessionComplete((evt) => {
      if (evt.sessionId !== orchestrator) return;
      this.verdictOff?.();
      this.verdictOff = undefined;
      const text = evt.finalText ?? this.deps.host.getSessionFinalText(orchestrator) ?? '';
      this.handleVerdict(text);
    });
  }

  /** Send to the orchestrator, failing the run (rather than hanging in `verifying`) if the send rejects. */
  private async sendToOrchestrator(orchestrator: string, message: string): Promise<void> {
    try {
      await this.deps.host.sendMessage(orchestrator, message);
    } catch {
      // The verdict will never arrive — detach the listener and settle as failed instead of hanging.
      this.verdictOff?.();
      this.verdictOff = undefined;
      this.finish('failed');
    }
  }

  /**
   * Apply the orchestrator's parsed verdict:
   *   PASS      → completed.
   *   unparsed  → re-ask for a well-formed verdict (bounded; not a repair); exhausted → failed.
   *   FAIL      → repair the frontier if budget remains, else failed (iterations/token budget breach).
   */
  private handleVerdict(text: string): void {
    if (this.sourceVersion === 2) return;
    if (this.runStatus !== 'verifying') return;
    writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, '__verdict__', { text });
    this.handleVerdictObject(parseVerdict(text));
  }

  private handleVerdictObject(verdict: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }): void {
    if (this.runStatus !== 'verifying') return;
    if (this.verdictLocked) return;
    this.verdictLocked = true;
    this.log({ kind: 'verdict', result: verdict.result, reason: verdict.reason, nodes: verdict.nodes });

    if (verdict.result === 'pass') {
      this.unparsedReAsks = 0;
      this.finish('completed');
      return;
    }

    if (verdict.result === 'unparsed') {
      if (this.unparsedReAsks < MAX_UNPARSED_REASKS) {
        this.unparsedReAsks += 1;
        void this.reAskVerdict();
        return;
      }
      this.finish('failed');
      return;
    }

    if (this.repairsUsed >= this.maxRepairs) {
      this.log({ kind: 'budget-breach', metric: 'iterations', value: this.repairsUsed, limit: this.maxRepairs });
      this.finish('failed');
      return;
    }
    if (this.isOverBudget()) {
      this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.tokenBudget ?? this.spec.token_budget! });
      this.finish('failed');
      return;
    }
    this.repairsUsed += 1;
    this.runStatus = 'repairing';
    this.log({ kind: 'run-repairing' });
    this.repairForVerdict(verdict.reason, verdict.nodes);
  }

  /** Re-ask the orchestrator for a parseable verdict line (format-only; does not consume repair budget). */
  private async reAskVerdict(): Promise<void> {
    this.verdictLocked = false;
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) {
      this.finish('completed');
      return;
    }
    this.attachVerdictListener(orchestrator);
    const message = [
      'Your previous reply did not include a parseable verdict line.',
      'Reply with the verdict line only, on its own line, in exactly one of these forms:',
      'VERDICT: PASS',
      'VERDICT: FAIL — <one-line reason>',
      'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
    ].join('\n');
    await this.sendToOrchestrator(orchestrator, message);
  }

  /**
   * On a FAIL verdict, re-run the repair frontier with the rejection reason as failure context.
   * The frontier is the orchestrator-named nodes ∪ their transitive dependents (so a re-run upstream
   * node forces everything that consumes its output to re-run too). With no usable names it is the
   * whole DAG. Only `done` nodes are reset; scheduleReady re-dispatches from the satisfied sources.
   */
  private repairForVerdict(reason: string | undefined, named?: string[]): void {
    const detail = reason ?? 'the result did not meet the acceptance criteria';
    let reset = 0;
    for (const id of this.computeFrontier(named)) {
      const st = this.state.get(id);
      if (!st || st.state !== 'done') continue;
      st.state = 'pending';
      st.lastFailure = `The previous result was rejected on verification: ${detail}. Revise your output to meet the acceptance criteria.`;
      for (const iid of [...this.instances.keys()]) {
        if (definitionId(iid) === id && this.instances.get(iid)?.state !== 'cancelled') this.instances.delete(iid);
      }
      this.mapItems.delete(id);
      this.loopIndex.delete(id);
      this.log({ kind: 'node-retry', nodeId: id, attempt: st.attempt, reason: `verdict-fail: ${detail}` });
      reset += 1;
    }
    if (reset === 0) {
      // No `done` node in the frontier to re-run → don't hang the run.
      this.finish('failed');
      return;
    }
    this.runStatus = 'running';
    this.scheduleReady();
  }

  /**
   * The set of nodes a repair pass re-runs: the orchestrator-named nodes plus everything that
   * (transitively) depends on them. Unknown/empty names degrade to the whole DAG.
   */
  private computeFrontier(named?: string[]): Set<string> {
    const valid = (named ?? []).filter((id) => this.state.has(id));
    if (valid.length === 0) return new Set(this.spec.nodes.map((n) => n.id));
    const dependents = this.dependentsMap();
    const frontier = new Set<string>();
    const queue = [...valid];
    while (queue.length) {
      const id = queue.shift()!;
      if (frontier.has(id)) continue;
      frontier.add(id);
      for (const d of dependents.get(id) ?? []) if (!frontier.has(d)) queue.push(d);
    }
    return frontier;
  }

  /** Inverted `edges`: node id → set of nodes that directly depend on it (memoized). */
  private dependentsMap(): Map<string, Set<string>> {
    if (this.dependents) return this.dependents;
    const map = new Map<string, Set<string>>();
    for (const n of this.spec.nodes) map.set(n.id, new Set());
    for (const [node, upstreams] of this.edges) {
      for (const u of upstreams) map.get(u)?.add(node);
    }
    this.dependents = map;
    return map;
  }

  // --- budget ---

  private isOverBudget(): boolean {
    return this.tokenBudget !== undefined && this.tokensUsed >= this.tokenBudget;
  }

  private pauseForBudget(): void {
    this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.tokenBudget! });
    if (this.inFlight === 0) {
      this.runStatus = 'waiting-budget';
      this.log({ kind: 'run-waiting-budget' });
      this.coordinatorCheckpoint('budget');
      this.emitChanged();
    }
  }

  /** True if any node is still waiting to be dispatched (used to avoid pausing a finishable run). */
  private hasPendingNodes(): boolean {
    for (const st of this.state.values()) if (st.state === 'pending') return true;
    return false;
  }

  // --- helpers ---

  private isTerminal(): boolean {
    return this.runStatus === 'completed' || this.runStatus === 'failed' || this.runStatus === 'stopped';
  }

  private applyCard(sessionId: string, statusId: string): void {
    void this.deps.host.setSessionStatus(sessionId, statusId);
    void this.resolveAndMoveColumn(sessionId, statusId);
  }

  private async resolveAndMoveColumn(sessionId: string, statusId: string): Promise<void> {
    const column = this.deps.host.resolveKanbanColumn
      ? await this.deps.host.resolveKanbanColumn(sessionId, statusId)
      : resolveKanbanColumnId(statusId);
    if (column) void this.deps.host.setKanbanColumn(sessionId, column);
  }

  private emitChanged(): void {
    this.deps.onRunChanged?.(this.snapshot());
  }

  applyPatch(patch: OrchestrationPatch): RunSnapshot {
    const result = validateOrchestrationPatch(patch, {
      spec: this.spec,
      revision: this.revision,
      runId: this.runId,
      seenDecisionIds: this.seenDecisionIds,
      nodeStates: Object.fromEntries([...this.state.entries()].map(([id, st]) => [id, st.state])),
      invalidPatchCount: this.invalidPatchCount,
    });
    if (!result.ok) {
      this.invalidPatchCount += 1;
      if (result.pauseForReview) {
        this.runStatus = 'paused';
        this.log({ kind: 'run-paused' });
        this.emitChanged();
      }
      throw new TaskControlError(this.runStatus, result.error);
    }
    this.spec = result.spec;
    this.revision = result.revision;
    this.seenDecisionIds.add(patch.decisionId);
    this.invalidPatchCount = 0;
    this.edges = materializeDeps(this.spec);
    this.dependents = undefined;
    for (const n of this.spec.nodes) {
      if (!this.state.has(n.id)) this.state.set(n.id, { state: 'pending', attempt: 0 });
    }
    for (const id of result.cancelled) {
      const st = this.state.get(id);
      if (st) st.state = 'cancelled';
    }
    writeSpecRevision(this.deps.workspaceRoot, this.slug, this.runId, this.revision, this.spec);
    if (result.action === 'pause') {
      this.pause();
    } else if (result.action === 'complete') {
      this.finish('completed');
    } else if (result.action === 'fail') {
      this.finish('failed');
    } else if (this.runStatus === 'paused' || this.runStatus === 'pausing') {
      this.runStatus = 'running';
      this.scheduleReady();
    } else {
      this.scheduleReady();
    }
    this.emitChanged();
    return this.snapshot();
  }

  currentSpec(): TaskSpec {
    return this.spec;
  }

  private coordinatorCheckpoint(reason: string): void {
    if (!isTasksOrchestrateEnabled() || this.spec.runner !== 'orchestrate') return;
    if (reason === 'batch') return;
    const orch = this.opts.orchestratorSessionId;
    if (!orch) return;
    void this.sendToOrchestrator(
      orch,
      `Conductor checkpoint (${reason}). Revision ${this.revision}. Call submit_orchestration_patch or continue.`,
    );
  }

  private log(entry: RunLogEntryInput): void {
    const t = this.deps.now ? this.deps.now() : new Date().toISOString();
    const seq = this.nextSeq++;
    appendRunLog(this.deps.workspaceRoot, this.slug, this.runId, {
      ...entry,
      t,
      seq,
      revision: this.revision,
    });
    writeRunState(this.deps.workspaceRoot, this.slug, this.runId, {
      seq,
      revision: this.revision,
      tokensUsed: this.tokensUsed,
      tokenBudget: this.tokenBudget,
      seenDecisionIds: [...this.seenDecisionIds],
      invalidPatchCount: this.invalidPatchCount,
    });
    if (
      entry.kind === 'run-started' ||
      entry.kind === 'run-completed' ||
      entry.kind === 'run-failed' ||
      entry.kind === 'run-stopped' ||
      entry.kind === 'run-paused' ||
      entry.kind === 'run-resumed'
    ) {
      conductorLog.info(entry.kind, {
        slug: this.slug,
        runId: this.runId,
        revision: this.revision,
        status: this.runStatus,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// TaskRunner — registry/service over active runs
// ---------------------------------------------------------------------------

/**
 * Prefix for dispatched child prompts carrying the task's skill list as [skill:slug]
 * mentions. The agent pipeline (base-agent) parses these from any message, resolves each
 * skill's SKILL.md, and blocks tool use until the files are read — so task-level skills
 * act as mandatory context for every subtask. Empty/absent skills → empty prefix.
 */
function skillsPreamble(skills: string[] | undefined): string {
  if (!skills?.length) return '';
  return `Apply these skills: ${skills.map((s) => `[skill:${s}]`).join(' ')}\n\n`;
}

/**
 * Whether a node's `retry.when` trigger covers a given failure class. An absent `when`
 * defaults to retrying on `error` (the common "transient failure" case); `empty`/`invalid`
 * triggers are opt-in and not yet produced by the runner, so they never match here.
 */
function retryBackoffMs(
  retry: { backoff?: { base?: number; factor?: number; max?: number } },
  attempt: number,
): number {
  const base = retry.backoff?.base ?? 0;
  if (base <= 0) return 0;
  const factor = retry.backoff?.factor ?? 2;
  const max = retry.backoff?.max ?? base * 16;
  return Math.min(max, base * factor ** Math.max(0, attempt - 1));
}

function retryMatches(
  when: 'error' | 'empty' | 'invalid' | readonly string[] | undefined,
  failure: 'error' | 'empty' | 'invalid',
): boolean {
  const list = !when ? ['error'] : Array.isArray(when) ? when : [when];
  return list.includes(failure);
}

/**
 * Parse the orchestrator's machine-readable verdict line. Tolerant of surrounding prose: the last
 * `VERDICT: PASS|FAIL [— [nodes=a,b — ]reason]` occurrence wins. A missing/garbled line is `unparsed`
 * — the caller re-asks (bounded) rather than hanging the run on a malformed reply.
 *
 * The optional `nodes=<id>,<id>` prefix names the subtasks to re-run on a FAIL (scoped repair). Node
 * ids are slugs (may contain single hyphens), so the prefix is split from the reason on an em-dash or
 * colon only — never on the hyphen that legitimately appears inside a slug.
 */
function parseVerdict(text: string): { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } {
  const matches = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)\b[ \t]*(?:[—:-]+[ \t]*([^\n]*))?/gi)];
  const last = matches.at(-1);
  if (!last) return { result: 'unparsed' };
  const result = last[1]!.toUpperCase() === 'PASS' ? 'pass' : 'fail';
  let rest = last[2]?.trim() || undefined;
  let nodes: string[] | undefined;
  if (rest) {
    const m = rest.match(/^nodes=([a-z0-9,\- ]+?)\s*(?:[—:]+\s*(.*))?$/i);
    if (m) {
      nodes = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
      rest = m[2]?.trim() || undefined;
    }
  }
  const out: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } = { result };
  if (rest) out.reason = rest;
  if (nodes && nodes.length) out.nodes = nodes;
  return out;
}

function resolveParams(spec: TaskSpec, provided?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params ?? []) if (p.default !== undefined) out[p.name] = p.default;
  return { ...out, ...(provided ?? {}) };
}

export class TaskRunner {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(private readonly deps: TaskRunnerDeps) {}

  private key(slug: string, runId: string): string {
    return `${slug}:${runId}`;
  }

  /** Load + validate a task's yaml and start a run. Throws if the task is missing or invalid. */
  run(slug: string, opts: RunOptions = {}): RunSnapshot {
    const loaded = loadTaskDocument(this.deps.workspaceRoot, slug);
    if (!loaded?.spec) throw new Error(`Task "${slug}" not found or has no valid task.yaml`);
    if (!loaded.valid) {
      throw new Error(`Refusing to run invalid task "${slug}": ${loaded.errors.map((e) => e.message).join('; ')}`);
    }
    if (loaded.sourceVersion === 2) {
      const unimplemented = unimplementedV2Nodes(loaded.spec.nodes);
      if (unimplemented.length) {
        throw new Error(
          `Cannot start a v2 run: unimplemented kinds: ${unimplemented.map((n) => `${n.id} (${n.kind})`).join(', ')}`,
        );
      }
    }
    // One active run per orchestrator: a second concurrent run would race the same parent session's
    // verdict listener (two runs attaching onSessionComplete on the same orchestrator would cross
    // their verifications). Block it. NOTE: this does not guard against a human typing into the
    // orchestrator mid-`verifying` — that race is a known, bounded v1 limitation.
    const orchestrator = opts.orchestratorSessionId;
    if (orchestrator) {
      for (const existing of this.runs.values()) {
        const snap = existing.snapshot();
        if (snap.orchestratorSessionId === orchestrator && !isTerminalRunStatus(snap.status)) {
          throw new Error(
            `Task "${slug}" already has an active run (${snap.runId}) on this orchestrator; stop it before starting another.`,
          );
        }
      }
    }
    const runId = opts.runId ?? (this.deps.genRunId ? this.deps.genRunId() : `run-${Date.now()}`);
    const run = new ActiveRun(
      loaded.spec,
      slug,
      runId,
      {
        ...opts,
        sourceVersion: loaded.sourceVersion,
        params: resolveParams(loaded.spec, opts.params),
        verifyOnComplete: opts.verifyOnComplete ?? true,
      },
      this.deps,
    );
    this.runs.set(this.key(slug, runId), run);
    run.start();
    return run.snapshot();
  }

  pause(slug: string, runId: string): RunSnapshot {
    return this.requireRun(slug, runId).pause();
  }

  resume(slug: string, runId: string): RunSnapshot {
    const existing = this.runs.get(this.key(slug, runId));
    if (existing) return existing.resume();
    const run = this.rehydrate(slug, runId, 'hydrate');
    return run.resume();
  }

  continue(slug: string, runId: string): RunSnapshot {
    const existing = this.runs.get(this.key(slug, runId));
    if (existing) return existing.continueAfterInterrupt();
    const run = this.rehydrate(slug, runId, 'scan');
    return run.continueAfterInterrupt();
  }

  /**
   * Load unfinished runs from disk without scheduling. Running nodes become
   * `interrupted`. Paused / waiting-approval / waiting-budget keep those states.
   */
  applyOrchestrationPatch(slug: string, runId: string, patch: OrchestrationPatch): RunSnapshot {
    return this.requireRun(slug, runId).applyPatch(patch);
  }

  applyOrchestrationPatchByRunId(runId: string, patch: OrchestrationPatch): RunSnapshot {
    for (const run of this.runs.values()) {
      if (run.snapshot().runId === runId) return run.applyPatch(patch);
    }
    throw new TaskControlError('failed', `No active run ${runId}`);
  }

  currentRunSpec(slug: string, runId: string): TaskSpec | null {
    return this.runs.get(this.key(slug, runId))?.currentSpec() ?? null;
  }

  scanUnfinished(): RunSnapshot[] {
    const out: RunSnapshot[] = [];
    for (const slug of listTaskSlugs(this.deps.workspaceRoot)) {
      for (const runId of listRunIds(this.deps.workspaceRoot, slug)) {
        if (this.runs.has(this.key(slug, runId))) {
          const snap = this.runs.get(this.key(slug, runId))!.snapshot();
          if (!isTerminalRunStatus(snap.status)) out.push(snap);
          continue;
        }
        const log = readRunLog(this.deps.workspaceRoot, slug, runId);
        if (log.length === 0) continue;
        if (isTerminalRunStatus(deriveRunStatusFromLog(log))) continue;
        out.push(this.rehydrate(slug, runId, 'scan').snapshot());
      }
    }
    return out;
  }

  /** Reconstruct an in-memory run from the run spec snapshot + run-log. Never reads live YAML for the graph. */
  private rehydrate(slug: string, runId: string, mode: 'scan' | 'hydrate'): ActiveRun {
    const latest = readLatestSpecRevision(this.deps.workspaceRoot, slug, runId);
    const spec = latest?.spec ?? readSpecRevision(this.deps.workspaceRoot, slug, runId, 0);
    if (!spec) throw new Error(`Cannot restore "${slug}:${runId}": no spec snapshot`);
    const log = readRunLog(this.deps.workspaceRoot, slug, runId);
    if (log.length === 0) throw new Error(`Cannot restore "${slug}:${runId}": no run-log found`);
    const started = log.find((e) => e.kind === 'run-started');
    const orchestratorSessionId = started && started.kind === 'run-started' ? started.orchestratorSessionId : undefined;
    const checkpoint = readRunState(this.deps.workspaceRoot, slug, runId);
    const run = new ActiveRun(
      spec,
      slug,
      runId,
      {
        orchestratorSessionId,
        params: resolveParams(spec),
        verifyOnComplete: true,
        sourceVersion: spec.schema_version === 2 ? 2 : 1,
      },
      this.deps,
    );
    run.restoreCheckpoint(checkpoint, latest?.revision ?? 0);
    run.hydrate(log, (nodeId) => readNodeOutput(this.deps.workspaceRoot, slug, runId, nodeId), mode);
    this.runs.set(this.key(slug, runId), run);
    return run;
  }

  private requireRun(slug: string, runId: string): ActiveRun {
    const run = this.runs.get(this.key(slug, runId));
    if (!run) throw new TaskControlError('failed', `No active run ${slug}:${runId}`);
    return run;
  }

  async stop(slug: string, runId: string): Promise<RunSnapshot> {
    const existing = this.runs.get(this.key(slug, runId));
    if (existing) return existing.stop();
    return this.rehydrate(slug, runId, 'scan').stop();
  }

  respondApproval(slug: string, runId: string, nodeId: string, approved: boolean): RunSnapshot {
    return this.requireRun(slug, runId).respondApproval(nodeId, approved);
  }

  updateRunLimits(slug: string, runId: string, tokenBudget?: number, params?: Record<string, unknown>): RunSnapshot {
    return this.requireRun(slug, runId).updateLimits(tokenBudget, params);
  }

  submitNodeOutput(sessionId: string, payload: { text?: string; values?: Record<string, unknown> }) {
    const run = this.findRunBySession(sessionId);
    if (!run) return { ok: false as const, error: 'No active run owns this session' };
    return run.acceptOutput(sessionId, payload);
  }

  submitVerdict(sessionId: string, payload: { result: 'pass' | 'fail'; reason?: string; nodes?: string[]; runId?: string }): RunSnapshot {
    const run = payload.runId
      ? [...this.runs.values()].find((r) => r.snapshot().runId === payload.runId && r.hasSession(sessionId))
      : this.findRunBySession(sessionId);
    if (!run) throw new TaskControlError('failed', 'No verifying run for this session');
    return run.submitStructuredVerdict(payload);
  }

  private findRunBySession(sessionId: string): ActiveRun | undefined {
    for (const run of this.runs.values()) if (run.hasSession(sessionId)) return run;
    return undefined;
  }

  getRunState(slug: string, runId: string): RunSnapshot | null {
    return this.runs.get(this.key(slug, runId))?.snapshot() ?? null;
  }

  getLatestRun(slug: string): RunSnapshot | null {
    let latest: RunSnapshot | null = null;
    for (const run of this.runs.values()) {
      const snap = run.snapshot();
      if (snap.slug === slug) latest = snap;
    }
    if (latest) return latest;
    const last = listRunIds(this.deps.workspaceRoot, slug).at(-1);
    if (!last) return null;
    try {
      const snap = this.rehydrate(slug, last, isTerminalRunStatus(deriveRunStatusFromLog(readRunLog(this.deps.workspaceRoot, slug, last))) ? 'hydrate' : 'scan').snapshot();
      if (isTerminalRunStatus(snap.status)) this.runs.delete(this.key(slug, last));
      return snap;
    } catch {
      return null;
    }
  }

  /** Await a run reaching a terminal state (completed/failed/stopped). */
  waitUntilSettled(slug: string, runId: string): Promise<RunSnapshot> {
    const run = this.runs.get(this.key(slug, runId));
    if (!run) return Promise.reject(new Error(`No active run ${slug}:${runId}`));
    return run.waitUntilSettled();
  }
}
