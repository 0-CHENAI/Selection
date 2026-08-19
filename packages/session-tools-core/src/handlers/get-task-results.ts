import type { SessionToolContext, GetTaskResultsInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type GetTaskResultsArgs = GetTaskResultsInput;

export async function handleGetTaskResults(
  ctx: SessionToolContext,
  args: GetTaskResultsArgs
): Promise<ToolResult> {
  if (!ctx.getTaskResults) {
    return errorResponse('get_task_results is not available in this context.');
  }
  if (!args.slug?.trim()) {
    return errorResponse('slug is required.');
  }

  try {
    const result = await ctx.getTaskResults(args.slug.trim(), args.runId?.trim() || undefined);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to get task results: ${message}`);
  }
}
