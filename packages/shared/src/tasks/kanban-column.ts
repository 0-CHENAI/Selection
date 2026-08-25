/**
 * Resolve a session status to a kanban column id.
 *
 * Prefer a project column whose `dropStatusId` matches the target status.
 * With no custom columns, built-in todo/in-progress/done map to themselves.
 * `needs-review` has no built-in column — return null so the card stays put.
 */
export function resolveKanbanColumnId(
  statusId: string,
  columns?: ReadonlyArray<{ id: string; dropStatusId?: string }> | null,
): string | null {
  if (columns && columns.length > 0) {
    return columns.find((c) => c.dropStatusId === statusId)?.id ?? null;
  }
  if (statusId === 'todo' || statusId === 'in-progress' || statusId === 'done') return statusId;
  return null;
}
