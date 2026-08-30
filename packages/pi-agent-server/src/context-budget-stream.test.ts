import { describe, expect, it } from 'bun:test';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelsSimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { createContextBudgetedStream } from './context-budget-stream.ts';

const model = {
  id: 'test-model',
  name: 'Test model',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262_144,
  maxTokens: 214_575,
} as Model<'openai-responses'>;

const emptyContext: Context = { messages: [] };

function message(
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: 1,
  };
}

function eventsStream(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  for (const event of events) stream.push(event);
  return stream;
}

async function collect(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const overflowText =
  'This model maximum context length is 262144 tokens. However, you requested 214575 output tokens and your prompt contains at least 47570 input tokens. (context_length_exceeded)';

describe('createContextBudgetedStream', () => {
  it('pre-caps output using system, tools, attachments, and history', async () => {
    const seen: number[] = [];
    const context = {
      systemPrompt: 'Rules '.repeat(4_000),
      tools: [{ name: 'search', description: 'x'.repeat(8_000), parameters: {} }],
      messages: [{ role: 'user', content: [
        { type: 'image', data: 'base64', mimeType: 'image/png' },
        { type: 'text', text: '长上下文'.repeat(10_000) },
      ], timestamp: 1 }],
    } as Context;
    const streamSimple = (_model: Model, _context: Context, options?: ModelsSimpleStreamOptions) => {
      seen.push(options?.maxTokens ?? 0);
      return eventsStream([{ type: 'done', reason: 'stop', message: message('stop') }]);
    };

    await collect(createContextBudgetedStream(streamSimple, model, context));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeLessThan(model.maxTokens);
  });

  it('retries one preflight overflow with a lower provider-informed budget', async () => {
    const seen: number[] = [];
    const streamSimple = (_model: Model, _context: Context, options?: ModelsSimpleStreamOptions) => {
      seen.push(options?.maxTokens ?? 0);
      if (seen.length === 1) {
        return eventsStream([
          { type: 'start', partial: message('stop') },
          { type: 'error', reason: 'error', error: message('error', overflowText) },
        ]);
      }
      return eventsStream([
        { type: 'start', partial: message('stop') },
        { type: 'text_delta', contentIndex: 0, delta: 'ok', partial: message('stop') },
        { type: 'done', reason: 'stop', message: message('stop') },
      ]);
    };

    const events = await collect(createContextBudgetedStream(streamSimple, model, emptyContext));
    expect(seen).toEqual([214_575, 206_382]);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.filter(event => event.type === 'start')).toHaveLength(1);
    expect(events.some(event => event.type === 'text_delta')).toBe(true);
  });

  it('never retries after visible output has begun', async () => {
    let calls = 0;
    const streamSimple = () => {
      calls += 1;
      return eventsStream([
        { type: 'start', partial: message('stop') },
        { type: 'text_delta', contentIndex: 0, delta: 'visible', partial: message('stop') },
        { type: 'error', reason: 'error', error: message('error', overflowText) },
      ]);
    };

    const events = await collect(createContextBudgetedStream(streamSimple, model, emptyContext));
    expect(calls).toBe(1);
    expect(events.map(event => event.type)).toEqual(['start', 'text_delta', 'error']);
  });

  it('does not retry aborted requests', async () => {
    let calls = 0;
    const streamSimple = () => {
      calls += 1;
      return eventsStream([
        { type: 'error', reason: 'aborted', error: message('aborted', overflowText) },
      ]);
    };

    const events = await collect(createContextBudgetedStream(streamSimple, model, emptyContext));
    expect(calls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('stops after one retry and exposes the second overflow for SDK compaction', async () => {
    let calls = 0;
    const streamSimple = () => {
      calls += 1;
      return eventsStream([
        { type: 'error', reason: 'error', error: message('error', overflowText) },
      ]);
    };

    const events = await collect(createContextBudgetedStream(streamSimple, model, emptyContext));
    expect(calls).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('turns a malformed unterminated stream into a terminal error', async () => {
    const streamSimple = () => {
      const stream = eventsStream([{ type: 'start', partial: message('stop') }]);
      stream.end();
      return stream;
    };

    const stream = createContextBudgetedStream(streamSimple, model, emptyContext);
    const events = await collect(stream);
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect((await stream.result()).errorMessage).toContain('without a terminal event');
  });
});
