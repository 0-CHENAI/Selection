import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSubmitTaskDefinition } from './submit-task-definition.ts';

describe('handleSubmitTaskDefinition — YAML import only', () => {
  it('rejects an otherwise valid request without invoking the backend', async () => {
    let calls = 0;
    const ctx = { submitTaskDefinition: async () => { calls++; throw new Error('must not run'); } } as unknown as SessionToolContext;
    const result = await handleSubmitTaskDefinition(ctx, { spec: { schema_version: 3 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Import a YAML file');
    expect(calls).toBe(0);
  });
  it('rejects stale clients even without a callback', async () => {
    const result = await handleSubmitTaskDefinition({} as SessionToolContext, { spec: { schema_version: 3 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('schema_version: 3');
  });
});
