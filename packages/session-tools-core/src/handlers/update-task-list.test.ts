import { expect, test } from 'bun:test';
import { handleUpdateTaskList, taskListAllowed, type TaskListItem } from './update-task-list.ts';
import { getSessionSafeAllowedToolNames, getToolDefsAsJsonSchema } from '../tool-defs.ts';
import type { SessionToolContext } from '../context.ts';

const items = [{ id: 'a', content: '确认事实', status: 'in_progress' as const }, { id: 'b', content: '验证结果', status: 'pending' as const }];
test('ordinary safe conversations can replace a list without workflow callbacks', async () => {
  const calls: unknown[] = [];
  const ctx = { updateTaskList: async (list: TaskListItem[]) => { calls.push(list); } } as unknown as SessionToolContext;
  const result = await handleUpdateTaskList(ctx, { items });
  expect(result.isError).toBeFalsy();
  expect(JSON.parse(result.content[0]!.text!)).toEqual({ items });
  await handleUpdateTaskList(ctx, { items: [] });
  expect(calls).toEqual([items, []]);
  expect(getSessionSafeAllowedToolNames().has('update_task_list')).toBe(true);
  const schema = getToolDefsAsJsonSchema().find(def => def.name === 'update_task_list');
  expect(JSON.stringify(schema)).toContain('items');
});
test('rejects invalid lists, duplicate IDs, multiple active items and unavailable contexts', async () => {
  let calls = 0;
  const ctx = { updateTaskList: async () => { calls++; } } as unknown as SessionToolContext;
  for (const input of [
    { items: items.map(item => ({ ...item, status: 'in_progress' })) },
    { items: [items[0], items[0]] }, { items: [{ ...items[0], content: ' ' }] },
    { items, depends_on: ['dag'] },
  ]) expect((await handleUpdateTaskList(ctx, input)).isError).toBe(true);
  expect(calls).toBe(0);
  expect((await handleUpdateTaskList({} as unknown as SessionToolContext, { items })).isError).toBe(true);
});
test('host rejects proposal, DAG coordinator and delegated worker scope', async () => {
  expect(taskListAllowed({})).toBe(true);
  for (const session of [{ taskSlug: 'x' }, { taskDraft: true }, { parentSessionId: 'root' }, { orchestrationId: 'swarm' }]) {
    expect(taskListAllowed(session)).toBe(false);
    expect((await handleUpdateTaskList({ updateTaskList: async () => { if (!taskListAllowed(session)) throw new Error('ordinary only'); } } as unknown as SessionToolContext, { items })).isError).toBe(true);
  }
});
