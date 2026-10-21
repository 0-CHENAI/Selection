import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compact, SettingsManager, shouldCompact, type AgentSession, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { isContextOverflow } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, type Model, type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { setContextMeterDirectory } from '../../shared/src/agent/backend/pi/context-meter.ts';
import { applyCompactionSettings, compactionSettings, installCompactionPolicy, setContextCompactionConnection, shouldCompactBeforeRequest, COMPACTION_SUMMARY_MAX_TOKENS } from './compaction-policy';

setContextMeterDirectory(mkdtempSync(join(tmpdir(), 'context-meter-')));

const model: Model<'openai-responses'> = { id: 'test-model', name: 'Test', api: 'openai-responses', provider: 'openai', baseUrl: 'https://example.test', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 32768 };
const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function harness(text = '## Goal\nContinue the requested task.', stopReason: AssistantMessage['stopReason'] = 'stop') {
  const calls: { context: Context; options: SimpleStreamOptions | undefined }[] = [];
  const compactions: Array<{ kind: 'public' } | { kind: 'auto'; reason: string; willRetry: boolean }> = [];
  let listener: Parameters<AgentSession['subscribe']>[0] | undefined;
  const state: {
    compacting: boolean;
    enabled: boolean;
    keepRecentTokens: number;
    reserveTokens: number;
    agentRunActive: boolean;
    branch?: SessionEntry[];
    responseUsage?: AssistantMessage['usage'];
  } = {
    compacting: true, enabled: true, keepRecentTokens: 20_000, reserveTokens: 200_001, agentRunActive: false,
  };
  const session = {
    get isCompacting() { return state.compacting; },
    get autoCompactionEnabled() { return state.enabled; },
    model,
    settingsManager: {
      getCompactionSettings: () => ({ enabled: state.enabled, reserveTokens: state.reserveTokens, keepRecentTokens: state.keepRecentTokens }),
      applyOverrides: (overrides: { compaction?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number } }) => {
        const compaction = overrides.compaction;
        if (compaction?.enabled !== undefined) state.enabled = compaction.enabled;
        if (compaction?.reserveTokens !== undefined) state.reserveTokens = compaction.reserveTokens;
        if (compaction?.keepRecentTokens !== undefined) state.keepRecentTokens = compaction.keepRecentTokens;
      },
    },
    sessionManager: { getBranch: () => state.branch ?? [{ type: 'compaction', summary: 'User requires Chinese; pending verification of /src/task.ts.' }] },
    get _isAgentRunActive() { return state.agentRunActive; },
    compact: async () => { compactions.push({ kind: 'public' }); },
    _runAutoCompaction: async (reason: 'threshold' | 'overflow', willRetry: boolean) => {
      compactions.push({ kind: 'auto', reason, willRetry });
    },
    prompt: async () => undefined,
    subscribe: (callback: Parameters<AgentSession['subscribe']>[0]) => {
      listener = callback;
      return () => { listener = undefined; };
    },
    agent: { streamFunction: (_model: unknown, context: Context, options: SimpleStreamOptions | undefined) => {
      calls.push({ context, options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id,
        usage: state.responseUsage ?? usage, stopReason, timestamp: 1,
        ...(stopReason === 'error' || stopReason === 'aborted' ? { errorMessage: text } : {}),
      };
      if (stopReason === 'aborted' || stopReason === 'error') stream.push({ type: 'error', reason: stopReason, error: message });
      else stream.push({ type: 'done', reason: stopReason, message });
      return stream;
    } },
  } as unknown as AgentSession;
  installCompactionPolicy(session);
  return { session, calls, state, compactions,
    emitNewUser: () => listener?.({ type: 'message_start',
      message: { role: 'user', content: 'Another request', timestamp: Date.now() } }),
    emitAgentEnd: () => listener?.({ type: 'agent_end', messages: [], willRetry: false }),
  };
}
const preparation = () => ({
  firstKeptEntryId: 'recent-entry', messagesToSummarize: [{ role: 'user' as const, content: 'Fix the reported bug', timestamp: 1 }],
  turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 100_000,
  fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
  settings: { enabled: true, reserveTokens: 200_001, keepRecentTokens: 20_000 },
});
function branchMessages(messages: Context['messages']): SessionEntry[] {
  return messages.map((message, index) => ({
    type: 'message' as const, id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null,
    timestamp: new Date(index + 1).toISOString(), message,
  }));
}

describe('80% compaction policy', () => {
  it('checks the current user prompt before its first provider request', async () => {
    const { session, state, calls, compactions } = harness();
    state.compacting = false;
    state.agentRunActive = true;
    const context: Context = { messages: [
      { role: 'user', content: 'Earlier discussion: '.repeat(3000), timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer: '.repeat(3000) }],
        api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: 2 },
      { role: 'user', content: 'New prompt: '.repeat(300_000), timestamp: 3 },
    ] };
    state.branch = branchMessages(context.messages);
    expect(shouldCompactBeforeRequest(context, model.contextWindow, state.reserveTokens)).toBe(true);
    await session.agent.prepareRequest?.({ context, model, thinkingLevel: 'off' });
    expect(compactions).toEqual([{ kind: 'auto', reason: 'threshold', willRetry: false }]);
    expect(calls).toHaveLength(0);
    await session.agent.prepareRequest?.({ context, model, thinkingLevel: 'off' });
    expect(compactions).toHaveLength(1);
    const streamed = await (await session.agent.streamFunction(model, context)).result();
    expect(isContextOverflow(streamed, model.contextWindow)).toBe(false);
    expect(streamed.errorMessage ?? '').not.toContain('context_length_exceeded');
    expect(streamed.stopReason).toBe('stop');
    expect(calls).toHaveLength(1);
  });

  it('blocks a physically full request even when automatic compaction is disabled', async () => {
    const { session, state, calls } = harness();
    state.compacting = false;
    state.enabled = false;
    const smallModel = { ...model, contextWindow: 8192 };
    const short = { messages: [{ role: 'user' as const, content: 'hello', timestamp: 1 }] };
    await (await session.agent.streamFunction(smallModel, short)).result();
    expect(calls).toHaveLength(1);
    const full = { messages: [{ role: 'user' as const, content: '文'.repeat(7600), timestamp: 2 }] };
    const result = await (await session.agent.streamFunction(smallModel, full)).result();
    expect(result.errorMessage).toContain('上下文安全上限');
    expect(calls).toHaveLength(1);
  });

  it('does not reuse pre-compaction usage as the new request size', () => {
    const afterCompaction: Context = { messages: [
      { role: 'user', content: 'Compacted summary', timestamp: 100 },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { ...usage, totalTokens: 900_000 }, stopReason: 'stop', timestamp: 2 },
      { role: 'user', content: 'Continue', timestamp: 101 },
    ] };
    expect(shouldCompactBeforeRequest(afterCompaction, model.contextWindow, 200_001)).toBe(false);
    expect(shouldCompactBeforeRequest({ messages: [{ role: 'user', content: 'x'.repeat(3200), timestamp: 1 }] },
      8192, 1639)).toBe(false);
  });

  it('compacts an over-threshold tool continuation without faking a provider overflow', async () => {
    const { session, state, calls, compactions, emitNewUser } = harness();
    state.compacting = false;
    state.agentRunActive = true;
    const heavy = { ...usage, input: 800_000, totalTokens: 800_120 };
    const midTurn: Context = { messages: [
      { role: 'user', content: 'Earlier work: '.repeat(3000), timestamp: 0 },
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier result: '.repeat(1500) }],
        api: model.api, provider: model.provider, model: model.id, usage,
        stopReason: 'stop', timestamp: 0 },
      { role: 'user', content: 'Middle work: '.repeat(5000), timestamp: 0 },
      { role: 'assistant', content: [{ type: 'text', text: 'Middle result' }],
        api: model.api, provider: model.provider, model: model.id, usage,
        stopReason: 'stop', timestamp: 0 },
      { role: 'user', content: 'Do the task', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, usage: heavy,
        stopReason: 'toolUse', timestamp: 2 },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'r'.repeat(40_000) }], isError: false, timestamp: 3 },
    ] };
    state.branch = branchMessages(midTurn.messages);
    expect(shouldCompactBeforeRequest(midTurn, model.contextWindow, state.reserveTokens)).toBe(true);
    const turn = { message: midTurn.messages.at(-2) as AssistantMessage, toolResults: [], context: midTurn, newMessages: [] };
    await session.agent.prepareNextTurnWithContext?.(turn);
    expect(compactions).toEqual([{ kind: 'auto', reason: 'threshold', willRetry: false }]);
    expect(calls).toHaveLength(0);

    await session.agent.prepareNextTurnWithContext?.(turn);
    expect(compactions).toHaveLength(1);
    emitNewUser();
    await session.agent.prepareNextTurnWithContext?.(turn);
    expect(compactions).toHaveLength(1);

    const streamed = await (await session.agent.streamFunction(model, midTurn)).result();
    expect(isContextOverflow(streamed, model.contextWindow)).toBe(false);
    expect(streamed.errorMessage ?? '').not.toContain('context_length_exceeded');
    expect(streamed.stopReason).toBe('stop');
    expect(calls).toHaveLength(1);

    const freshTurn: Context = { messages: [{ role: 'user', content: 'Do the task', timestamp: 4 }] };
    await session.agent.prepareRequest?.({ context: freshTurn, model, thinkingLevel: 'off' });
    expect(shouldCompactBeforeRequest(freshTurn, model.contextWindow, state.reserveTokens)).toBe(false);
    expect(compactions).toHaveLength(1);
    state.enabled = false;
    await session.agent.prepareNextTurnWithContext?.(turn);
    expect(compactions).toHaveLength(1);

    const fixedPromptDominates: Context = {
      systemPrompt: 's'.repeat(360_000),
      messages: [
        { role: 'user', content: 'Do the task', timestamp: 1 },
        { role: 'toolResult', toolCallId: 'call-1', toolName: 'read',
          content: [{ type: 'text', text: 'short' }], isError: false, timestamp: 3 },
      ],
    };
    expect(shouldCompactBeforeRequest(fixedPromptDominates, 100_000, 20_001)).toBe(true);
  });
  it('allows a safe request above 80% when the saved branch has no useful history to fold', async () => {
    const { session, state, calls } = harness();
    state.compacting = false;
    const context: Context = { messages: [
      { role: 'user', content: 'Read this', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, usage: { ...usage, input: 800_000, totalTokens: 800_000 },
        stopReason: 'toolUse', timestamp: 2 },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'read',
        content: [{ type: 'text', text: 'r'.repeat(100_000) }], isError: false, timestamp: 3 },
    ] };
    expect(shouldCompactBeforeRequest(context, model.contextWindow, state.reserveTokens)).toBe(true);
    state.branch = branchMessages(context.messages);
    const result = await (await session.agent.streamFunction(model, context)).result();
    expect(result.stopReason).toBe('stop');
    expect(calls).toHaveLength(1);

    state.branch = [];
    await (await session.agent.streamFunction(model, context)).result();
    expect(calls).toHaveLength(2);
  });
  it('reports the context limit once when the protected tool chain cannot fit', async () => {
    const { session, state, calls } = harness();
    state.compacting = false;
    const small = { ...model, contextWindow: 16_384 };
    const context: Context = { messages: [
      { role: 'user', content: 'Read this', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'toolUse', timestamp: 2 },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'read',
        content: [{ type: 'text', text: 'r'.repeat(80_000) }], isError: false, timestamp: 3 },
    ] };
    state.branch = branchMessages(context.messages);
    const first = await (await session.agent.streamFunction(small, context)).result();
    const second = await (await session.agent.streamFunction(small, context)).result();
    expect(first.errorMessage).toContain('上下文安全上限');
    expect(second.errorMessage).toContain('上下文安全上限');
    expect(calls).toHaveLength(0);
  });
  it('uses the SDK cut point before an oversized tool pair while preserving the pair', async () => {
    const { session, state, calls, compactions } = harness();
    state.compacting = false;
    state.agentRunActive = true;
    const context: Context = { messages: [
      { role: 'user', content: 'Old task: '.repeat(4000), timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'Old result' }], api: model.api,
        provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: 2 },
      { role: 'user', content: 'Read this', timestamp: 3 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, usage: { ...usage, input: 800_000, totalTokens: 800_000 },
        stopReason: 'toolUse', timestamp: 4 },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'read',
        content: [{ type: 'text', text: 'r'.repeat(100_000) }], isError: false, timestamp: 5 },
    ] };
    state.branch = branchMessages(context.messages);
    expect(shouldCompactBeforeRequest(context, model.contextWindow, state.reserveTokens)).toBe(true);
    const turn = { message: context.messages.at(-2) as AssistantMessage, toolResults: [], context, newMessages: [] };
    await session.agent.prepareNextTurnWithContext?.(turn);
    expect(compactions).toEqual([{ kind: 'auto', reason: 'threshold', willRetry: false }]);
    const response = await (await session.agent.streamFunction(model, context)).result();
    expect(isContextOverflow(response, model.contextWindow)).toBe(false);
    expect(response.errorMessage ?? '').not.toContain('context_length_exceeded');
    expect(calls).toHaveLength(1);
  });
  it('restores the trigger after SDK settings saves and reloads while preserving the enabled state', async () => {
    const manager = SettingsManager.inMemory();
    const window = 262_144;
    const threshold = Math.floor(window * 0.8);
    applyCompactionSettings(manager, window, true);
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(true);

    // Startup enables compaction after creating the session. The SDK save
    // rebuilds effective settings and otherwise loses the temporary override.
    manager.setCompactionEnabled(true);
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(false);
    applyCompactionSettings(manager, window, true);
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(true);

    manager.setDefaultThinkingLevel('high');
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(false);
    applyCompactionSettings(manager, window, true);
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(true);

    await manager.reload();
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(false);
    applyCompactionSettings(manager, window, true);
    expect(shouldCompact(threshold, window, manager.getCompactionSettings())).toBe(true);

    manager.setCompactionEnabled(false);
    applyCompactionSettings(manager, window, false);
    expect(manager.getCompactionSettings().enabled).toBe(false);

    // A small Swarm agent must regain its smaller retention budget before
    // either automatic or manual compaction prepares a checkpoint.
    manager.setCompactionEnabled(true);
    expect(manager.getCompactionSettings().keepRecentTokens).toBe(20_000);
    applyCompactionSettings(manager, 1_000_000, true, 8192);
    expect(manager.getCompactionSettings().keepRecentTokens).toBeLessThan(8192);
  });
  it('restores settings on tool continuations and before Pi checks agent_end', async () => {
    const { session, state, emitAgentEnd } = harness();
    state.compacting = false;
    state.reserveTokens = 16_384;
    await (await session.agent.streamFunction(model, { messages: [{ role: 'user', content: 'Continue', timestamp: 1 }] })).result();
    expect(state.reserveTokens).toBe(200_001);
    state.reserveTokens = 16_384;
    emitAgentEnd();
    expect(state.reserveTokens).toBe(200_001);
    state.enabled = false;
    state.reserveTokens = 16_384;
    emitAgentEnd();
    expect(state.enabled).toBe(false);
    expect(state.reserveTokens).toBe(200_001);
  });
  it('triggers inclusively at 80%, retaining bounded recent history for small and large models', () => {
    for (const window of [8192, 131072, 262144, 1_000_000]) {
      const settings = { enabled: true, ...compactionSettings(window)! };
      const threshold = Math.floor(window * 0.8);
      expect(shouldCompact(threshold - 1, window, settings)).toBe(false);
      expect(shouldCompact(threshold, window, settings)).toBe(true);
      expect(settings.keepRecentTokens).toBeLessThan(threshold);
      expect(settings.keepRecentTokens).toBeLessThanOrEqual(20_000);
      expect(settings.keepRecentTokens).toBe(Math.min(20_000, Math.floor(threshold / 8)));
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
    expect(getCurrentSystemPrompt(calls[0]!.context.messages)).toContain('constraints and permissions');
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
    const summaryPrompt = getCurrentSystemPrompt(calls[0]!.context.messages);
    expect(summaryPrompt).toContain('constraints and permissions');
    expect(summaryPrompt).not.toContain('pending verification of /src/task.ts');
    expect(JSON.stringify(calls[0]!.context.messages)).toContain('pending verification of /src/task.ts');
  });
  it('uses public compact while idle and leaves a real provider overflow untouched', async () => {
    const idle = harness();
    idle.state.compacting = false;
    idle.state.branch = branchMessages([
      { role: 'user', content: 'Earlier discussion: '.repeat(3000), timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer: '.repeat(3000) }],
        api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: 2 },
      { role: 'user', content: 'New prompt: '.repeat(300_000), timestamp: 3 },
    ]);
    await idle.session.prompt('New prompt: '.repeat(300_000));
    expect(idle.compactions).toEqual([{ kind: 'public' }]);

    const provider = harness('context_length_exceeded: provider rejected the prompt', 'error');
    provider.state.compacting = false;
    const result = await (await provider.session.agent.streamFunction(model, {
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    })).result();
    expect(isContextOverflow(result, model.contextWindow)).toBe(true);
    expect(result.errorMessage).toContain('context_length_exceeded');
    expect(provider.calls).toHaveLength(1);
    expect(provider.compactions).toEqual([]);
  });

  it('drops a stored usage anchor when the branch, model, or connection changes', async () => {
    const heavy = { ...usage, input: 800_000, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 800_035 };
    const context: Context = { messages: [
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: model.api, provider: model.provider,
        model: model.id, usage, stopReason: 'stop', timestamp: 1 },
    ] };
    const usefulBranch = branchMessages([
      { role: 'user', content: 'old '.repeat(2_000), timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'kept' }], api: model.api, provider: model.provider,
        model: model.id, usage, stopReason: 'stop', timestamp: 2 },
      { role: 'user', content: 'x'.repeat(200_000), timestamp: 3 },
    ]);
    const observed = harness();
    observed.state.compacting = false;
    observed.state.agentRunActive = true;
    observed.state.responseUsage = heavy;
    observed.state.branch = usefulBranch;
    await (await observed.session.agent.streamFunction(model, context)).result();
    await observed.session.agent.prepareRequest?.({ context, model, thinkingLevel: 'off' });
    expect(observed.compactions).toEqual([{ kind: 'auto', reason: 'threshold', willRetry: false }]);

    const edited = harness();
    edited.state.compacting = false;
    edited.state.agentRunActive = true;
    edited.state.responseUsage = heavy;
    edited.state.branch = usefulBranch;
    await (await edited.session.agent.streamFunction(model, context)).result();
    edited.state.branch = [...usefulBranch, { type: 'context_edit', id: 'edit-1', parentId: 'entry-2', timestamp: new Date().toISOString(), targetId: 'entry-1', replacement: null } as SessionEntry];
    await edited.session.agent.prepareRequest?.({ context, model, thinkingLevel: 'off' });
    expect(edited.compactions).toEqual([]);

    const switched = harness();
    switched.state.compacting = false;
    switched.state.agentRunActive = true;
    switched.state.responseUsage = heavy;
    switched.state.branch = usefulBranch;
    await (await switched.session.agent.streamFunction(model, context)).result();
    const other = { ...model, id: 'other-model' };
    await switched.session.agent.prepareRequest?.({ context, model: other, thinkingLevel: 'off' });
    expect(switched.compactions).toEqual([]);

    const moved = harness();
    moved.state.compacting = false;
    moved.state.agentRunActive = true;
    moved.state.responseUsage = heavy;
    moved.state.branch = usefulBranch;
    await (await moved.session.agent.streamFunction(model, context)).result();
    setContextCompactionConnection('other-connection', { piAuthProvider: 'anthropic' });
    await moved.session.agent.prepareRequest?.({ context, model, thinkingLevel: 'off' });
    expect(moved.compactions).toEqual([]);
    setContextCompactionConnection('', {});
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
  expect(JSON.stringify(calls[0]!.context.messages)).not.toContain('<previous-checkpoint>');
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
    const session = { isCompacting: true, subscribe: () => () => {}, sessionManager: { getBranch: () => [] },
      settingsManager: { getCompactionSettings: () => ({ keepRecentTokens: 20_000 }) }, agent: { streamFunction: () => (async function* () {
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
