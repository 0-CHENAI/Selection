import { isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
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

describe('request lifecycle bounds (#360)', () => {
  it('terminates a silent provider and cancels its underlying request without retrying', async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const result = await createContextBudgetedStream((_model, _context, options) => {
      calls++;
      signal = options?.signal;
      return createAssistantMessageEventStream();
    }, model, emptyContext, { timeoutMs: 20 }).result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('time limit');
    expect(isRetryableAssistantError(result)).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  it('unblocks user cancellation even when the provider ignores abort', async () => {
    const controller = new AbortController();
    const stream = createContextBudgetedStream(() => createAssistantMessageEventStream(), model, emptyContext,
      { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    const result = await stream.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('does not start a request after user cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await createContextBudgetedStream(() => {
      calls++;
      return createAssistantMessageEventStream();
    }, model, emptyContext, { signal: controller.signal }).result();
    expect(calls).toBe(0);
    expect(result.stopReason).toBe('aborted');
  });

  it('keeps partial output, refuses a truncated tool call, and permits a subsequent request', async () => {
    const partial = message('stop');
    partial.content = [{ type: 'text', text: 'Recorded work' }];
    partial.usage.output = 17;
    const events = await collect(createContextBudgetedStream(() => eventsStream([
      { type: 'start', partial },
      { type: 'text_delta', contentIndex: 0, delta: 'Recorded work', partial },
      { type: 'toolcall_delta', contentIndex: 1, delta: '{"path":', partial },
    ]), model, emptyContext, { timeoutMs: 20 }));
    expect(events.map(event => event.type)).toEqual(['start', 'text_delta', 'toolcall_delta', 'error']);
    const terminal = events.at(-1);
    expect(terminal?.type).toBe('error');
    if (terminal?.type === 'error') {
      expect(terminal.error.content).toEqual(partial.content);
      expect(terminal.error.usage.output).toBe(17);
    }
    const result = await createContextBudgetedStream(() => eventsStream([
      { type: 'done', reason: 'stop', message: message('stop') },
    ]), model, emptyContext, { timeoutMs: 20 }).result();
    expect(result.stopReason).toBe('stop');
  });
});

describe('model-visible tool schemas', () => {
  it('deduplicates the actual provider request on first call and overflow retry', async () => {
    const tools = [
      { name: 'mcp__session__call_llm', description: 'Delegate', parameters: { type: 'object' as const } },
      { name: 'call_llm', description: 'Delegate', parameters: { type: 'object' as const } },
      { name: 'Read', description: 'Read', parameters: { type: 'object' as const } },
    ];
    const original: Context = { systemPrompt: 'Instructions', messages: [], tools };
    const requests: Context[] = [];
    const stream = createContextBudgetedStream((_model, context) => {
      requests.push(context);
      const output = createAssistantMessageEventStream();
      const result = requests.length === 1
        ? message('error', 'context_length_exceeded')
        : message('stop');
      if (result.stopReason === 'error') output.push({ type: 'error', reason: 'error', error: result });
      else output.push({ type: 'done', reason: 'stop', message: result });
      output.end(result);
      return output;
    }, model, original);
    await collect(stream);
    expect(requests.length).toBe(2);
    for (const request of requests) {
      expect(request.tools?.map(tool => tool.name)).toEqual(['mcp__session__call_llm', 'Read']);
      expect(request.messages).toBe(original.messages);
      expect(request.tools?.[0]).toBe(tools[0]);
    }
    expect(original.tools).toHaveLength(3);
  });
});

it('executes legacy aliases through the real Agent registry after hiding their schemas', async () => {
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const { Type } = await import('@sinclair/typebox');
  const executed: string[] = [];
  const tools = ['mcp__session__call_llm', 'call_llm'].map(name => ({
    name, label: name, description: 'Legacy execution test', parameters: Type.Object({}),
    execute: async () => { executed.push(name); return { content: [{ type: 'text' as const, text: 'ok' }], details: {} }; },
  }));
  let requests = 0;
  const agent = new Agent({
    initialState: { model, tools, systemPrompt: 'Test' },
    streamFn: (_model, context) => createContextBudgetedStream((_model, request) => {
      expect(request.tools?.map(tool => tool.name)).toEqual(['mcp__session__call_llm']);
      const output = createAssistantMessageEventStream();
      const result = message(requests++ === 0 ? 'toolUse' : 'stop');
      if (result.stopReason === 'toolUse') result.content = [{ type: 'toolCall', id: 'legacy-call', name: 'call_llm', arguments: {} }];
      output.push({ type: 'done', reason: result.stopReason as 'toolUse' | 'stop', message: result });
      output.end(result);
      return output;
    }, model, context),
  });
  await agent.prompt('Continue the legacy call');
  expect(executed).toEqual(['call_llm']);
  expect(agent.state.tools).toHaveLength(2);
  expect(agent.state.messages.some(m => m.role === 'toolResult' && m.toolName === 'call_llm' && !m.isError)).toBe(true);
});
