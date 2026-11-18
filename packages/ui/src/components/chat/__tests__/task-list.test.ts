import { expect, test } from 'bun:test';
import { extractTodosFromActivities, groupMessagesByTurn, taskListSeed } from '../turn-utils';
import type { ActivityItem, TodoItem } from '../TurnCard';
import type { Message } from '@craft-agent/core';
const items = [{ id: 'a', content: '确认事实', status: 'in_progress' as const }, { id: 'b', content: '验收', status: 'pending' as const }];
const activity = (timestamp: number, list: TodoItem[] = items): ActivityItem => ({ id: String(timestamp), type: 'tool', toolName: 'session__update_task_list', status: 'completed', timestamp, depth: 0, content: JSON.stringify({ items: list }) });
test('one turn takes the latest accepted result; a failed update leaves its snapshot', () => {
  const done = items.map(item => ({ ...item, status: 'completed' as const }));
  expect(extractTodosFromActivities([activity(1), activity(2, done), { ...activity(3), status: 'error' }])).toEqual(done);
  expect(extractTodosFromActivities([activity(1), { ...activity(2), content: '[ERROR]' }])).toEqual(items);
});
test('historical turns retain snapshots and a stopped turn interrupts only the active item', () => {
  const messages: Message[] = [
    { id: 'u', role: 'user', content: '多步工作', timestamp: 1 },
    { id: 't', role: 'tool', content: '', toolResult: JSON.stringify({ items }), toolName: 'update_task_list', toolStatus: 'completed', toolUseId: 'tool', timestamp: 2 },
    { id: 'stop', role: 'info', content: 'Interrupted', timestamp: 3 },
    { id: 'u2', role: 'user', content: '继续', timestamp: 4 },
    { id: 't2', role: 'tool', content: '', toolResult: JSON.stringify({ items: items.map(item => ({ ...item, status: 'completed' })) }), toolName: 'update_task_list', toolStatus: 'completed', toolUseId: 'tool2', timestamp: 5 },
  ];
  const turns = groupMessagesByTurn(messages, { isSessionProcessing: false }).filter(turn => turn.type === 'assistant');
  expect(turns[0]!.todos?.map(item => item.status)).toEqual(['interrupted', 'pending']);
  expect(turns[1]!.todos?.map(item => item.status)).toEqual(['completed', 'completed']);
});
test('rail seed stays on the call that created the list', () => {
  expect(taskListSeed({
    activities: [
      { toolName: 'update_task_list', toolUseId: 'origin', timestamp: 2 },
      { toolName: 'mcp__session__update_task_list', toolUseId: 'later', timestamp: 5 },
    ],
    turnId: 'turn',
    sessionId: 'session',
  })).toBe('origin');
  expect(taskListSeed({
    activities: [{ toolName: 'TodoWrite', toolUseId: 'legacy', timestamp: 4 }],
    turnId: 'turn',
  })).toBe('legacy');
  expect(taskListSeed({ activities: [], turnId: 'turn', sessionId: 'session' })).toBe('turn');
  expect(taskListSeed({ sessionId: ' session ' })).toBe('session');
  expect(taskListSeed({})).toBe('task-list');
});

test('same-millisecond correction supersedes the earlier completed checklist', () => {
  const done = items.map(item => ({ ...item, status: 'completed' as const }));
  expect(extractTodosFromActivities([activity(1, done), activity(1)])).toEqual(items);
});

test('failed updates and nested checklists cannot complete the conversation checklist', () => {
  const done = items.map(item => ({ ...item, status: 'completed' as const }));
  const tool = (id: string, list: TodoItem[]): Message => ({
    id, role: 'tool', content: '', timestamp: 2, toolUseId: id, toolName: 'update_task_list',
    toolStatus: 'completed', toolResult: JSON.stringify({ items: list }),
  });
  for (const update of [
    { ...tool('failed', done), timestamp: 3, toolStatus: 'error' as const },
    { ...tool('child', done), timestamp: 3, parentToolUseId: 'agent' },
  ]) {
    const turns = groupMessagesByTurn([
      { id: 'u', role: 'user', content: '多步工作', timestamp: 1 },
      tool('plan', items), update,
    ], { isSessionProcessing: false });
    expect(turns.find(turn => turn.type === 'assistant')?.todos).toEqual(items);
  }
});
