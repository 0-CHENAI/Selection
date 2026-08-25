import { isTasksOrchestrateEnabled } from '../feature-flags.ts';
import { TaskNodeSchema, type TaskNode, type TaskSpec } from './schema.ts';
import { TASK_CAPS, validateTaskSpec } from './validate.ts';
import type { NodeRunState } from './storage.ts';

export const MAX_SPEC_REVISIONS = 8;
export const MAX_INVALID_PATCHES = 2;

const PERM_RANK: Record<string, number> = { safe: 0, ask: 1, 'allow-all': 2 };

export interface OrchestrationPatch {
  runId: string;
  decisionId: string;
  baseRevision: number;
  rationale: string;
  add?: TaskNode[];
  update?: TaskNode[];
  cancel?: string[];
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
}

export interface PatchOk {
  ok: true;
  spec: TaskSpec;
  revision: number;
  cancelled: string[];
  action?: OrchestrationPatch['action'];
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
  if (ctx.revision + 1 >= MAX_SPEC_REVISIONS) return fail(ctx, 'revision cap exceeded');

  const byId = new Map(ctx.spec.nodes.map((n) => [n.id, n]));
  const nextNodes = ctx.spec.nodes.map((n) => ({ ...n }));
  const cancelled = [...(patch.cancel ?? [])];
  const ceiling = ctx.spec.defaults?.permissionMode ?? 'allow-all';

  for (const id of cancelled) {
    const state = ctx.nodeStates[id] ?? 'pending';
    if (state !== 'pending' && state !== 'ready') return fail(ctx, `cannot cancel ${id} in state ${state}`);
    if (!byId.has(id)) return fail(ctx, `cannot cancel unknown node ${id}`);
  }

  for (const raw of [...(patch.add ?? []), ...(patch.update ?? [])]) {
    const parsed = TaskNodeSchema.safeParse(raw);
    if (!parsed.success) return fail(ctx, parsed.error.issues.map((i) => i.message).join('; '));
  }

  for (const node of patch.update ?? []) {
    const state = ctx.nodeStates[node.id] ?? 'pending';
    if (TERMINAL_OR_LIVE.has(state) && state !== 'pending' && state !== 'ready') {
      return fail(ctx, `cannot update ${node.id} in state ${state}`);
    }
    const idx = nextNodes.findIndex((n) => n.id === node.id);
    if (idx < 0) return fail(ctx, `cannot update unknown node ${node.id}`);
    if (!permissionAllowed(node.permissionMode, ceiling)) {
      return fail(ctx, `node ${node.id} permission exceeds task ceiling`);
    }
    if (node.model && ctx.allowedModels && !ctx.allowedModels.has(node.model)) {
      return fail(ctx, `model ${node.model} is not in the workspace`);
    }
    nextNodes[idx] = { ...nextNodes[idx], ...node };
  }

  for (const node of patch.add ?? []) {
    if (byId.has(node.id) || nextNodes.some((n) => n.id === node.id)) {
      return fail(ctx, `cannot add duplicate node ${node.id}`);
    }
    if (!permissionAllowed(node.permissionMode, ceiling)) {
      return fail(ctx, `node ${node.id} permission exceeds task ceiling`);
    }
    if (node.model && ctx.allowedModels && !ctx.allowedModels.has(node.model)) {
      return fail(ctx, `model ${node.model} is not in the workspace`);
    }
    nextNodes.push(node);
  }

  const remaining = nextNodes.filter((n) => !cancelled.includes(n.id));
  const next: TaskSpec = { ...ctx.spec, nodes: remaining };
  const graph = validateTaskSpec(next);
  if (!graph.valid) return fail(ctx, graph.errors.map((e) => e.message).join('; '));
  if (remaining.length > TASK_CAPS.maxNodes) return fail(ctx, 'node cap exceeded');

  return { ok: true, spec: next, revision: ctx.revision + 1, cancelled, action: patch.action };
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

function stripUi(node: TaskNode): TaskNode {
  return node;
}
