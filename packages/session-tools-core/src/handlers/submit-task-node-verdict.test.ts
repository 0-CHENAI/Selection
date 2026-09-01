import { describe, expect, it } from 'bun:test';
import { handleSubmitTaskNodeVerdict } from './submit-task-node-verdict.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleSubmitTaskNodeVerdict', () => {
  it('rejects missing evidence through the runner callback', async () => {
    const result = await handleSubmitTaskNodeVerdict(
      {
        submitTaskNodeVerdict: async () => ({ ok: false, error: 'fail verdict requires evidence' }),
      } as unknown as SessionToolContext,
      { result: 'fail', reason: 'bad' },
    );
    expect(result.content[0]?.text).toContain('evidence');
  });
});
