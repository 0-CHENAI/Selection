import { planProtectionErrors, planValueKey } from './plan.ts';
import { isTasksOrchestrateEnabled } from '../feature-flags.ts';
import { TaskNodeSchema, TaskSpecSchema, type TaskNode, type TaskSpec } from './schema.ts';
import { TASK_CAPS, validateTaskSpec } from './validate.ts';
import type { NodeRunState } from './storage.ts';
import { v2UnknownFields } from './document.ts';

export const MAX_SPEC_REVISIONS = 8;
export const MAX_INVALID_PATCHES = 2;

export type TaskNodePatch = Partial<TaskNode> & Pick<TaskNode, 'id'>;

const PERM_RANK: Record<string, number> = { safe: 0, ask: 1, 'allow-all': 2 };

export interface OrchestrationPatch {
  runId: string;
  decisionId: string;
  baseRevision: number;
  rationale: string;
  add?: TaskNode[];
  update?: TaskNodePatch[];
  cancel?: string[];
  constraints?: string[];
  decisions?: string[];
  consumedResults?: string[];
  plannerPhase?: 'active' | 'draining';
  changeKind?: 'structure' | 'repair' | 'research';
  /**
   * Legacy terminal values remain decodable so the validator can reject an old
   * payload deterministically. New typed callers use the narrower session-tool
   * input and schema (`continue | pause`).
   */
  action?: 'continue' | 'pause' | 'complete' | 'fail';
}

export interface PatchContext {
  spec: TaskSpec;
  revision: number;
  runId: string;
  seenDecisionIds: ReadonlySet<string>;
  nodeStates: Record<string, NodeRunState>;
  allowedModels?: ReadonlySet<string>;
  invalidPatchCount?: number;
  pendingResultIds?: ReadonlySet<string>;
}

export interface PatchOk {
  ok: true;
  spec: TaskSpec;
  revision: number;
  cancelled: string[];
  action?: 'continue' | 'pause';
}

export interface PatchErr {
  ok: false;
  error: string;
  pauseForReview?: boolean;
}

export type PatchResult = PatchOk | PatchErr;

const TERMINAL_OR_LIVE: ReadonlySet<NodeRunState> = new Set([
  'running',
  'retry-wait',
  'waiting-approval',
  'done',
  'failed',
  'invalid',
  'cancelled',
  'skipped',
  'interrupted',
]);

function fail(ctx: PatchContext, error: string): PatchErr {
  const count = (ctx.invalidPatchCount ?? 0) + 1;
  return { ok: false, error, pauseForReview: count >= MAX_INVALID_PATCHES };
}

export function validateOrchestrationPatch(patch: OrchestrationPatch, ctx: PatchContext): PatchResult {
  if (!isTasksOrchestrateEnabled()) return fail(ctx, 'orchestrate is disabled');
  if (ctx.spec.runner !== 'orchestrate') return fail(ctx, 'run is not an orchestrate runner');
  if (patch.runId !== ctx.runId) return fail(ctx, 'runId does not match');
  if (!patch.decisionId?.trim()) return fail(ctx, 'decisionId is required');
  if (!patch.rationale?.trim()) return fail(ctx, 'rationale is required');
  if (ctx.seenDecisionIds.has(patch.decisionId)) return fail(ctx, 'decisionId replayed');
  if (patch.baseRevision !== ctx.revision) return fail(ctx, 'stale revision');
  if (patch.consumedResults?.some(id => !ctx.pendingResultIds?.has(id))) return fail(ctx, 'Unknown or already consumed result event');
  if (patch.consumedResults && new Set(patch.consumedResults).size !== patch.consumedResults.length) return fail(ctx, 'Duplicate result event');
  if (patch.plannerPhase !== undefined && !['active', 'draining'].includes(patch.plannerPhase)) return fail(ctx, 'Invalid planner phase');
  if (ctx.revision + 1 >= MAX_SPEC_REVISIONS) return fail(ctx, 'revision cap exceeded');
  // Keep a runtime guard for older/untyped callers even though the public type
  // and tool schema expose scheduling controls only.
  const rawAction = (patch as { action?: unknown }).action;
  if (rawAction !== undefined && rawAction !== 'continue' && rawAction !== 'pause') {
    return fail(ctx, `action ${String(rawAction)} cannot bypass node settlement and the final structured verdict`);
  }

  const byId = new Map(ctx.spec.nodes.map((n) => [n.id, n]));
  const nextNodes = ctx.spec.nodes.map((n) => ({ ...n }));
  const cancelled = [...(patch.cancel ?? [])];
  const ceiling = ctx.spec.defaults?.permissionMode ?? 'safe';

  for (const id of cancelled) {
    const state = ctx.nodeStates[id] ?? 'pending';
    if (state !== 'pending' && state !== 'ready') return fail(ctx, `cannot cancel ${id} in state ${state}`);
    if (!byId.has(id)) return fail(ctx, `cannot cancel unknown node ${id}`);
  }

  const normalized = new Map<string, TaskNode>();
  for (const raw of patch.add ?? []) {
    const unknown = v2UnknownFields({ ...ctx.spec, schema_version: ctx.spec.schema_version === 3 ? 3 : 2, nodes: [raw] });
    if (unknown.length) return fail(ctx, unknown.map((issue) => issue.message).join('; '));
    const parsed = TaskNodeSchema.safeParse(raw);
    if (!parsed.success) return fail(ctx, parsed.error.issues.map((i) => i.message).join('; '));
    normalized.set(parsed.data.id, parsed.data);
  }

  for (const raw of patch.update ?? []) {
    const unknown = v2UnknownFields({ ...ctx.spec, schema_version: ctx.spec.schema_version === 3 ? 3 : 2, nodes: [raw] });
    if (unknown.length) return fail(ctx, unknown.map((issue) => issue.message).join('; '));
    const id = typeof raw.id === 'string' ? raw.id : '';
    const existing = byId.get(id);
    if (!existing) return fail(ctx, `cannot update unknown node ${id || '<missing id>'}`);
    // Updates are partial records. Parse the merged node so schema defaults do
    // not silently replace an existing non-session kind.
    const parsed = TaskNodeSchema.safeParse({ ...existing, ...raw });
    if (!parsed.success) return fail(ctx, parsed.error.issues.map((i) => i.message).join('; '));
    normalized.set(parsed.data.id, parsed.data);
  }

  for (const raw of patch.update ?? []) {
    const node = normalized.get(raw.id)!;
    const state = ctx.nodeStates[node.id] ?? 'pending';
    if (TERMINAL_OR_LIVE.has(state) && state !== 'pending' && state !== 'ready') {
      return fail(ctx, `cannot update ${node.id} in state ${state}`);
    }
    const idx = nextNodes.findIndex((n) => n.id === node.id);
    if (!permissionAllowed(node.permissionMode, ceiling)) {
      return fail(ctx, `node ${node.id} permission exceeds task ceiling`);
    }
    if (node.model && (!ctx.allowedModels || !ctx.allowedModels.has(node.model))) {
      return fail(ctx, `model ${node.model} is not in the workspace`);
    }
    if (node.llmConnection && node.llmConnection !== ctx.spec.defaults?.llmConnection) {
      return fail(ctx, `llmConnection ${node.llmConnection} exceeds the task connection boundary`);
    }
    nextNodes[idx] = { ...nextNodes[idx], ...node };
  }

  for (const raw of patch.add ?? []) {
    const node = normalized.get(raw.id)!;
    if (byId.has(node.id) || nextNodes.some((n) => n.id === node.id)) {
      return fail(ctx, `cannot add duplicate node ${node.id}`);
    }
    if (!permissionAllowed(node.permissionMode, ceiling)) {
      return fail(ctx, `node ${node.id} permission exceeds task ceiling`);
    }
    if (node.model && (!ctx.allowedModels || !ctx.allowedModels.has(node.model))) {
      return fail(ctx, `model ${node.model} is not in the workspace`);
    }
    if (node.llmConnection && node.llmConnection !== ctx.spec.defaults?.llmConnection) {
      return fail(ctx, `llmConnection ${node.llmConnection} exceeds the task connection boundary`);
    }
    nextNodes.push(node);
  }

  const touched = [...(patch.add ?? []).map(n => n.id), ...(patch.update ?? []).map(n => n.id), ...cancelled];
  if (new Set(touched).size !== touched.length) return fail(ctx, 'A patch must change each node only once');

  const remaining = nextNodes.filter((n) => !cancelled.includes(n.id));
  const next: TaskSpec = { ...ctx.spec, nodes: remaining,
    ...(patch.constraints !== undefined ? { constraints: patch.constraints } : {}),
    ...(patch.decisions !== undefined ? { decisions: patch.decisions } : {}),
  };
  const protection = planProtectionErrors(ctx.spec, next);
  if (protection.length) return fail(ctx, protection.join('; '));
  const parsedPlan = TaskSpecSchema.safeParse(next.schema_version === 3 ? next : { ...next, execution: undefined });
  if (!parsedPlan.success) return fail(ctx, parsedPlan.error.issues.map(issue => issue.message).join("; "));
  const graph = validateTaskSpec(next);
  if (!graph.valid) return fail(ctx, graph.errors.map((e) => e.message).join('; '));
  if (remaining.length > TASK_CAPS.maxNodes) return fail(ctx, 'node cap exceeded');

  return {
    ok: true,
    spec: next,
    revision: ctx.revision + 1,
    cancelled,
    action: rawAction as 'continue' | 'pause' | undefined,
  };
}

function permissionAllowed(mode: string | undefined, ceiling: string): boolean {
  if (!mode) return true;
  return (PERM_RANK[mode] ?? 99) <= (PERM_RANK[ceiling] ?? 0);
}

export interface DefinitionDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** Definition-level diff — never includes expanded map/loop instances. */
export function definitionDiff(from: TaskSpec, to: TaskSpec): DefinitionDiff {
  const fromIds = new Set(from.nodes.map((n) => n.id));
  const toIds = new Set(to.nodes.map((n) => n.id));
  const added = to.nodes.filter((n) => !fromIds.has(n.id)).map((n) => n.id);
  const removed = from.nodes.filter((n) => !toIds.has(n.id)).map((n) => n.id);
  const changed: string[] = [];
  const fromById = new Map(from.nodes.map((n) => [n.id, n]));
  for (const n of to.nodes) {
    const prev = fromById.get(n.id);
    if (!prev) continue;
    if (JSON.stringify(stripUi(prev)) !== JSON.stringify(stripUi(n))) changed.push(n.id);
  }
  return { added, removed, changed };
}

/**
 * Apply only the graph definition produced by a run. Task identity, project,
 * working directory, sources, skills, permissions and budgets remain owned by
 * the latest live task document.
 */
export function mergeRunDefinition(from: TaskSpec, run: TaskSpec): TaskSpec {
  const schema_version = from.schema_version === 3 || run.schema_version === 3 ? 3 : 2;
  return {
    ...from,
    schema_version,
    nodes: run.nodes,
    ...(schema_version === 3
      ? {
          execution: from.execution ?? run.execution,
          acceptance_criteria: from.acceptance_criteria ?? run.acceptance_criteria,
        }
      : {}),
  };
}

function stripUi(node: TaskNode): TaskNode {
  return node;
}

/** Convert a confirmed editor definition into the same patch used by the coordinator. */
export function definitionToPatch(from: TaskSpec, to: TaskSpec, identity: Pick<OrchestrationPatch, 'runId' | 'decisionId' | 'baseRevision' | 'rationale'>): OrchestrationPatch {
  const editable = new Set(['nodes', 'ui', 'constraints', 'decisions']);
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!editable.has(key) && planValueKey(from[key as keyof TaskSpec]) !== planValueKey(to[key as keyof TaskSpec])) {
      throw new Error(`Runtime editing cannot change "${key}". Save a definition for a later run instead.`);
    }
  }
  const previous = new Map(from.nodes.map(node => [node.id, node]));
  const updates: TaskNodePatch[] = [];
  for (const node of to.nodes) {
    const old = previous.get(node.id);
    if (!old || planValueKey(old) === planValueKey(node)) continue;
    // Explicit undefined values remove optional fields before the merged schema is parsed.
    updates.push(Object.assign(Object.fromEntries(Object.keys(old).map(key => [key, undefined])), node) as TaskNodePatch);
  }
  return { ...identity, add: to.nodes.filter(node => !previous.has(node.id)), update: updates,
    cancel: from.nodes.filter(node => !to.nodes.some(next => next.id === node.id)).map(node => node.id),
    ...(planValueKey(from.constraints) !== planValueKey(to.constraints) ? { constraints: to.constraints ?? [] } : {}),
    ...(planValueKey(from.decisions) !== planValueKey(to.decisions) ? { decisions: to.decisions ?? [] } : {}),
  };
}
