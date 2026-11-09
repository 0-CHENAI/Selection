import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleClarify } from './clarify.ts';

const ask = {
  question: '报告要覆盖哪一年？',
  ambiguity: 'scope',
  selection: 'single',
  options: [{ id: '2024', label: '2024' }, { id: '2025', label: '2025' }],
};

describe('handleClarify', () => {
  it('rejects a call that does not name a critical ambiguity and does not ask the host', async () => {
    let called = false;
    const ctx = {
      callbacks: { onClarifyRequest: () => { called = true; return { accepted: true, requestId: 'x', round: 1 }; } },
    } as unknown as SessionToolContext;
    const result = await handleClarify(ctx, { question: '随便问一下', ambiguity: 'style' });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    expect(result.content[0]?.text).toContain('unambiguous');
  });

  it('returns the host rejection when the soft cap blocks another question', async () => {
    const ctx = {
      callbacks: {
        onClarifyRequest: () => ({ accepted: false, reason: 'Already asked 3 clarifications.' }),
      },
    } as unknown as SessionToolContext;
    const result = await handleClarify(ctx, ask);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Already asked 3');
  });

  it('rejects duplicate option ids without asking the host', async () => {
    let called = false;
    const ctx = {
      callbacks: { onClarifyRequest: () => { called = true; return { accepted: true, requestId: 'x', round: 1 }; } },
    } as unknown as SessionToolContext;
    const result = await handleClarify(ctx, {
      ...ask,
      options: [{ id: '2024', label: '2024' }, { id: '2024', label: '去年' }],
    });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('accepts a text-only question and still asks the host', async () => {
    let selection = '';
    const ctx = {
      callbacks: {
        onClarifyRequest: (input: { selection: string; options: unknown[] }) => {
          selection = input.selection;
          expect(input.options).toEqual([]);
          return { accepted: true, requestId: 'clarify-text', round: 1 };
        },
      },
    } as unknown as SessionToolContext;
    const result = await handleClarify(ctx, { question: '目标是什么？', ambiguity: 'goal' });
    expect(result.isError).toBeFalsy();
    expect(selection).toBe('single');
    expect(result.content[0]?.text).toContain('clarify-text');
  });

  it('accepts a critical extra round and tells the model to stop the turn', async () => {
    const ctx = {
      callbacks: {
        onClarifyRequest: (input: { critical?: boolean }) => {
          expect(input.critical).toBe(true);
          return { accepted: true, requestId: 'clarify-1', round: 4 };
        },
      },
    } as unknown as SessionToolContext;
    const result = await handleClarify(ctx, { ...ask, critical: true });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('clarify-1');
    expect(result.content[0]?.text).toContain('round 4');
  });
});
