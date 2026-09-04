import { describe, expect, it } from 'bun:test';
import type { Context } from '@earendil-works/pi-ai';
import {
  MIN_CONTEXT_RESERVE_TOKENS,
  buildContextBudget,
  calculateContextBudget,
  calculateOverflowRetryMaxTokens,
  estimateContextInputTokens,
  estimateTextTokensConservatively,
  parseContextOverflow,
} from './context-budget.ts';

describe('context output budget', () => {
  const contextWindow = 262_144;
  const inputTokens = 47_570;
  const exactAvailable = contextWindow - inputTokens - MIN_CONTEXT_RESERVE_TOKENS;

  it('keeps the exact safe boundary', () => {
    expect(calculateContextBudget(contextWindow, exactAvailable, inputTokens)).toMatchObject({
      maxOutputTokens: exactAvailable,
      wasReduced: false,
    });
  });

  it('keeps one token below the safe boundary', () => {
    expect(calculateContextBudget(contextWindow, exactAvailable - 1, inputTokens)).toMatchObject({
      maxOutputTokens: exactAvailable - 1,
      wasReduced: false,
    });
  });

  it('caps one token above the safe boundary', () => {
    expect(calculateContextBudget(contextWindow, exactAvailable + 1, inputTokens)).toMatchObject({
      maxOutputTokens: exactAvailable,
      wasReduced: true,
    });
  });

  it('does not reduce ordinary short-session output limits', () => {
    const budget = buildContextBudget(272_000, 128_000, {
      systemPrompt: 'You are a concise assistant.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    });
    expect(budget.maxOutputTokens).toBe(128_000);
    expect(budget.wasReduced).toBe(false);
  });

  it('normalizes malformed numeric inputs instead of propagating NaN', () => {
    expect(calculateContextBudget(100_000, Number.NaN, Number.NaN)).toMatchObject({
      estimatedInputTokens: 0,
      maxOutputTokens: 1,
      wasReduced: false,
    });
  });
});

describe('context input estimation', () => {
  it('counts system prompts, tool schemas, attachments, CJK, and long history', () => {
    const context = {
      systemPrompt: 'System '.repeat(400),
      tools: [{
        name: 'search',
        description: 'Search a large catalog',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      }],
      messages: [
        { role: 'user', content: [
          { type: 'text', text: '请分析附件。' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ], timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Earlier answer' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'test',
          usage: {
            input: 45_000,
            output: 2_000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 47_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 2,
        },
        { role: 'user', content: '继续。'.repeat(1_000), timestamp: 3 },
      ],
    } as Context;

    expect(estimateTextTokensConservatively('中文abcde')).toBe(4);
    expect(estimateContextInputTokens(context)).toBeGreaterThan(50_000);
  });
});

describe('provider overflow parsing and retry cap', () => {
  const issueMessage =
    'This model maximum context length is 262144 tokens. However, you requested 214575 output tokens and your prompt contains at least 47570 input tokens.';

  it('parses the issue #143 provider counts', () => {
    expect(parseContextOverflow(issueMessage)).toEqual({
      contextWindow: 262_144,
      inputTokens: 47_570,
      requestedOutputTokens: 214_575,
    });
  });

  it('derives a strictly lower retry budget with provider-side headroom', () => {
    expect(calculateOverflowRetryMaxTokens(issueMessage, 262_144, 214_575)).toBe(206_382);
  });

  it('uses a bounded conservative reduction when counts are unavailable', () => {
    expect(calculateOverflowRetryMaxTokens('context_length_exceeded', 262_144, 100_000)).toBe(75_000);
  });

  it('defers to compaction when useful output cannot fit', () => {
    const message =
      'maximum context length is 10000 tokens; prompt contains at least 9900 input tokens';
    expect(calculateOverflowRetryMaxTokens(message, 10_000, 2_000)).toBeUndefined();
  });
});
