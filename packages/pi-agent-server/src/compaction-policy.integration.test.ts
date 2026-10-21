import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, type AssistantMessage, type Context, type Model } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { installContextBudgetGuard } from './context-budget-stream.ts';
import { applyCompactionSettings, COMPACTION_FOCUS, installCompactionPolicy, PROTECTED_TOOL_CHAIN_STEPS } from './compaction-policy.ts';
import { snapshotContextBreakdown } from './context-breakdown.ts';
import { PiEventAdapter } from '../../shared/src/agent/backend/pi/event-adapter.ts';
import { setContextMeterDirectory } from '../../shared/src/agent/backend/pi/context-meter.ts';

const model: Model<'openai-responses'> = {
  id: 'offline-compaction-test', name: 'Offline compaction test', api: 'openai-responses',
  provider: 'openai', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096,
};
const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const tempDirs: string[] = [];
beforeEach(() => {
  const meterDir = mkdtempSync(join(tmpdir(), 'selection-meter-'));
  tempDirs.push(meterDir);
  setContextMeterDirectory(meterDir);
});
afterEach(() => {
  setContextMeterDirectory(undefined);
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('an oversized first input stays intact and delivers one actionable error without provider or compaction requests', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-input-limit-'));
  tempDirs.push(cwd);
  let providerCalls = 0;
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: () => { providerCalls++; throw new Error('Oversized input must not reach the provider'); },
  } as unknown as ModelRuntime;
  installContextBudgetGuard(runtime);
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', noTools: 'all',
    modelRuntime: runtime, settingsManager, sessionManager,
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, model.contextWindow, true);
  installCompactionPolicy(session);
  const adapter = new PiEventAdapter();
  adapter.setContextWindow(model.contextWindow);
  adapter.startTurn();
  const errors: string[] = [];
  let compactions = 0;
  session.subscribe(event => {
    if (event.type === 'compaction_start') compactions++;
    for (const adapted of adapter.adaptEvent(event as Parameters<typeof adapter.adaptEvent>[0])) {
      if (adapted.type === 'typed_error') errors.push(adapted.error.code);
      if (adapted.type === 'error') errors.push('untyped');
    }
  });
  const input = '原始用户输入\r\n```text\n' + '文'.repeat(240_000) + '\n```\n[文件](E:/项目/文件.txt)';
  await session.prompt(input);
  expect(providerCalls).toBe(0);
  expect(compactions).toBe(0);
  expect(errors).toEqual(['context_limit']);
  expect(adapter.shouldCompleteQueue(true)).toBe(true);
  const users = sessionManager.buildSessionContext().messages.filter(message => message.role === 'user');
  expect(users).toHaveLength(1);
  expect(users[0]!.content).toEqual([{ type: 'text', text: input }]);
});

it('the real Pi session compacts at the request gate and resumes the same prompt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-compaction-'));
  tempDirs.push(cwd);
  const providerCalls: Array<{ summary: boolean; context: Context }> = [];
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (_model: typeof model, context: Context) => {
      const summary = getCurrentSystemPrompt(context.messages).includes(COMPACTION_FOCUS);
      providerCalls.push({ summary, context });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant', content: [{ type: 'text', text: summary
          ? '## Goal\nContinue the current request.\n## Progress\nEarlier work summarized.'
          : 'Recovered answer' }],
        api: model.api, provider: model.provider, model: model.id, usage,
        stopReason: 'stop', timestamp: Date.now(),
      };
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', noTools: 'all',
    modelRuntime: runtime, settingsManager, sessionManager,
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, model.contextWindow, true);
  installCompactionPolicy(session);

  for (const [index, length] of [100_000, 40_000, 40_000].entries()) {
    sessionManager.appendMessage({ role: 'user', content: `Earlier turn ${index}: ${'文'.repeat(length)}`, timestamp: index * 2 + 1 });
    sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }],
      api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop',
      timestamp: index * 2 + 2 });
  }
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  const events: string[] = [];
  let postCompactionMessages = 0;
  session.subscribe(event => {
    if (event.type === 'compaction_start') events.push(`start:${event.reason}`);
    if (event.type === 'compaction_end') {
      events.push(`end:${event.reason}:${!!event.result}`);
      if (event.result) postCompactionMessages = snapshotContextBreakdown(session)?.messages ?? 0;
    }
  });

  await session.prompt('Continue the same request');

  expect(events).toContain('start:manual');
  expect(events).toContain('end:manual:true');
  expect(postCompactionMessages).toBeGreaterThan(0);
  expect(providerCalls.map(call => call.summary)).toEqual([true, false]);
  expect(providerCalls[1]!.context.messages.some(message => message.role === 'user'
    && JSON.stringify(message.content).includes('Continue the same request'))).toBe(true);
  expect(session.sessionManager.getBranch().some(entry => entry.type === 'compaction')).toBe(true);
});


it('the real SDK preserves tool pairs across mid-turn compaction and never re-executes completed work', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-tool-compaction-'));
  tempDirs.push(cwd);
  let executed = 0, modelRequests = 0, summaries = 0;
  const lifecycle: string[] = [];
  const requests: Context[] = [];
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (_model: typeof model, context: Context) => {
      const summary = getCurrentSystemPrompt(context.messages).includes(COMPACTION_FOCUS);
      if (summary) { summaries++; lifecycle.push('summary'); }
      else { modelRequests++; lifecycle.push(`model-${modelRequests}`); requests.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) }); }
      const callTool = !summary && modelRequests === 1;
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: callTool
          ? [{ type: 'thinking', thinking: 'Process reasoning. '.repeat(200) }, { type: 'toolCall', id: 'read-once', name: 'checkpoint_read', arguments: {} }]
          : [{ type: 'text', text: summary ? 'Preserve the current task. The read tool completed; continue with its result.' : 'Final response' }],
        usage: callTool ? { ...usage, input: 154900, output: 100, totalTokens: 155000 } : usage,
        stopReason: callTool ? 'toolUse' : 'stop', timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: callTool ? 'toolUse' : 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;
  installContextBudgetGuard(runtime);
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', modelRuntime: runtime,
    settingsManager, sessionManager, tools: ['checkpoint_read'],
    customTools: [{ name: 'checkpoint_read', label: 'Read', description: 'Read-only fixture', parameters: Type.Object({}),
      execute: async () => { executed++; lifecycle.push('tool-complete'); return { content: [{ type: 'text' as const, text: '文'.repeat(6000) }], details: {} }; } }],
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, model.contextWindow, true);
  installCompactionPolicy(session);
  session.subscribe(event => {
    if (event.type === 'compaction_start') lifecycle.push('compaction-start');
    if (event.type === 'compaction_end' && event.result) lifecycle.push('compaction-end');
  });
  for (let index = 0; index < 3; index++) {
    sessionManager.appendMessage({ role: 'user', content: '文'.repeat(40000), timestamp: index * 2 + 1 });
    sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Earlier work' }],
      api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: index * 2 + 2 });
  }
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  await session.prompt('Use the read tool, then answer the same user task');
  expect(executed).toBe(1);
  expect(modelRequests).toBe(2);
  expect(summaries).toBeGreaterThan(0);
  expect(lifecycle).toContain('compaction-start');
  expect(lifecycle).toContain('compaction-end');
  expect(lifecycle.indexOf('model-1')).toBeLessThan(lifecycle.indexOf('tool-complete'));
  expect(lifecycle.indexOf('tool-complete')).toBeLessThan(lifecycle.indexOf('compaction-start'));
  expect(lifecycle.indexOf('compaction-start')).toBeLessThan(lifecycle.indexOf('summary'));
  expect(lifecycle.indexOf('compaction-end')).toBeLessThan(lifecycle.indexOf('model-2'));
  expect(session.sessionManager.getBranch().some(entry => entry.type === 'compaction')).toBe(true);
  for (const request of requests) {
    const pending = new Set<string>();
    for (const message of request.messages) {
      if (message.role === 'assistant') {
        for (const block of message.content) if (block.type === 'toolCall') pending.add(block.id);
      } else if (message.role === 'toolResult') {
        expect(pending.has(message.toolCallId)).toBe(true);
        pending.delete(message.toolCallId);
      }
    }
    expect(pending.size).toBe(0);
  }
  expect(requests.at(-1)!.messages.some(message => message.role === 'user'
    && JSON.stringify(message.content).includes('same user task'))).toBe(true);
});

function messageText(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap(part => part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('');
}

function toolCallIdsOf(messages: Context['messages']): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) if (block.type === 'toolCall') ids.push(block.id);
  }
  return ids;
}

it('mid-turn compaction keeps the current user message and the newest tool chain verbatim', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-chain-compaction-'));
  tempDirs.push(cwd);
  const userText = '当前任务：保护进行中的工具链，并保留思考签名';
  const issued = new Map<string, AssistantMessage['content']>();
  const payloads = new Map<string, string>();
  const executedIds: string[] = [];
  const requests: Context[] = [];
  const lifecycle: string[] = [];
  let steps = 0;
  let summaries = 0;
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (_model: typeof model, context: Context) => {
      const summary = getCurrentSystemPrompt(context.messages).includes(COMPACTION_FOCUS);
      const stream = createAssistantMessageEventStream();
      if (summary) {
        summaries++;
        lifecycle.push('summary');
        stream.push({ type: 'done', reason: 'stop', message: {
          role: 'assistant', content: [{ type: 'text', text: '## Goal\nContinue the current user task.\n## Progress\nOlder tool steps were folded.' }],
          api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now(),
        } });
        return stream;
      }
      requests.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      lifecycle.push(`model-${requests.length}`);
      const compacted = context.messages.some(message => message.role === 'user' && messageText(message).includes('<summary>'));
      if (compacted || steps >= 6) {
        stream.push({ type: 'done', reason: 'stop', message: {
          role: 'assistant', content: [{ type: 'text', text: 'Final response' }],
          api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now(),
        } });
        return stream;
      }
      const id = `chain-${steps}`;
      const kind = steps % 3;
      const thinking = kind === 0
        ? { type: 'thinking' as const, thinking: `anthropic-${id}`, thinkingSignature: `sig_${id}` }
        : kind === 1
          ? { type: 'thinking' as const, thinking: '[Reasoning redacted]', thinkingSignature: `redacted_${id}`, redacted: true }
          : { type: 'thinking' as const, thinking: `deepseek-${id}`, thinkingSignature: 'reasoning_content' };
      // Dots stay on the chars/4 estimator. A base64-alphabet run is priced as dense text and
      // crosses the window before four tool steps exist.
      const chars = 180_000;
      const payload = `${id}|` + '.'.repeat(chars) + `|${id}`;
      payloads.set(id, payload);
      const content: AssistantMessage['content'] = [
        thinking,
        { type: 'toolCall', id, name: 'chain_read', arguments: { marker: id, chars } },
      ];
      issued.set(id, content);
      steps++;
      stream.push({ type: 'done', reason: 'toolUse', message: {
        role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
        usage, stopReason: 'toolUse', timestamp: Date.now(),
      } });
      return stream;
    },
  } as unknown as ModelRuntime;
  installContextBudgetGuard(runtime);
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', modelRuntime: runtime,
    settingsManager, sessionManager, tools: ['chain_read'],
    customTools: [{ name: 'chain_read', label: 'Read', description: 'Read-only fixture',
      parameters: Type.Object({ marker: Type.String(), chars: Type.Number() }),
      execute: async (_id, args) => {
        const marker = String((args as { marker?: string }).marker ?? '');
        executedIds.push(marker);
        lifecycle.push('tool-complete');
        return { content: [{ type: 'text' as const, text: payloads.get(marker) ?? '' }], details: {} };
      } }],
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, model.contextWindow, true);
  installCompactionPolicy(session);
  session.subscribe(event => {
    if (event.type === 'compaction_start') lifecycle.push('compaction-start');
    if (event.type === 'compaction_end' && event.result) lifecycle.push('compaction-end');
  });
  await session.prompt(userText);

  expect(steps).toBeGreaterThan(PROTECTED_TOOL_CHAIN_STEPS);
  expect(executedIds).toEqual([...issued.keys()]);
  expect(summaries).toBeGreaterThan(0);
  expect(lifecycle).toContain('compaction-start');
  expect(lifecycle).toContain('compaction-end');
  expect(lifecycle.indexOf('tool-complete')).toBeLessThan(lifecycle.indexOf('compaction-start'));
  expect(lifecycle.indexOf('compaction-end')).toBeLessThan(lifecycle.lastIndexOf(`model-${requests.length}`));
  const resumed = requests.find(request => request.messages.some(message => message.role === 'user' && messageText(message).includes('<summary>')));
  expect(resumed).toBeTruthy();
  const resumedMessages = resumed!.messages;
  expect(resumedMessages.some(message => message.role === 'user'
    && messageText(message).includes(userText) && !messageText(message).includes('<summary>'))).toBe(true);
  const keptIds = [...issued.keys()].slice(-PROTECTED_TOOL_CHAIN_STEPS);
  const droppedIds = [...issued.keys()].slice(0, -PROTECTED_TOOL_CHAIN_STEPS);
  expect(droppedIds.length).toBeGreaterThan(0);
  expect(toolCallIdsOf(resumedMessages)).toEqual(keptIds);
  for (const id of droppedIds) expect(toolCallIdsOf(resumedMessages)).not.toContain(id);
  const signatures = new Set<string>();
  let sawRedacted = false;
  for (const id of keptIds) {
    const assistant = resumedMessages.find(message => message.role === 'assistant' && toolCallIdsOf([message]).includes(id));
    expect(assistant && 'content' in assistant ? assistant.content : undefined).toEqual(issued.get(id));
    const result = resumedMessages.find(message => message.role === 'toolResult' && message.toolCallId === id);
    expect(result ? messageText(result) : '').toBe(payloads.get(id));
    for (const block of issued.get(id) ?? []) {
      if (block.type !== 'thinking') continue;
      if (block.thinkingSignature) signatures.add(block.thinkingSignature);
      if (block.redacted) sawRedacted = true;
    }
  }
  expect(signatures.has('reasoning_content')).toBe(true);
  expect([...signatures].some(signature => signature.startsWith('sig_'))).toBe(true);
  expect(sawRedacted).toBe(true);
  const pending = new Set<string>();
  for (const message of resumedMessages) {
    if (message.role === 'assistant') {
      for (const block of message.content) if (block.type === 'toolCall') pending.add(block.id);
    } else if (message.role === 'toolResult') {
      expect(pending.has(message.toolCallId)).toBe(true);
      pending.delete(message.toolCallId);
    }
  }
  expect(pending.size).toBe(0);
});

it('a giant in-progress tool result keeps the actionable context limit instead of compacting forever', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-giant-tool-'));
  tempDirs.push(cwd);
  const narrow = { ...model, id: 'offline-giant-tool', contextWindow: 32_000, maxTokens: 1024 };
  let executed = 0;
  let modelRequests = 0;
  let summaries = 0;
  let compactions = 0;
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === narrow.provider && modelId === narrow.id ? narrow : undefined,
    streamSimple: (_model: typeof narrow, context: Context) => {
      const summary = getCurrentSystemPrompt(context.messages).includes(COMPACTION_FOCUS);
      if (summary) summaries++;
      else modelRequests++;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: modelRequests === 1 && !summary ? 'toolUse' : 'stop', message: {
        role: 'assistant', api: narrow.api, provider: narrow.provider, model: narrow.id, usage,
        content: modelRequests === 1 && !summary
          ? [{ type: 'toolCall', id: 'giant-read', name: 'chain_read', arguments: {} }]
          : [{ type: 'text', text: 'should not run' }],
        stopReason: modelRequests === 1 && !summary ? 'toolUse' : 'stop', timestamp: Date.now(),
      } });
      return stream;
    },
  } as unknown as ModelRuntime;
  installContextBudgetGuard(runtime);
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model: narrow, thinkingLevel: 'off', modelRuntime: runtime,
    settingsManager, sessionManager, tools: ['chain_read'],
    customTools: [{ name: 'chain_read', label: 'Read', description: 'Read-only fixture', parameters: Type.Object({}),
      execute: async () => { executed++; return { content: [{ type: 'text' as const, text: 'r'.repeat(200_000) }], details: {} }; } }],
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, narrow.contextWindow, true);
  installCompactionPolicy(session);
  const adapter = new PiEventAdapter();
  adapter.setContextWindow(narrow.contextWindow);
  adapter.startTurn();
  const errors: string[] = [];
  session.subscribe(event => {
    if (event.type === 'compaction_start') compactions++;
    for (const adapted of adapter.adaptEvent(event as Parameters<typeof adapter.adaptEvent>[0])) {
      if (adapted.type === 'typed_error') errors.push(adapted.error.code);
    }
  });
  await session.prompt('读取这个超大结果');
  expect(executed).toBe(1);
  expect(modelRequests).toBe(1);
  expect(summaries).toBeLessThanOrEqual(1);
  expect(compactions).toBeLessThanOrEqual(1);
  expect(errors).toEqual(['context_limit']);
});

it('compacts after a completed tool before its next provider request', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-native-compaction-'));
  tempDirs.push(cwd);
  const lifecycle: string[] = [];
  let modelRequests = 0;
  let toolExecutions = 0;
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (_model: typeof model, context: Context) => {
      const summary = getCurrentSystemPrompt(context.messages).includes('You are a context summarization assistant');
      lifecycle.push(summary ? 'summary' : `model-${++modelRequests}`);
      const callTool = !summary && modelRequests === 1;
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: callTool
          ? [{ type: 'toolCall', id: 'native-read', name: 'checkpoint_read', arguments: {} }]
          : [{ type: 'text', text: summary ? '## Goal\nContinue the current user task.\n## Progress\nTool completed.' : 'Final response' }],
        usage: callTool ? { ...usage, input: 154900, output: 100, totalTokens: 155000 } : usage,
        stopReason: callTool ? 'toolUse' : 'stop', timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: callTool ? 'toolUse' : 'stop', message });
      return stream;
    },
  } as unknown as ModelRuntime;
  const sessionManager = SessionManager.inMemory(cwd);
  const settingsManager = SettingsManager.inMemory();
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', modelRuntime: runtime,
    settingsManager, sessionManager, tools: ['checkpoint_read'],
    customTools: [{ name: 'checkpoint_read', label: 'Read', description: 'Read-only fixture', parameters: Type.Object({}),
      execute: async () => {
        toolExecutions++;
        lifecycle.push('tool-complete');
        return { content: [{ type: 'text' as const, text: '文'.repeat(30_000) }], details: {} };
      } }],
  });
  settingsManager.setCompactionEnabled(true);
  applyCompactionSettings(settingsManager, model.contextWindow, true);
  session.subscribe(event => {
    if (event.type === 'compaction_start') lifecycle.push(`compact-start:${event.reason}`);
    if (event.type === 'compaction_end' && event.result) lifecycle.push(`compact-end:${event.reason}`);
  });
  for (let index = 0; index < 3; index++) {
    sessionManager.appendMessage({ role: 'user', content: '文'.repeat(40_000), timestamp: index * 2 + 1 });
    sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Earlier work' }],
      api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: index * 2 + 2 });
  }
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  await session.prompt('Use the read tool, then answer');
  expect(toolExecutions).toBe(1);
  expect(modelRequests).toBe(2);
  expect(lifecycle.indexOf('tool-complete')).toBeLessThan(lifecycle.indexOf('compact-start:threshold'));
  expect(lifecycle.indexOf('compact-end:threshold')).toBeLessThan(lifecycle.indexOf('model-2'));
  expect(lifecycle).toContain('summary');
});

it('five real SDK compactions automatically reconcile sourced notes and refresh live scheduler state', async () => {
  const { createTaskContextTool, taskContextItems } = await import('./task-context.ts');
  const { createSessionHistoryTool } = await import('./context-retention.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-retention-'));
  tempDirs.push(cwd);
  const calls: Context[] = [];
  let workerStatus = 'running';
  let additionalUpdate: Record<string, string> | undefined;
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    getModel: (provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (_model: typeof model, context: Context) => {
      calls.push(context);
      const stream = createAssistantMessageEventStream();
      const sourcePacket = context.messages.find(message => message.role === 'user'
        && typeof message.content === 'string' && message.content.startsWith('Source records for task reconciliation'));
      const data = sourcePacket && typeof sourcePacket.content === 'string'
        ? JSON.parse(sourcePacket.content.slice(sourcePacket.content.indexOf('\n') + 1)) : undefined;
      const original = data?.sources.find((record: { text: string }) => record.text.includes('只修改前端；不要推送。'));
      const updates = original ? [{ key: 'scope', kind: 'constraint', text: '只修改前端；不要推送。',
        source_id: original.id, quote: '只修改前端；不要推送。', status: 'active' }] : [];
      if (additionalUpdate) updates.push(additionalUpdate as typeof updates[number]);
      const text = 'Intentionally lossy summary or reply.' + (data ? `\n<task-context-updates>${JSON.stringify(updates)}</task-context-updates>` : '');
      stream.push({ type: 'done', reason: 'stop', message: {
        role: 'assistant', content: [{ type: 'text', text }],
        api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now(),
      } });
      return stream;
    },
  } as unknown as ModelRuntime;
  const manager = SessionManager.inMemory(cwd);
  const settings = SettingsManager.inMemory();
  const history = createSessionHistoryTool(() => manager);
  const notes = createTaskContextTool(() => manager);
  const { session } = await createAgentSession({ cwd, agentDir: join(cwd, 'agent'), model,
    thinkingLevel: 'off', modelRuntime: runtime, settingsManager: settings, sessionManager: manager,
    tools: [history.name, notes.name], customTools: [history, notes] });
  installCompactionPolicy(session, undefined, async () => JSON.stringify({ pendingAggregation: true, children: [{ id: 'worker', status: workerStatus }] }));
  const source = manager.appendMessage({ role: 'user', content: '只修改前端；不要推送。', timestamp: 1 });
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 3; i++) {
      manager.appendMessage({ role: 'user', content: `Round ${round} evidence ${i}: ${'x'.repeat(40000)}`, timestamp: 2 + round * 3 + i });
    }
    session.agent.state.messages = manager.buildSessionContext().messages;
    await session.compact();
    workerStatus = round === 0 ? 'running' : 'completed';
    await session.prompt(`Continue round ${round}`);
    const request = calls.at(-1)!;
    expect(JSON.stringify(request.messages)).toContain(workerStatus);
    expect(JSON.stringify(request.messages)).toContain('pendingAggregation');
    expect(JSON.stringify(request.messages)).toContain('只修改前端；不要推送。');
    expect(taskContextItems(manager.getBranch())[0]?.source_id).toBe(source);
  }
  expect(manager.getBranch().filter(entry => entry.type === 'compaction')).toHaveLength(5);
  const original = await history.execute('recover', { entry_id: source }, undefined, undefined, {} as never);
  expect(JSON.stringify(original.content)).toContain('只修改前端；不要推送。');
  const before = taskContextItems(manager.getBranch());
  const newSource = manager.appendMessage({ role: 'user', content: '新增要求：不要部署。' + 'x'.repeat(100000), timestamp: Date.now() });
  additionalUpdate = { key: 'deploy', kind: 'constraint', text: '不要部署', source_id: newSource, quote: '不要部署', status: 'active' };
  const append = manager.appendCompaction.bind(manager);
  manager.appendCompaction = () => { throw new Error('simulated checkpoint write failure'); };
  try {
    await expect(session.compact()).rejects.toThrow('simulated checkpoint write failure');
    expect(taskContextItems(manager.getBranch())).toEqual(before);
  } finally { manager.appendCompaction = append; }

});
