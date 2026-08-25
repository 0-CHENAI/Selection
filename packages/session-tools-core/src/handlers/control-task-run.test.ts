import { describe, expect, it } from 'bun:test';
import { handleControlTaskRun } from './control-task-run.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleControlTaskRun', () => {
  it('requires the callback and forwards a pause', async () => {
    const missing = await handleControlTaskRun({} as SessionToolContext, { slug: 's', runId: 'r', action: 'pause' });
    expect(missing.isError).toBe(true);
    const ctx = {
      controlTaskRun: async () => ({ status: 'paused' }),
    } as unknown as SessionToolContext;
    const ok = await handleControlTaskRun(ctx, { slug: 's', runId: 'r', action: 'pause' });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content[0]?.text ?? '').status).toBe('paused');
  });
});
