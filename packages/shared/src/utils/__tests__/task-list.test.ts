import { expect, test } from 'bun:test';
import { latestTaskList, withoutInheritedTaskLists } from '../task-list.ts';
import type { TaskListItem } from '@craft-agent/session-tools-core';
test('reopens latest successful snapshot, ignores rejected updates and empties a branch', () => {
  const first: TaskListItem[] = [{ id: 'a', content: '确认', status: 'in_progress' }];
  const last: TaskListItem[] = [{ id: 'a', content: '确认', status: 'completed' }, { id: 'b', content: '验收', status: 'pending' }];
  const messages = [
    { content: '目标' },
    { toolName: 'update_task_list', toolStatus: 'completed', content: '', toolResult: JSON.stringify({ items: first }) },
    { toolName: 'mcp__session__update_task_list', toolStatus: 'completed', content: '', toolResult: JSON.stringify({ items: last }) },
    { toolName: 'update_task_list', toolStatus: 'error', content: '[ERROR]' },
  ];
  expect(latestTaskList(JSON.parse(JSON.stringify(messages)))).toEqual(last);
  expect(latestTaskList(withoutInheritedTaskLists(messages))).toBeUndefined();
  expect(messages[1]!.toolResult).toBe(JSON.stringify({ items: first }));
});
