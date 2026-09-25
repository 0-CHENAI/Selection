import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from '@earendil-works/pi-ai';
import { applyCompactionSettings, COMPACTION_FOCUS, installCompactionPolicy } from './compaction-policy.ts';

const model: Model<'openai-responses'> = {
  id: 'offline-compaction-test', name: 'Offline compaction test', api: 'openai-responses',
  provider: 'openai', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096,
};
const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const tempDirs: string[] = [];
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('the real Pi session compacts at the request gate and resumes the same prompt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-compaction-'));
  tempDirs.push(cwd);
  const providerCalls: Array<{ summary: boolean; context: Context }> = [];
  const runtime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'offline-test' }),
    getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
    streamSimple: (_model: typeof model, context: Context) => {
      const summary = (context.systemPrompt ?? '').includes(COMPACTION_FOCUS);
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
  session.subscribe(event => {
    if (event.type === 'compaction_start') events.push(`start:${event.reason}`);
    if (event.type === 'compaction_end') events.push(`end:${event.reason}:${!!event.result}`);
  });

  await session.prompt('Continue the same request');

  expect(events).toContain('start:overflow');
  expect(events).toContain('end:overflow:true');
  expect(providerCalls.map(call => call.summary)).toEqual([true, false]);
  expect(providerCalls[1]!.context.messages.some(message => message.role === 'user'
    && JSON.stringify(message.content).includes('Continue the same request'))).toBe(true);
  expect(session.sessionManager.getBranch().some(entry => entry.type === 'compaction')).toBe(true);
});
