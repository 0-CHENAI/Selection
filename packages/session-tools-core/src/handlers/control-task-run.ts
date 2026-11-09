import type { SessionToolContext, ControlTaskRunInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleControlTaskRun(
  ctx: SessionToolContext,
  args: ControlTaskRunInput,
): Promise<ToolResult> {
  if (!ctx.controlTaskRun) {
    return errorResponse('control_task_run is not available in this context.');
  }
  if (!args.slug?.trim() || !args.runId?.trim() || !args.action) {
    return errorResponse('slug, runId, and action are required.');
  }
  try {
    const result = await ctx.controlTaskRun(args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to control task run: ${message}`);
  }
}
