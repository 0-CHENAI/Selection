import type { SessionToolContext, SubmitTaskDefinitionInput } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';


/** Reject stale tool calls without invoking a creation callback. */
export async function handleSubmitTaskDefinition(
  _ctx: SessionToolContext,
  _args: SubmitTaskDefinitionInput,
): Promise<ToolResult> {
  return errorResponse('Task creation by Agent is disabled. Import a YAML file with schema_version: 3 in the application.');
}
