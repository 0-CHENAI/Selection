import type { SessionToolContext, RunTaskInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type RunTaskArgs = RunTaskInput;

export async function handleRunTask(
  ctx: SessionToolContext,
  args: RunTaskArgs
): Promise<ToolResult> {
  if (!ctx.runTask) {
    return errorResponse('run_task is not available in this context.');
  }
  if (!args.slug?.trim() && !args.orchestratorSessionId?.trim()) {
    return errorResponse('slug or orchestratorSessionId is required.');
  }

  try {
    const result = await ctx.runTask({
      slug: args.slug?.trim() || undefined,
      orchestratorSessionId: args.orchestratorSessionId?.trim() || undefined,
      params: args.params,
      waitForCompletion: args.waitForCompletion,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to run task: ${message}`);
  }
}
