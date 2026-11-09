import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSubmitTaskDefinition } from './submit-task-definition.ts';

describe('handleSubmitTaskDefinition — proposal only', () => {
  it('returns backend failures without claiming a proposal succeeded', async () => {
    let calls = 0;
    const ctx = { submitTaskDefinition: async () => { calls++; throw new Error('must not run'); } } as unknown as SessionToolContext;
    const result = await handleSubmitTaskDefinition(ctx, { spec: { schema_version: 3 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('must not run');
    expect(calls).toBe(1);
  });
  it('rejects stale clients even without a callback', async () => {
    const result = await handleSubmitTaskDefinition({} as SessionToolContext, { spec: { schema_version: 3 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not available');
  });
});
