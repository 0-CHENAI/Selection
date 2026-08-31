import { describe, expect, it } from 'bun:test';
import { handleSubmitTaskDefinition } from './submit-task-definition.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleSubmitTaskDefinition', () => {
  it('stores a valid spec through the callback', async () => {
    const ctx = {
      submitTaskDefinition: async () => ({ valid: true, yaml: 'id: x' }),
    } as unknown as SessionToolContext;
    const ok = await handleSubmitTaskDefinition(ctx, { spec: { id: 'x', title: 'X', goal: 'g', nodes: [] } });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content[0]?.text ?? '').valid).toBe(true);
  });

  it('errors without a spec or callback', async () => {
    expect((await handleSubmitTaskDefinition({} as SessionToolContext, { spec: { id: 'x' } })).isError).toBe(true);
    const ctx = { submitTaskDefinition: async () => ({ valid: true }) } as unknown as SessionToolContext;
    expect((await handleSubmitTaskDefinition(ctx, { spec: undefined as never })).isError).toBe(true);
  });
});
