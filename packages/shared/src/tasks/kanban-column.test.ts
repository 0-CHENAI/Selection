import { describe, expect, it } from 'bun:test';
import { resolveKanbanColumnId } from './kanban-column.ts';

describe('resolveKanbanColumnId', () => {
  it('maps built-in statuses onto the default three columns', () => {
    expect(resolveKanbanColumnId('todo')).toBe('todo');
    expect(resolveKanbanColumnId('in-progress')).toBe('in-progress');
    expect(resolveKanbanColumnId('done')).toBe('done');
  });

  it('keeps needs-review in place on the default board', () => {
    expect(resolveKanbanColumnId('needs-review')).toBeNull();
  });

  it('prefers a custom column whose dropStatusId matches', () => {
    const columns = [
      { id: 'backlog', dropStatusId: 'todo' },
      { id: 'doing', dropStatusId: 'in-progress' },
      { id: 'review', dropStatusId: 'needs-review' },
    ];
    expect(resolveKanbanColumnId('needs-review', columns)).toBe('review');
    expect(resolveKanbanColumnId('in-progress', columns)).toBe('doing');
  });

  it('returns null when a custom board has no matching dropStatusId', () => {
    expect(resolveKanbanColumnId('done', [{ id: 'doing', dropStatusId: 'in-progress' }])).toBeNull();
  });
});
