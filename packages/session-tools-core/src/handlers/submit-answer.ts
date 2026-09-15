import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import { successResponse, errorResponse } from '../response.ts';

// Only markdown affects delivery. Providers may echo UI metadata (intent/displayName);
// discard those extra fields rather than misreporting a complete answer as empty.
export const SubmitAnswerSchema = z.object({
  markdown: z.string().refine(value => /[^\s|]/u.test(value), 'Answer must contain renderable text'),
}).strip();

export async function handleSubmitAnswer(ctx: SessionToolContext, args: unknown) {
  const parsed = SubmitAnswerSchema.safeParse(args);
  if (!parsed.success) return errorResponse('Submit a complete, non-empty Markdown answer.');
  if (!ctx.submitAnswer) return errorResponse('Answer delivery is unavailable in this session.');
  try {
    await ctx.submitAnswer(parsed.data.markdown);
    return successResponse('Answer delivered. Stop here.');
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Answer delivery failed.');
  }
}
