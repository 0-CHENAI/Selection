import { expect, it } from 'bun:test';
import { getSessionToolNames } from './tool-defs.ts';
import { handleCreateTask } from './handlers/create-task.ts';
import { handleSubmitTaskDefinition } from './handlers/submit-task-definition.ts';
import type { SessionToolContext } from './context.ts';

it('does not advertise Agent task authoring tools', () => {
  const names = getSessionToolNames();
  expect(names).not.toContain('create_task');
  expect(names).not.toContain('submit_task_definition');
  expect(names).toContain('run_task');
});

it('rejects stale tool calls without executing callbacks', async () => {
  let calls = 0;
  const ctx = { createTask: async () => { calls++; }, submitTaskDefinition: async () => { calls++; } } as unknown as SessionToolContext;
  expect((await handleCreateTask(ctx, { title: 'Task', description: 'Work' })).isError).toBe(true);
  expect((await handleSubmitTaskDefinition(ctx, { spec: { schema_version: 3 } })).isError).toBe(true);
  expect(calls).toBe(0);
});
