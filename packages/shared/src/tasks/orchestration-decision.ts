import { validateOrchestrationPatch, type OrchestrationPatch, type PatchContext, type PatchResult } from './orchestration-patch.ts';
import type { CoordinatorGateReason } from './metrics.ts';

export const COORDINATOR_TIMEOUT_BLOCKER = 'coordinator-timeout';

export type OrchestrationDecisionAction = 'continue' | 'patch' | 'pause';

export interface OrchestrationDecision {
  runId: string;
  checkpointId: string;
  decisionId: string;
  baseRevision: number;
  action: OrchestrationDecisionAction;
  rationale?: string;
  add?: OrchestrationPatch['add'];
  update?: OrchestrationPatch['update'];
  cancel?: OrchestrationPatch['cancel'];
}

export interface CoordinatorGateState {
  checkpointId: string;
  reason: CoordinatorGateReason;
  revision: number;
  deadline: string;
}

export interface DecisionContext {
  runId: string;
  revision: number;
  gate: CoordinatorGateState | null;
  seenDecisionIds: ReadonlySet<string>;
  completedCheckpointIds: ReadonlySet<string>;
}

export interface DecisionOk {
  ok: true;
  action: OrchestrationDecisionAction;
  patch?: PatchResult & { ok: true };
}

export interface DecisionErr {
  ok: false;
  error: string;
  pauseForReview?: boolean;
}

export type DecisionResult = DecisionOk | DecisionErr;

export function validateOrchestrationDecision(
  decision: OrchestrationDecision,
  ctx: DecisionContext,
  patchCtx?: PatchContext,
): DecisionResult {
  if (!decision.runId?.trim()) return { ok: false, error: 'runId is required' };
  if (decision.runId !== ctx.runId) return { ok: false, error: 'runId does not match' };
  if (!decision.checkpointId?.trim()) return { ok: false, error: 'checkpointId is required' };
  if (!decision.decisionId?.trim()) return { ok: false, error: 'decisionId is required' };
  if (decision.action !== 'continue' && decision.action !== 'patch' && decision.action !== 'pause') {
    return { ok: false, error: 'action must be continue, patch, or pause' };
  }
  if (!ctx.gate) return { ok: false, error: 'run is not waiting for a coordinator decision' };
  if (decision.checkpointId !== ctx.gate.checkpointId) return { ok: false, error: 'checkpointId does not match' };
  if (ctx.completedCheckpointIds.has(decision.checkpointId)) {
    return { ok: false, error: 'checkpoint already decided' };
  }
  if (ctx.seenDecisionIds.has(decision.decisionId)) return { ok: false, error: 'decisionId replayed' };
  if (decision.baseRevision !== ctx.revision) return { ok: false, error: 'stale revision' };
  if (decision.baseRevision !== ctx.gate.revision) return { ok: false, error: 'stale revision' };

  if (decision.action !== 'patch') {
    return { ok: true, action: decision.action };
  }

  if (!patchCtx) return { ok: false, error: 'patch context is required' };
  const rationale = decision.rationale?.trim();
  if (!rationale) return { ok: false, error: 'rationale is required' };
  const patchResult = validateOrchestrationPatch(
    {
      runId: decision.runId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      rationale,
      add: decision.add,
      update: decision.update,
      cancel: decision.cancel,
      action: 'continue',
    },
    patchCtx,
  );
  if (!patchResult.ok) {
    return { ok: false, error: patchResult.error, pauseForReview: patchResult.pauseForReview };
  }
  return { ok: true, action: 'patch', patch: patchResult };
}
