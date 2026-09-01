import type { SessionToolContext, SubmitTaskNodeVerdictInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleSubmitTaskNodeVerdict(
  ctx: SessionToolContext,
  args: SubmitTaskNodeVerdictInput,
): Promise<ToolResult> {
  if (!ctx.submitTaskNodeVerdict) {
    return errorResponse('submit_task_node_verdict is not available in this context.');
  }
  if (args.result !== 'pass' && args.result !== 'fail') {
    return errorResponse('result must be pass or fail.');
  }
  try {
    const result = await ctx.submitTaskNodeVerdict(args);
    if (!result.ok) return errorResponse(result.error ?? 'Failed to submit node verdict.');
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to submit node verdict: ${message}`);
  }
}
