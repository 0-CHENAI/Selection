import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';

export const TaskListItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'interrupted']),
  activeForm: z.string().trim().min(1).optional(),
}).strict();
export type TaskListItem = z.infer<typeof TaskListItemSchema>;
export const UpdateTaskListSchema = z.object({
  items: z.array(TaskListItemSchema).describe('Complete replacement list. Reuse item IDs when updating the same goal.'),
}).strict().superRefine(({ items }, ctx) => {
  if (items.filter(item => item.status === 'in_progress').length > 1) {
    ctx.addIssue({ code: 'custom', message: 'At most one item may be in_progress' });
  }
  if (new Set(items.map(item => item.id)).size !== items.length) {
    ctx.addIssue({ code: 'custom', message: 'Item IDs must be unique' });
  }
});

export function taskListAllowed(session: { taskSlug?: string; taskDraft?: boolean; parentSessionId?: string; orchestrationId?: string }): boolean {
  return !session.taskSlug && !session.taskDraft && !session.parentSessionId && !session.orchestrationId;
}

export async function handleUpdateTaskList(ctx: SessionToolContext, input: unknown) {
  const parsed = UpdateTaskListSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.message);
  if (!ctx.updateTaskList) return errorResponse('Task List is only available in ordinary conversations.');
  try {
    await ctx.updateTaskList(parsed.data.items);
    // The transcript result is the authoritative snapshot, not unvalidated input.
    return successResponse(JSON.stringify(parsed.data));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
