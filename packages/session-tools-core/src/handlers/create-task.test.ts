import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCreateTask } from './create-task.ts';

describe('canonical plan creation', () => {
  it('requires a request identity before reaching the backend', async () => {
    let calls = 0;
    const ctx = { createTask: async () => { calls++; throw new Error('must not run'); } } as unknown as SessionToolContext;
    expect((await handleCreateTask(ctx, { title: 'Task', description: 'Work' })).isError).toBe(true);
    expect(calls).toBe(0);
  });
  it('passes an identified plan and preserves host errors', async () => {
    const args = { requestId: 'r1', title: 'Task', description: 'Work' };
    const ctx = { createTask: async (input: unknown) => {
      expect(input).toEqual(args);
      return { slug: 'task', orchestratorSessionId: 'root', warnings: [] };
    } } as unknown as SessionToolContext;
    expect((await handleCreateTask(ctx, args)).isError).not.toBe(true);
    ctx.createTask = async () => { throw new Error('NORM cannot create plans'); };
    expect(JSON.stringify(await handleCreateTask(ctx, args))).toContain('NORM cannot create plans');
  });
});
