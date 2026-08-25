import type { SessionToolContext, OrchestrationPatchInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleSubmitOrchestrationPatch(
  ctx: SessionToolContext,
  args: OrchestrationPatchInput,
): Promise<ToolResult> {
  if (!ctx.submitOrchestrationPatch) {
    return errorResponse('submit_orchestration_patch is not available in this context.');
  }
  if (!args.runId?.trim() || !args.decisionId?.trim() || args.baseRevision == null || !args.rationale?.trim()) {
    return errorResponse('runId, decisionId, baseRevision, and rationale are required.');
  }
  try {
    const result = await ctx.submitOrchestrationPatch(args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to apply orchestration patch: ${message}`);
  }
}
