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
    return errorResponse(`Failed to submit orchestration decision: ${message}${currentRun ? `\nCurrent canonical run (only submit a new decision when waiting-coordinator with its current checkpoint; otherwise end this turn): ${JSON.stringify(currentRun)}` : ''}`);
  }
}
