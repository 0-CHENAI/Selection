import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import type { DeveloperFeedback } from '../types.ts';
import { handleSendDeveloperFeedback } from './send-developer-feedback.ts';

function createCtx(options?: {
  approvedToken?: string;
  approvedMessage?: string;
}): { ctx: SessionToolContext; writes: DeveloperFeedback[] } {
  const writes: DeveloperFeedback[] = [];
  let approvalAvailable = true;
  const ctx = {
    sessionId: 'session-secret',
    submitFeedback: (feedback: DeveloperFeedback) => writes.push(feedback),
    consumeDeveloperFeedbackApproval: (token: string, message: string) => {
      if (!approvalAvailable) return false;
      if (token !== options?.approvedToken || message !== options?.approvedMessage) return false;
      approvalAvailable = false;
      return true;
    },
  } as unknown as SessionToolContext;
  return { ctx, writes };
}

describe('handleSendDeveloperFeedback', () => {
  it('fails closed without a host-issued approval token', async () => {
    const { ctx, writes } = createCtx();
    const result = await handleSendDeveloperFeedback(ctx, { message: 'Report this bug' });
    expect(result.isError).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('rejects a token approved for different content', async () => {
    const { ctx, writes } = createCtx({
      approvedToken: 'approved-once',
      approvedMessage: 'Original message',
    });
    const result = await handleSendDeveloperFeedback(ctx, {
      message: 'Changed message',
      approvalToken: 'approved-once',
    });
    expect(result.isError).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('persists only the approved message and generated record metadata', async () => {
    const message = 'Minimal product feedback';
    const { ctx, writes } = createCtx({
      approvedToken: 'approved-once',
      approvedMessage: message,
    });
    const result = await handleSendDeveloperFeedback(ctx, {
      message,
      approvalToken: 'approved-once',
    });
    expect(result.isError).toBeFalsy();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.message).toBe(message);
    expect(writes[0]).not.toHaveProperty('sessionId');
    expect(writes[0]).not.toHaveProperty('approvalToken');
  });

  it('consumes approval tokens after one submission', async () => {
    const message = 'One submission only';
    const { ctx, writes } = createCtx({
      approvedToken: 'approved-once',
      approvedMessage: message,
    });
    const args = { message, approvalToken: 'approved-once' };
    expect((await handleSendDeveloperFeedback(ctx, args)).isError).toBeFalsy();
    expect((await handleSendDeveloperFeedback(ctx, args)).isError).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
