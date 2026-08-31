import type { SessionToolContext, SubmitTaskDefinitionInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleSubmitTaskDefinition(
  ctx: SessionToolContext,
  args: SubmitTaskDefinitionInput,
): Promise<ToolResult> {
  if (!ctx.submitTaskDefinition) {
    return errorResponse('submit_task_definition is not available in this context.');
  }
  if (!args.spec || typeof args.spec !== 'object') {
    return errorResponse('spec is required.');
  }
  try {
    const result = await ctx.submitTaskDefinition(args);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to submit task definition: ${message}`);
  }
}
