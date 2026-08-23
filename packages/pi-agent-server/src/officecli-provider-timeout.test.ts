import { describe, expect, it } from 'bun:test';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { Model } from '@earendil-works/pi-ai';
import {
  createOfficecliDeadlineStreamFn,
  isOfficecliDocumentContext,
  isOfficecliDocumentTask,
  isOfficecliRetryableProviderError,
  providerRetrySettingsForTask,
} from './officecli-provider-timeout.ts';

describe('OfficeCLI provider timeout policy', () => {
  const baseline = { timeoutMs: undefined, maxRetries: undefined, maxRetryDelayMs: 60_000 };

  it('raises the HTTP idle floor for Office document turns', () => {
    expect(isOfficecliDocumentTask('...\n# OfficeCLI execution policy\n...')).toBe(true);
    expect(providerRetrySettingsForTask('...\n# OfficeCLI execution policy\n...', baseline)).toEqual({
      timeoutMs: 300_000,
      maxRetries: 0,
      maxRetryDelayMs: 5_000,
    });
  });

  it('recognizes the per-turn Skill block carried in the injected user message', () => {
    const baseSystemPrompt = 'Selection base prompt';
    expect(isOfficecliDocumentTask(`${baseSystemPrompt}\nRead /skills/officecli-execution/SKILL.md before continuing`)).toBe(true);
    expect(isOfficecliDocumentTask(`${baseSystemPrompt}\nRead /skills/officecli/SKILL.md then officecli load_skill word`)).toBe(true);
  });

  it('binds policy to the latest user turn instead of process-global prompt state', () => {
    expect(isOfficecliDocumentContext({
      messages: [
        { role: 'user', content: 'Read officecli-execution/SKILL.md', timestamp: 1 },
        { role: 'assistant', content: [], api: 'openai-completions', provider: 'test', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 },
        { role: 'user', content: 'ordinary research follow-up', timestamp: 3 },
      ],
    })).toBe(false);
    expect(isOfficecliDocumentContext({
      messages: [{ role: 'user', content: '# OfficeCLI execution policy', timestamp: 1 }],
    })).toBe(true);
  });

  it('does not inherit a shorter idle timeout than the Office floor', () => {
    expect(providerRetrySettingsForTask('# OfficeCLI execution policy', {
      timeoutMs: 30_000,
      maxRetries: 2,
      maxRetryDelayMs: 2_000,
    })).toEqual({ timeoutMs: 300_000, maxRetries: 0, maxRetryDelayMs: 2_000 });
    expect(providerRetrySettingsForTask('ordinary long-form research', baseline)).toEqual(baseline);
  });

  it('enforces an absolute stream deadline only while an OfficeCLI task is active', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    let attempts = 0;
    const neverEnding = () => {
      attempts += 1;
      return createAssistantMessageEventStream();
    };
    let active = true;
    const retryAttempts: number[] = [];
    const wrapped = createOfficecliDeadlineStreamFn(
      neverEnding,
      () => active,
      10,
      attempt => retryAttempts.push(attempt),
    );
    const result = await (await wrapped(model, { messages: [] })).result();
    expect(result.stopReason).toBe('aborted');
    expect(result.errorMessage).toContain('10ms deadline');
    expect(attempts).toBe(3);
    expect(retryAttempts).toEqual([2, 3]);

    active = false;
    const completed = createAssistantMessageEventStream();
    const doneMessage = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    const passthrough = createOfficecliDeadlineStreamFn(() => completed, () => active, 10);
    const sameStream = await passthrough(model, { messages: [] });
    expect(sameStream).toBe(completed);
    completed.push({ type: 'done', reason: 'stop', message: doneMessage });
    expect((await sameStream.result()).stopReason).toBe('stop');
  });

  it('does not retry after partial stream state has been exposed', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    let attempts = 0;
    const partial = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    const wrapped = createOfficecliDeadlineStreamFn(() => {
      attempts += 1;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial });
      stream.push({ type: 'text_start', contentIndex: 0, partial });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'visible', partial });
      return stream;
    }, () => true, 10);

    const result = await (await wrapped(model, { messages: [] })).result();
    expect(result.stopReason).toBe('aborted');
    expect(result.errorMessage).toContain('after streaming began');
    expect(attempts).toBe(1);
  });

  it('drops buffered thinking from a timed-out attempt before retrying', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const partial = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    let attempts = 0;
    const wrapped = createOfficecliDeadlineStreamFn(() => {
      attempts += 1;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial });
      if (attempts === 1) {
        stream.push({ type: 'thinking_start', contentIndex: 0, partial });
        stream.push({ type: 'thinking_delta', contentIndex: 0, delta: 'hidden', partial });
      } else {
        stream.push({ type: 'text_start', contentIndex: 0, partial });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial });
        stream.push({ type: 'text_end', contentIndex: 0, content: 'ok', partial });
        stream.push({ type: 'done', reason: 'stop', message: partial });
      }
      return stream;
    }, () => true, 10);
    const eventTypes: string[] = [];
    const stream = await wrapped(model, { messages: [] });
    for await (const event of stream) eventTypes.push(event.type);
    expect(attempts).toBe(2);
    expect(eventTypes.filter(type => type === 'start')).toHaveLength(1);
    expect(eventTypes).not.toContain('thinking_start');
  });

  it('extends the idle deadline while thinking deltas keep arriving', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const partial = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    let attempts = 0;
    const wrapped = createOfficecliDeadlineStreamFn(() => {
      attempts += 1;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        stream.push({ type: 'start', partial });
        stream.push({ type: 'thinking_start', contentIndex: 0, partial });
        for (let index = 0; index < 4; index += 1) {
          await Bun.sleep(12);
          stream.push({ type: 'thinking_delta', contentIndex: 0, delta: 'plan', partial });
        }
        stream.push({ type: 'text_start', contentIndex: 0, partial });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial });
        stream.push({ type: 'text_end', contentIndex: 0, content: 'ok', partial });
        stream.push({ type: 'done', reason: 'stop', message: partial });
      })();
      return stream;
    }, () => true, 20);

    const result = await (await wrapped(model, { messages: [] })).result();
    expect(result.stopReason).toBe('stop');
    expect(attempts).toBe(1);
  });

  it('does not retry a provider terminal error', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const message = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    let attempts = 0;
    const wrapped = createOfficecliDeadlineStreamFn(() => {
      attempts += 1;
      const failed = createAssistantMessageEventStream();
      failed.push({
        type: 'error',
        reason: 'error',
        error: { ...message, stopReason: 'error', errorMessage: 'provider failure' },
      });
      return failed;
    }, () => true, 20);
    expect((await (await wrapped(model, { messages: [] })).result()).stopReason).toBe('error');
    expect(attempts).toBe(1);
  });

  it('closes an iterator and stops consuming when the upstream user signal aborts', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const controller = new AbortController();
    let nextCalls = 0;
    let returnCalls = 0;
    let closed = false;
    const partial = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            nextCalls += 1;
            await Bun.sleep(1);
            return closed
              ? { done: true as const, value: undefined }
              : { done: false as const, value: { type: 'start', partial } };
          },
          async return() {
            returnCalls += 1;
            closed = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    const wrapped = createOfficecliDeadlineStreamFn(() => source as any, () => true, 100);
    const stream = await wrapped(model, { messages: [] }, { signal: controller.signal });
    await Bun.sleep(8);
    controller.abort();
    expect((await stream.result()).stopReason).toBe('aborted');
    const callsAtAbort = nextCalls;
    await Bun.sleep(10);
    expect(returnCalls).toBe(1);
    expect(nextCalls).toBe(callsAtAbort);
  });

  it('closes a late-resolving source without calling next after its deadline', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    let nextCalls = 0;
    let returnCalls = 0;
    const wrapped = createOfficecliDeadlineStreamFn(async () => {
      await Bun.sleep(25);
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              nextCalls += 1;
              return new Promise<never>(() => {});
            },
            async return() {
              returnCalls += 1;
              return { done: true as const, value: undefined };
            },
          };
        },
      } as any;
    }, () => true, 5);

    expect((await (await wrapped(model, { messages: [] })).result()).stopReason).toBe('aborted');
    await Bun.sleep(40);
    expect(nextCalls).toBe(0);
    expect(returnCalls).toBe(3);
  });

  it('gives the next model call a fresh idle budget after a stall', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    let attempts = 0;
    const wrapped = createOfficecliDeadlineStreamFn(
      () => {
        attempts += 1;
        return createAssistantMessageEventStream();
      },
      () => true,
      10,
    );
    const context = { messages: [{ role: 'user', content: '# OfficeCLI execution policy', timestamp: 1 }] } as any;
    const first = await (await wrapped(model, context)).result();
    expect(first.stopReason).toBe('aborted');
    expect(first.errorMessage).toContain('10ms deadline');
    expect(attempts).toBe(3);

    const second = await (await wrapped(model, context)).result();
    expect(second.stopReason).toBe('aborted');
    expect(attempts).toBe(6);
  });

  it('retries a rate-limited attempt that produced no visible output', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const message = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    let attempts = 0;
    const wrapped = createOfficecliDeadlineStreamFn(() => {
      attempts += 1;
      const stream = createAssistantMessageEventStream();
      if (attempts < 3) {
        stream.push({
          type: 'error',
          reason: 'error',
          error: { ...message, stopReason: 'error', errorMessage: '429 Too many requests - rate limit exceeded' },
        });
      } else {
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial: message });
        stream.push({ type: 'text_end', contentIndex: 0, content: 'ok', partial: message });
        stream.push({ type: 'done', reason: 'stop', message });
      }
      return stream;
    }, () => true, 50, undefined, 1);

    const result = await (await wrapped(model, { messages: [] })).result();
    expect(result.stopReason).toBe('stop');
    expect(attempts).toBe(3);
  });

  it('does not treat millisecond values as HTTP 500', () => {
    expect(isOfficecliRetryableProviderError('timeout after 15000ms')).toBe(false);
    expect(isOfficecliRetryableProviderError('429 Too many requests')).toBe(true);
    expect(isOfficecliRetryableProviderError('HTTP 503 overloaded')).toBe(true);
    expect(isOfficecliRetryableProviderError('OfficeCLI document model stream ended without a terminal event')).toBe(true);
  });

  it('does not inherit a shorter provider HTTP idle timeout', async () => {
    const model = { id: 'test', api: 'openai-completions', provider: 'test' } as Model<any>;
    const message = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    } as const;
    let seenTimeout: number | undefined;
    const wrapped = createOfficecliDeadlineStreamFn((_model, _context, options) => {
      seenTimeout = options?.timeoutMs;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    }, () => true, 300_000);

    await (await wrapped(model, { messages: [] }, { timeoutMs: 30_000 })).result();
    expect(seenTimeout).toBe(300_000);
  });
});
