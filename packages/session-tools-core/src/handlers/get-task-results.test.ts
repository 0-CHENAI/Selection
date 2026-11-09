import { describe, it, expect } from 'bun:test';
import { handleGetTaskResults } from './get-task-results.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleGetTaskResults', () => {
  it('returns the backend payload as JSON', async () => {
    const ctx = {
      getTaskResults: async (slug: string, runId?: string) => ({ slug, runId: runId ?? 'run-1', runIds: ['run-1'], nodes: [] }),
    } as unknown as SessionToolContext;

    const result = await handleGetTaskResults(ctx, { slug: 'my-task' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ slug: 'my-task', runId: 'run-1' });
  });

  it('errors when the callback is missing', async () => {
    const result = await handleGetTaskResults({} as SessionToolContext, { slug: 'my-task' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  it('rejects a missing slug', async () => {
    const ctx = {
      getTaskResults: async () => ({ slug: 'x', runId: null, runIds: [], nodes: [] }),
    } as unknown as SessionToolContext;
    const result = await handleGetTaskResults(ctx, { slug: '  ' });
    expect(result.isError).toBe(true);
  });
});
