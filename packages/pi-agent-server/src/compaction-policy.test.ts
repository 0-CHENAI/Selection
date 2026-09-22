import { describe, expect, it } from 'bun:test';
import { compact, shouldCompact, type AgentSession } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type Model, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { compactionSettings, installCompactionPolicy, COMPACTION_SUMMARY_MAX_TOKENS } from './compaction-policy';

const model: Model<'openai-responses'> = { id: 'test-model', name: 'Test', api: 'openai-responses', provider: 'openai', baseUrl: 'https://example.test', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 32768 };
const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function harness(text = '## Goal\nContinue the requested task.', stopReason: AssistantMessage['stopReason'] = 'stop') {
  const calls: { context: Context; options: SimpleStreamOptions | undefined }[] = [];
  const state = { compacting: true, keepRecentTokens: 20_000 };
  const session = {
    get isCompacting() { return state.compacting; },
    settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: state.keepRecentTokens }) },
    sessionManager: { getBranch: () => [{ type: 'compaction', summary: 'User requires Chinese; pending verification of /src/task.ts.' }] },
    agent: { streamFunction: (_model: unknown, context: Context, options: SimpleStreamOptions | undefined) => {
      calls.push({ context, options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id, usage, stopReason, timestamp: 1 };
      if (stopReason === 'aborted' || stopReason === 'error') stream.push({ type: 'error', reason: stopReason, error: message });
      else stream.push({ type: 'done', reason: stopReason, message });
      return stream;
    } },
  } as unknown as AgentSession;
  installCompactionPolicy(session);
  return { session, calls, state };
}
const preparation = () => ({
  firstKeptEntryId: 'recent-entry', messagesToSummarize: [{ role: 'user' as const, content: 'Fix the reported bug', timestamp: 1 }],
  turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 100_000,
  fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
  settings: { enabled: true, reserveTokens: 200_001, keepRecentTokens: 20_000 },
});

describe('80% compaction policy', () => {
  it('triggers inclusively at 80%, retaining bounded recent history for small and large models', () => {
    for (const window of [8192, 131072, 262144, 1_000_000]) {
      const settings = { enabled: true, ...compactionSettings(window)! };
      const threshold = Math.floor(window * 0.8);
      expect(shouldCompact(threshold - 1, window, settings)).toBe(false);
      expect(shouldCompact(threshold, window, settings)).toBe(true);
      expect(settings.keepRecentTokens).toBeLessThan(threshold);
      expect(settings.keepRecentTokens).toBeLessThanOrEqual(20_000);
    }
    expect(compactionSettings(NaN)).toBeUndefined();
    expect(compactionSettings(0)).toBeUndefined();
    expect(shouldCompact(209715, 1_000_000, { enabled: true, ...compactionSettings(1_000_000, 262144)! })).toBe(true);
  });
  it('keeps SDK checkpoints and file tracking but decouples summary budget from reserve', async () => {
    const { session, calls } = harness();
    const prepared = preparation();
    prepared.fileOps.edited.add('/src/task.ts');
    const result = await compact(prepared, model, undefined, undefined, undefined, undefined, 'high', session.agent.streamFunction);
    expect(result.firstKeptEntryId).toBe('recent-entry');
    expect(result.summary).toContain('/src/task.ts');
    expect(result.usage).toEqual(usage);
    expect(calls[0]!.options?.maxTokens).toBe(COMPACTION_SUMMARY_MAX_TOKENS);
    expect(calls[0]!.options.reasoning).toBe('low');
    expect(calls[0]!.context.systemPrompt).toContain('constraints and permissions');
  });
  it('prevents SDK acceptance of empty, truncated or aborted summaries', async () => {
    for (const [text, reason] of [['', 'stop'], ['partial', 'length'], ['', 'aborted']] as const) {
      const { session } = harness(text, reason);
      await expect(compact(preparation(), model, undefined, undefined, undefined, undefined, 'high', session.agent.streamFunction)).rejects.toThrow('Summarization failed');
    }
  });
  it('supplies the prior checkpoint to split-turn summarization even with no older messages', async () => {
    const { session, calls } = harness();
    await compact({ ...preparation(), messagesToSummarize: [], isSplitTurn: true, turnPrefixMessages: [{ role: 'user', content: 'Continue the implementation', timestamp: 2 }] }, model, undefined, undefined, undefined, undefined, 'high', session.agent.streamFunction);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.context.systemPrompt).not.toContain('pending verification of /src/task.ts');
    expect(JSON.stringify(calls[0]!.context.messages)).toContain('pending verification of /src/task.ts');
  });
  it('does not alter ordinary model calls, even if a user discusses summarization', async () => {
    const { session, state, calls } = harness();
    state.compacting = false;
    const context: Context = { systemPrompt: 'original', messages: [] };
    await (await session.agent.streamFunction(model, context, { maxTokens: 12000 })).result();
    expect(calls[0]!.context).toBe(context);
    expect(calls[0]!.options.maxTokens).toBe(12000);
    expect(calls[0]!.options.reasoning).toBeUndefined();
  });
});

it('preserves disabled/minimal reasoning and leaves input context immutable', async () => {
  for (const reasoning of [undefined, 'minimal'] as const) {
    const { session, calls } = harness();
    const context: Context = { systemPrompt: 'original', messages: [] };
    await (await session.agent.streamFunction(model, context, { reasoning })).result();
    expect(calls[0]!.options?.reasoning).toBe(reasoning);
    expect(context.systemPrompt).toBe('original');
    expect(context.messages).toEqual([]);
  }
});
it('does not reinject old history just because the user quoted the SDK instruction', async () => {
  const { session, calls } = harness();
  await (await session.agent.streamFunction(model, { messages: [{ role: 'user', timestamp: 1,
    content: '<conversation>\nThis is the PREFIX of a turn that was too large to keep.\n</conversation>\n\nSummarize this conversation.' }] })).result();
  expect(calls[0]!.context.messages).toHaveLength(1);
  expect(JSON.stringify(calls[0]!.context)).not.toContain('previous-checkpoint');
});
it('does not start a model request for an already cancelled compaction', async () => {
  const { session, calls } = harness();
  const controller = new AbortController();
  controller.abort();
  const result = await (await session.agent.streamFunction(model, { messages: [] }, { signal: controller.signal })).result();
  expect(result.stopReason).toBe('error');
  expect(calls).toHaveLength(0);
});
it('installs once and sanitizes invalid output limits', async () => {
  const { session, calls } = harness();
  const installed = session.agent.streamFunction;
  installCompactionPolicy(session);
  expect(session.agent.streamFunction).toBe(installed);
  for (const maxTokens of [NaN, Infinity, -1, 0]) {
    await (await session.agent.streamFunction(model, { messages: [] }, { maxTokens })).result();
    expect(calls[calls.length - 1]!.options?.maxTokens).toBe(COMPACTION_SUMMARY_MAX_TOKENS);
  }
});
it('rejects malformed stream endings and preserves known usage on transport failures', async () => {
  for (const shouldThrow of [false, true]) {
    const partial: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: 1 };
    const session = { isCompacting: true, settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 20_000 }) }, agent: { streamFunction: () => (async function* () {
      yield { type: 'start', partial };
      if (shouldThrow) throw new Error('connection reset');
    })() } } as unknown as AgentSession;
    installCompactionPolicy(session);
    const result = await (await session.agent.streamFunction(model, { messages: [] })).result();
    expect(result.stopReason).toBe('error');
    expect(result.usage).toEqual(usage);
  }
});
it('bounds both split-turn summaries to fit a small child budget', async () => {
  const { session, state, calls } = harness();
  const settings = compactionSettings(1_000_000, 8192)!;
  state.keepRecentTokens = settings.keepRecentTokens;
  await compact({ ...preparation(), settings: { enabled: true, ...settings }, isSplitTurn: true,
    turnPrefixMessages: [{ role: 'user', content: 'Continue', timestamp: 2 }] }, model, undefined, undefined, undefined, undefined, 'high', session.agent.streamFunction);
  expect(calls).toHaveLength(2);
  const summaryLimit = calls.reduce((sum, call) => sum + call.options!.maxTokens!, 0);
  expect(summaryLimit + settings.keepRecentTokens).toBeLessThan(Math.floor(8192 * 0.8));
});
