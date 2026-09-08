import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCreateTask } from './create-task.ts';

describe('handleCreateTask — agent creation stays disabled', () => {
  it('rejects an otherwise valid request without invoking the backend', async () => {
    let calls = 0;
    const ctx = { createTask: async () => { calls++; throw new Error('must not run'); } } as unknown as SessionToolContext;
    const result = await handleCreateTask(ctx, { title: 'Task', description: 'Work' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Create or import a V3 workflow in the editor');
    expect(calls).toBe(0);
  });
  it('rejects stale clients even without a callback', async () => {
    const result = await handleCreateTask({} as SessionToolContext, { title: 'Task', description: 'Work' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Create or import a V3 workflow in the editor');
  });
});
