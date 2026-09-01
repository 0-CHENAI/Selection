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
  if (args.action !== 'continue' && args.action !== 'patch' && args.action !== 'pause') {
    return errorResponse('action must be continue, patch, or pause.');
  }
  try {
    const result = await ctx.submitOrchestrationDecision(args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to submit orchestration decision: ${message}`);
  }
}
