import { describe, expect, it } from 'bun:test';
import type { Context } from '@earendil-works/pi-ai';
import {
  MIN_CONTEXT_RESERVE_TOKENS,
  buildContextBudget,
  calculateContextBudget,
  calculateOverflowRetryMaxTokens,
  estimateContextInputBreakdown,
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

    const breakdown = estimateContextInputBreakdown(context);
    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.tools).toBeGreaterThan(0);
    expect(breakdown.messages).toBeGreaterThan(0);
    expect(breakdown.systemPrompt + breakdown.tools + breakdown.messages)
      .toBeLessThanOrEqual(estimateContextInputTokens(context));
  });

  it('splits Selection-owned prompt tags and tool names into optional rows', () => {
    const context = {
      systemPrompt: [
        'You are a concise assistant.',
        '## User Preferences - User has explicitly set these preferences, so adhere to them',
        '',
        '- Name: Ada',
        '<project_context project="acme">',
        'Keep replies short.',
        '</project_context>',
        '<available_skills>',
        '- officecli (officecli): Read this skill first',
        '  path: /tmp/SKILL.md',
        '</available_skills>',
      ].join('\n'),
      tools: [
        { name: 'bash', description: 'Run a shell command', parameters: { type: 'object' } },
        { name: 'mcp__source__search', description: 'Search a connected source', parameters: { type: 'object' } },
        { name: 'spawn_session', description: 'Start a child session', parameters: { type: 'object' } },
      ],
      messages: [
        {
          role: 'user',
          content: '<session_transfer_summary>\nPrior workspace work.\n</session_transfer_summary>\nHello',
          timestamp: 1,
        },
        {
          role: 'user',
          content: '<sources>\n知识库 (slug: cortex)\n</sources>\nWhat next?',
          timestamp: 2,
        },
      ],
    } as Context;

    const breakdown = estimateContextInputBreakdown(context);
    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.tools).toBeGreaterThan(0);
    expect(breakdown.rules).toBeGreaterThan(0);
    expect(breakdown.skills).toBeGreaterThan(0);
    expect(breakdown.mcpTools).toBeGreaterThan(0);
    expect(breakdown.subagents).toBeGreaterThan(0);
    expect(breakdown.summarized).toBeGreaterThan(0);
    expect(breakdown.messages).toBeGreaterThan(0);
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

describe('context envelope classification', () => {
  it('ignores inline and fenced examples before the actual catalog', () => {
    const catalog = '<available_skills>\n- officecli: /skills/officecli/SKILL.md\n</available_skills>';
    for (const fence of ['```', '~~~~']) {
      const examples = `Read \`<available_skills>\` when needed.\n${fence}xml\n<available_skills>\nexample\n</available_skills>\n${fence}\nSystem rules stay here.`;
      const result = estimateContextInputBreakdown({ systemPrompt: examples + '\n' + catalog, messages: [] });
      expect(result.skills).toBe(estimateTextTokensConservatively(catalog));
      expect(result.systemPrompt).toBeGreaterThanOrEqual(estimateTextTokensConservatively(examples));
      expect(estimateContextInputBreakdown({ systemPrompt: examples, messages: [] }).skills).toBeUndefined();
    }
  });

  it('counts tags in tool output and assistant text as conversation content', () => {
    const content = [{ type: 'text', text: '<available_skills>\nnot a catalog\n</available_skills>' }];
    const result = estimateContextInputBreakdown({ messages: [
      { role: 'toolResult', toolName: 'Read', toolCallId: 'read-1', content, isError: false, timestamp: 1 },
      { role: 'assistant', content, timestamp: 2 },
    ] } as Context);
    expect(result.skills).toBeUndefined();
    expect(result.messages).toBeGreaterThan(0);
  });
});

it('leaves fenced preferences examples in the system bucket', () => {
  const systemPrompt = '```md\n## User Preferences\nExample preference\n```\nNormal instructions';
  const result = estimateContextInputBreakdown({ systemPrompt, messages: [] });
  expect(result.rules).toBeUndefined();
  expect(result.systemPrompt).toBe(estimateTextTokensConservatively(systemPrompt));
});
