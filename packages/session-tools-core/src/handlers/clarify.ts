/**
 * clarify — pause for a step-by-step user clarification card.
 *
 * One call may include several questions. Choices and free text coexist.
 * Skip on a question means continue with the current best understanding.
 * The host enforces the question cap (questions, not calls).
 */

import { z } from 'zod';
import type { ClarificationAsk, ClarificationGate, ClarificationQuestion } from '../clarification.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

const ClarifyOptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
});

const ClarifyQuestionSchema = z.object({
  id: z.string().trim().min(1).max(64).describe('Stable id for this step. Required when asking several questions.'),
  question: z.string().trim().min(1).max(500).describe('The question shown on this step.'),
  selection: z.enum(['single', 'multi']).optional().describe('single keeps one option; multi allows several. Ignored when options is empty.'),
  options: z.array(ClarifyOptionSchema).max(8).optional().describe('Choices shown together with the free-text field. Omit for a text-only step.'),
});

export const ClarifySchema = z.object({
  question: z.string().trim().min(1).max(500).optional()
    .describe('One question. Kept for single-question calls. Prefer `questions` when asking more than one.'),
  questions: z.array(ClarifyQuestionSchema).min(1).max(4).optional()
    .describe('Ask several questions in one card, walked one step at a time. Counts against the question cap (max 3, or 4 with critical=true). Each item: id, question, optional options, optional selection (single|multi).'),
  ambiguity: z.enum(['goal', 'scope', 'constraints']).describe('The critical ambiguity. Do not call this tool when none of these is unclear.'),
  selection: z.enum(['single', 'multi']).optional().describe('single keeps one option; multi allows several. Ignored when options is empty. Used with the top-level `question` field.'),
  options: z.array(ClarifyOptionSchema).max(8).optional().describe('Choices shown together with the free-text field. Omit for a text-only question. Used with the top-level `question` field.'),
  critical: z.boolean().optional().describe('True only for the one extra question after three clarifications, when the request is still critically ambiguous.'),
}).superRefine((value, ctx) => {
  if (!value.question && !(value.questions && value.questions.length > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['question'], message: 'Provide question or questions.' });
  }
});

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

function toQuestion(input: {
  id: string;
  question: string;
  selection?: 'single' | 'multi';
  options?: Array<{ id: string; label: string }>;
}): ClarificationQuestion {
  const options = input.options ?? [];
  return {
    id: input.id,
    question: input.question,
    selection: options.length > 0 && input.selection === 'multi' ? 'multi' : 'single',
    options,
  };
}

export function parseClarifyAsk(args: unknown): { ok: true; ask: ClarificationAsk } | { ok: false; reason: string } {
  const parsed = ClarifySchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: 'clarify requires a question (or questions) and ambiguity of goal, scope, or constraints. Do not interrupt an unambiguous request.' };
  }
  const questions = parsed.data.questions?.length
    ? parsed.data.questions.map(item => toQuestion(item))
    : [toQuestion({
        id: 'q1',
        question: parsed.data.question!,
        selection: parsed.data.selection,
        options: parsed.data.options,
      })];
  if (!uniqueIds(questions.map(item => item.id))) {
    return { ok: false, reason: 'Clarification questions must use unique ids.' };
  }
  for (const question of questions) {
    if (!uniqueIds(question.options.map(option => option.id))) {
      return { ok: false, reason: 'Clarification options must use unique ids.' };
    }
  }
  const first = questions[0]!;
  return {
    ok: true,
    ask: {
      question: first.question,
      questions,
      ambiguity: parsed.data.ambiguity,
      selection: first.selection,
      options: first.options,
      critical: parsed.data.critical === true,
    },
  };
}

export async function handleClarify(ctx: SessionToolContext, args: unknown): Promise<ToolResult> {
  const parsed = parseClarifyAsk(args);
  if (!parsed.ok) return errorResponse(parsed.reason);
  const gate: ClarificationGate | undefined = ctx.callbacks.onClarifyRequest?.(parsed.ask);
  if (!gate) {
    return errorResponse('Clarification is not available in this context. Continue with your best current understanding.');
  }
  if (!gate.accepted) return errorResponse(gate.reason);
  const count = parsed.ask.questions?.length ?? 1;
  return successResponse(
    `Waiting for the user to answer or skip clarification ${gate.requestId} (${count} question${count === 1 ? '' : 's'}, round ${gate.round}). Stop this turn. `
    + 'Each skipped question means proceed with your current understanding: state in your reply what you assumed for it so the user can correct it. '
    + 'Do not re-ask a skipped question, except at most once if the skip would clearly make the result wrong (that re-ask counts against the question cap).',
  );
}
