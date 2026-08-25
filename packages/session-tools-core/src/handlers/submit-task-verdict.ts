import type { SessionToolContext, SubmitTaskVerdictInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type SubmitTaskVerdictArgs = SubmitTaskVerdictInput;

export async function handleSubmitTaskVerdict(
  ctx: SessionToolContext,
  args: SubmitTaskVerdictArgs,
): Promise<ToolResult> {
  if (!ctx.submitTaskVerdict) {
    return errorResponse('submit_task_verdict is not available in this context.');
  }
  if (args.result !== 'pass' && args.result !== 'fail') {
    return errorResponse('result must be pass or fail.');
  }
  try {
    const result = await ctx.submitTaskVerdict({
      result: args.result,
      reason: args.reason,
      nodes: args.nodes,
      runId: args.runId,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to submit task verdict: ${message}`);
  }
}
