import { describe, expect, it } from 'bun:test';
import { handleSubmitTaskVerdict } from './submit-task-verdict.ts';
import type { SessionToolContext } from '../context.ts';
import { SubmitTaskVerdictSchema } from '../tool-defs.ts';

describe('handleSubmitTaskVerdict', () => {
  it('forwards a pass verdict', async () => {
    const ctx = {
      submitTaskVerdict: async () => ({ status: 'completed' }),
    } as unknown as SessionToolContext;
    const result = await handleSubmitTaskVerdict(ctx, { result: 'pass' });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('completed');
  });

  it('errors when the callback is missing', async () => {
    const result = await handleSubmitTaskVerdict({} as SessionToolContext, { result: 'fail', reason: 'no' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  it('strictly validates bounded structured checks', () => {
    expect(SubmitTaskVerdictSchema.safeParse({
      result: 'pass',
      checks: [{ criterion: 'current result', status: 'pass', evidenceRefs: ['node:a@r#0'] }],
    }).success).toBe(true);
    expect(SubmitTaskVerdictSchema.safeParse({
      result: 'pass',
      checks: [{ criterion: '', status: 'pass', evidenceRefs: ['node:a@r#0'] }],
    }).success).toBe(false);
    expect(SubmitTaskVerdictSchema.safeParse({
      result: 'pass',
      checks: [{ criterion: 'current result', status: 'maybe', evidenceRefs: ['node:a@r#0'] }],
    }).success).toBe(false);
    expect(SubmitTaskVerdictSchema.safeParse({
      result: 'pass',
      checks: [{ criterion: 'current result', status: 'pass', evidenceRefs: [], extra: true }],
    }).success).toBe(false);
    expect(SubmitTaskVerdictSchema.safeParse({ result: 'pass', extra: true }).success).toBe(false);
  });
});
