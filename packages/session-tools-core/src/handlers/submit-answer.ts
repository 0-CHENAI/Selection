import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import { successResponse, errorResponse } from '../response.ts';

// Only markdown affects delivery. Providers may echo UI metadata (intent/displayName);
// discard only those known display fields. Routing and unknown business fields remain invalid.
export const SubmitAnswerSchema = z.object({
  markdown: z.string().refine(value => /[^\s|]/u.test(value), 'Answer must contain renderable text'),
  featuredArtifacts: z.array(z.string().trim().min(1))
    .describe('Only the primary local files delivered to the user in this answer, in display order. Use [] when there is no new or updated deliverable. Exclude source data, citations, scripts, drafts and validation files.'),
  artifactVersionTitle: z.string().trim().min(4).max(60).optional()
    .describe('When this turn creates or changes a delivered file, write a specific, short change title for its saved version. Describe the result, not the user request. Omit for answers without file changes.'),
}).strict();

const DELIVERY_RECEIPT = 'Answer delivered. Stop here.'

function isDeliveryReceiptMarkdown(markdown: string): boolean {
  const compact = markdown.replace(/\s+/g, '').toLowerCase()
  return compact === 'answerdelivered.'
    || compact === 'answerdelivered.stophere.'
    || compact === 'answerdelivered.stophere'
}

export async function handleSubmitAnswer(ctx: SessionToolContext, args: unknown) {
  const input = args && typeof args === 'object' && !Array.isArray(args)
    ? Object.fromEntries(Object.entries(args).filter(([key]) => !['_intent', '_displayName', 'intent', 'displayName'].includes(key)))
    : args;
  const parsed = SubmitAnswerSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.some(issue => issue.code === 'unrecognized_keys')
    ? 'Submit only the Markdown answer. Session and run routing are controlled by the system.'
    : 'Submit a complete Markdown answer with featuredArtifacts (use [] when there are no primary result files).');
  if (isDeliveryReceiptMarkdown(parsed.data.markdown)) {
    return errorResponse('Submit the Markdown answer itself, not the delivery receipt.');
  }
  if (!ctx.submitAnswer) return errorResponse('Answer delivery is unavailable in this session.');
  try {
    await ctx.submitAnswer(parsed.data.markdown, parsed.data.artifactVersionTitle, parsed.data.featuredArtifacts);
    return successResponse(DELIVERY_RECEIPT);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Answer delivery failed.');
  }
}
