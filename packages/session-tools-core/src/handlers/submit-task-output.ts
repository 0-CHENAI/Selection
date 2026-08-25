import type { SessionToolContext, SubmitTaskOutputInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type SubmitTaskOutputArgs = SubmitTaskOutputInput;

export async function handleSubmitTaskOutput(
  ctx: SessionToolContext,
  args: SubmitTaskOutputArgs,
): Promise<ToolResult> {
  if (!ctx.submitTaskOutput) {
    return errorResponse('submit_task_output is not available in this context.');
  }
  try {
    const result = await ctx.submitTaskOutput({ text: args.text, values: args.values });
    if (!result.ok) return errorResponse(result.error ?? 'Output was rejected');
    return successResponse(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to submit task output: ${message}`);
  }
}
