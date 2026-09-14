import { expect, it } from 'bun:test';
import { assertExplicitQueryFits, assertImmutableContextFits, explicitQueryHistory } from './explicit-query-input.ts';
import { Type } from '@sinclair/typebox';

it('counts Agent tool definitions as part of the immutable input budget', () => {
  const context = { systemPrompt: 'platform', messages: [], tools: [
    { name: 'large_tool', description: '中'.repeat(4096), parameters: Type.Object({}) },
  ] };
  const before = JSON.stringify(context);
  expect(() => assertImmutableContextFits(context, 4096)).toThrow('no previewed content was removed');
  expect(JSON.stringify(context)).toBe(before);
  expect(() => assertImmutableContextFits({ ...context, tools: [] }, 4096)).not.toThrow();
});

it('preserves ordered message roles and exact text without tool-call history', () => {
  const history = explicitQueryHistory({ prompt: 'current', messages: [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }, { role: 'user', content: 'three' }] }, { api: 'openai-completions', provider: 'openai', model: 'test' });
  expect(history.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
  expect(history[1]?.content).toEqual([{ type: 'text', text: 'two' }]);
  expect(history[0]?.content).toBe('one');
  expect(JSON.stringify(history)).not.toContain('current');
});

it('rejects oversized immutable context including history, system and images without modifying it', () => {
  const model = { api: 'openai-completions' as const, provider: 'openai', model: 'test', contextWindow: 4096 };
  const request = { prompt: 'current', systemPrompt: '中'.repeat(2000), messages: [{ role: 'user' as const, content: '中'.repeat(2000) }] };
  const before = JSON.stringify(request);
  expect(() => assertExplicitQueryFits(request, model)).toThrow('no previewed content was removed');
  expect(JSON.stringify(request)).toBe(before);
  expect(() => assertExplicitQueryFits({ prompt: 'small', images: [{ mimeType: 'image/png', data: 'bytes' }, { mimeType: 'image/png', data: 'bytes' }] }, model)).toThrow('does not fit');
  expect(() => assertExplicitQueryFits({ prompt: 'small' }, model)).not.toThrow();
  expect(() => assertExplicitQueryFits({ prompt: 'small' }, { ...model, contextWindow: 0 })).toThrow('no known context window');
});
