import { z } from 'zod';
import type { SessionToolContext, TaskHelpInput } from '../context';
import { successResponse, errorResponse } from '../response';

const text = z.string().trim().min(1);
export const TaskHelpSchema = z.object({
  action: z.enum(['request', 'answer', 'needs-user']),
  requestId: text.describe('Worker request identity; root replies use the full host-issued ID from the coordinator notification.'),
  runId: text.optional(), baseRevision: z.number().int().nonnegative().optional(),
  problem: text.optional(), tried: z.array(text).optional(), needed: text.optional(),
  claimRefs: z.array(z.object({ id: text, version: z.number().int().positive() })).optional(),
  sourceRefs: z.array(z.object({ id: text, version: text })).optional(),
  responseId: text.optional(), response: text.optional(),
});

export async function handleTaskHelp(ctx: SessionToolContext, input: TaskHelpInput) {
  if (!ctx.taskHelp) return errorResponse('Structured task help is not available in this context.');
  if (input.action === 'request' && (!input.problem?.trim() || !input.tried?.length || !input.needed?.trim())) return errorResponse('A help request requires problem, tried and needed.');
  if (input.action !== 'request' && (!input.runId || input.baseRevision === undefined || !input.responseId || !input.response)) return errorResponse('A root response requires runId, baseRevision, responseId and response.');
  try { return successResponse(JSON.stringify(await ctx.taskHelp(input))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)); }
}
