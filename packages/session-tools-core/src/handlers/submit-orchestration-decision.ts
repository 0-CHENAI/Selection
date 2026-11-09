import type { SessionToolContext, OrchestrationDecisionInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleSubmitOrchestrationDecision(
  ctx: SessionToolContext,
  args: OrchestrationDecisionInput,
): Promise<ToolResult> {
  if (!ctx.submitOrchestrationDecision) {
    return errorResponse('submit_orchestration_decision is not available in this context.');
  }
  if (!args.runId?.trim() || !args.checkpointId?.trim() || !args.decisionId?.trim() || args.baseRevision == null) {
    return errorResponse('runId, checkpointId, decisionId, and baseRevision are required.');
  }
  if (!['continue', 'patch', 'pause', 'retry'].includes(args.action)) {
    return errorResponse('action must be continue, patch, pause, or retry.');
  }
  try {
    const result = await ctx.submitOrchestrationDecision(args);
    const nextStep = result.alreadyApplied && result.status === 'waiting-coordinator' && result.coordinatorGate
      ? 'The previous continue was already applied. A newer coordinator checkpoint remains pending. Submit a new decision for the current coordinatorGate, never the previous checkpoint.'
      : args.action === 'pause' ? 'Wait for explicit human resume.' : 'End this assistant turn now. The host will send the next checkpoint or final verification request. Do not poll or reuse the previous checkpoint id.';
    return successResponse(JSON.stringify({ ...result, nextStep }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const currentRun = error && typeof error === 'object' && 'currentRun' in error ? error.currentRun : undefined;
    // A scheduling race is a rejected decision, not a failed service request.
    // Return the canonical state for a fresh decision; never substitute its ID
    // into the old request or release a newer gate automatically.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'conflict'
      && currentRun && typeof currentRun === 'object' && 'runId' in currentRun && currentRun.runId === args.runId
      && 'status' in currentRun && 'revision' in currentRun) {
      const gate = 'coordinatorGate' in currentRun ? currentRun.coordinatorGate : undefined;
      if (currentRun.status !== 'waiting-coordinator'
        || currentRun.revision !== args.baseRevision
        || (gate && typeof gate === 'object' && 'checkpointId' in gate && gate.checkpointId !== args.checkpointId)) {
        const nextStep = currentRun.status === 'waiting-coordinator' && gate
          ? 'Decision NOT applied. Review the current checkpoint and its results before submitting a fresh decision. Copy currentRun.coordinatorGate.checkpointId exactly; its reason is not an ID. Use currentRun.revision as baseRevision.'
          : currentRun.status === 'paused' || currentRun.status === 'pausing'
            ? 'Decision NOT applied. Wait for explicit human resume. End this assistant turn now; do not resubmit or auto-resume.'
            : 'Decision NOT applied. End this assistant turn now. Wait for the host to send the next checkpoint; do not poll or resubmit.';
        return successResponse(JSON.stringify({ applied: false, conflict: message, currentRun, nextStep }, null, 2));
      }
    }
    return errorResponse(`Failed to submit orchestration decision: ${message}${currentRun ? `\nCurrent canonical run (only submit a new decision when waiting-coordinator with its current checkpoint; otherwise end this turn): ${JSON.stringify(currentRun)}` : ''}`);
  }
}
