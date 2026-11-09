import { describe, expect, it } from 'bun:test';
import { handleControlTaskRun } from './control-task-run.ts';
import type { SessionToolContext } from '../context.ts';
import { ControlTaskRunSchema } from '../tool-defs.ts';

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

  it('does not expose approval or budget mutation to the model-facing tool', () => {
    expect(ControlTaskRunSchema.safeParse({ slug: 's', runId: 'r', action: 'approve', nodeId: 'n' }).success).toBe(false);
    expect(ControlTaskRunSchema.safeParse({ slug: 's', runId: 'r', action: 'updateLimits', tokenBudget: 10 }).success).toBe(false);
  });
});
