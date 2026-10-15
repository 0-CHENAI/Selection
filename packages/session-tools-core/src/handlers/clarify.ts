/**
 * clarify — pause for one user clarification card.
 *
 * Choices and free text are collected together. Skip continues with the
 * current best understanding. The host enforces the soft round cap.
 */

import { z } from 'zod';
import type { ClarificationAsk, ClarificationGate } from '../clarification.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export const ClarifySchema = z.object({
  question: z.string().trim().min(1).max(500).describe('One question. Call only when the goal, scope, or constraints are critically ambiguous.'),
  ambiguity: z.enum(['goal', 'scope', 'constraints']).describe('The critical ambiguity. Do not call this tool when none of these is unclear.'),
  selection: z.enum(['single', 'multi']).optional().describe('single keeps one option; multi allows several. Ignored when options is empty.'),
  options: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(200),
  })).max(8).optional().describe('Choices shown together with the free-text field. Omit for a text-only question.'),
  critical: z.boolean().optional().describe('True only for the one extra question after three clarifications, when the request is still critically ambiguous.'),
});

export async function handleClarify(ctx: SessionToolContext, args: unknown): Promise<ToolResult> {
  const parsed = ClarifySchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse('clarify requires a question and ambiguity of goal, scope, or constraints. Do not interrupt an unambiguous request.');
  }
  const options = parsed.data.options ?? [];
  const ids = new Set<string>();
  for (const option of options) {
    if (ids.has(option.id)) return errorResponse('Clarification options must use unique ids.');
    ids.add(option.id);
  }
  const ask: ClarificationAsk = {
    question: parsed.data.question,
    ambiguity: parsed.data.ambiguity,
    selection: options.length > 0 && parsed.data.selection === 'multi' ? 'multi' : 'single',
    options,
    critical: parsed.data.critical === true,
  };
  const gate: ClarificationGate | undefined = ctx.callbacks.onClarifyRequest?.(ask);
  if (!gate) {
    return errorResponse('Clarification is not available in this context. Continue with your best current understanding.');
  }
  if (!gate.accepted) return errorResponse(gate.reason);
  return successResponse(`Waiting for the user to answer or skip clarification ${gate.requestId} (round ${gate.round}). Stop this turn. A skip means continue with your current best understanding.`);
}
