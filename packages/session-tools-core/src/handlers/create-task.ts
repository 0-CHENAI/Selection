import type { SessionToolContext, CreateTaskInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { successResponse } from '../response.ts';

export type CreateTaskArgs = CreateTaskInput;

/** The host validates mode, ownership, authorization and durable request identity. */
export async function handleCreateTask(
  ctx: SessionToolContext,
  args: CreateTaskInput,
): Promise<ToolResult> {
  if (!ctx.createTask) return errorResponse('create_task is unavailable in this context.');
  if (!args.requestId?.trim()) return errorResponse('A stable requestId is required.');
  if (args.spec !== undefined && (args.title !== undefined || args.description !== undefined)) return errorResponse('Use spec or title/description, not both.');
  try { return successResponse(JSON.stringify(await ctx.createTask(args))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Task creation failed'); }
}
