import { describe, expect, it } from 'bun:test';
import { handleSubmitTaskOutput } from './submit-task-output.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleSubmitTaskOutput', () => {
  it('forwards values to the injected callback', async () => {
    const calls: Array<{ text?: string; values?: Record<string, unknown> }> = [];
    const ctx = {
      submitTaskOutput: async (input) => {
        calls.push(input);
        return { ok: true };
      },
    } as SessionToolContext;
    const result = await handleSubmitTaskOutput(ctx, { text: 'hello', values: { score: 1 } });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([{ text: 'hello', values: { score: 1 } }]);
  });

  it('errors when the callback is missing', async () => {
    const result = await handleSubmitTaskOutput({} as SessionToolContext, { text: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });
});
