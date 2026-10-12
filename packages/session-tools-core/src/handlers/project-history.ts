import type { SessionToolContext, ProjectHistoryInput } from '../context.ts';
import { successResponse, errorResponse } from '../response.ts';
export async function handleProjectHistory(ctx: SessionToolContext, args: ProjectHistoryInput) {
  if (!ctx.projectHistory) return errorResponse('Project history is unavailable in this context.');
  try { return successResponse(JSON.stringify(await ctx.projectHistory(args))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)); }
}
