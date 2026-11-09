import { describe, it, expect } from 'bun:test';
import { handleRunTask } from './run-task.ts';
import type { SessionToolContext, RunTaskInput, RunTaskResult } from '../context.ts';

function createCtx(result?: Partial<RunTaskResult>): {
  ctx: SessionToolContext;
  calls: RunTaskInput[];
} {
  const calls: RunTaskInput[] = [];
  const ctx = {
    runTask: async (input: RunTaskInput) => {
      calls.push(input);
      return {
        slug: 'my-task',
        runId: 'run-1',
        status: 'running',
        nodeCount: 1,
        nodes: [{ id: 'main', state: 'running' }],
        ...result,
      } satisfies RunTaskResult;
    },
  } as unknown as SessionToolContext;
  return { ctx, calls };
}

describe('handleRunTask', () => {
  it('runs a task by slug and returns the snapshot as JSON', async () => {
    const { ctx, calls } = createCtx();
    const result = await handleRunTask(ctx, { slug: 'my-task' });

    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([{ slug: 'my-task', orchestratorSessionId: undefined, params: undefined, waitForCompletion: undefined }]);
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ slug: 'my-task', runId: 'run-1', status: 'running' });
  });

  it('errors when the callback is missing', async () => {
    const result = await handleRunTask({} as SessionToolContext, { slug: 'my-task' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  it('rejects missing slug and orchestratorSessionId', async () => {
    const { ctx, calls } = createCtx();
    const result = await handleRunTask(ctx, {});
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
