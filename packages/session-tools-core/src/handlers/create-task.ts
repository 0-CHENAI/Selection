import type { SessionToolContext, CreateTaskInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type CreateTaskArgs = CreateTaskInput;

/** Reject stale tool calls without invoking a creation callback. */
export async function handleCreateTask(
  _ctx: SessionToolContext,
  _args: CreateTaskInput,
): Promise<ToolResult> {
  return errorResponse('Task creation by Agent is disabled. Import a YAML file with schema_version: 3 in the application.');
}
