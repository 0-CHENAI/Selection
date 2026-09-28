import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, SessionManager, SettingsManager, type AgentSession, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { applySystemPromptOverride } from './system-prompt-override.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('applySystemPromptOverride', () => {
  it('keeps the exact prompt through rebuilds and later overrides', () => {
    const fake = {
      _baseSystemPromptOptions: { forceSystemPrompt: undefined as string | undefined },
      _runSystemPromptOptions: { forceSystemPrompt: undefined as string | undefined },
      _rebuildSystemPrompt() { this._baseSystemPromptOptions = { forceSystemPrompt: undefined }; },
    };
    const session = fake as unknown as AgentSession;
    applySystemPromptOverride(session, 'FIRST');
    expect(fake._baseSystemPromptOptions.forceSystemPrompt).toBe('FIRST');
    expect(fake._runSystemPromptOptions.forceSystemPrompt).toBe('FIRST');
    fake._rebuildSystemPrompt();
    expect(fake._baseSystemPromptOptions.forceSystemPrompt).toBe('FIRST');
    applySystemPromptOverride(session, 'SECOND');
    expect(fake._baseSystemPromptOptions.forceSystemPrompt).toBe('SECOND');
    expect(fake._runSystemPromptOptions.forceSystemPrompt).toBe('SECOND');
  });

  it('sends the exact prompt on consecutive real SDK turns', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'selection-pi-prompt-'));
    tempDirs.push(cwd);
    const model: Model<'openai-responses'> = {
      id: 'offline-prompt', name: 'Offline prompt', api: 'openai-responses', provider: 'openai',
      baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096,
    };
    const prompts: string[] = [];
    const runtime = {
      hasConfiguredAuth: () => true,
      checkAuth: async () => ({ apiKey: 'offline-test' }),
      getAuth: async () => ({ auth: { apiKey: 'offline-test' } }),
      streamSimple: (_model: typeof model, context: { messages: Parameters<typeof getCurrentSystemPrompt>[0] }) => {
        prompts.push(getCurrentSystemPrompt(context.messages));
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: 'assistant', content: [{ type: 'text', text: 'Done' }], api: model.api,
          provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        stream.push({ type: 'done', reason: 'stop', message });
        return stream;
      },
    } as unknown as ModelRuntime;
    const { session } = await createAgentSession({
      cwd, agentDir: join(cwd, 'agent'), model, thinkingLevel: 'off', noTools: 'all',
      modelRuntime: runtime, settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory(cwd),
    });
    session.setAutoCompactionEnabled(false);
    applySystemPromptOverride(session, 'FIRST');
    await session.prompt('One');
    applySystemPromptOverride(session, 'SECOND');
    await session.prompt('Two');
    session.setActiveToolsByName([]);
    await session.prompt('Three');
    expect(prompts).toEqual(['FIRST', 'SECOND', 'SECOND']);
    expect(session.systemPrompt).toBe('SECOND');
    session.dispose();
  });
});
