/**
 * Tests for PiAgent.queryLlm — the subprocess RPC that powers `call_llm`.
 *
 * These tests are the drift guard for issue #596. The main-process side used to
 * route queryLlm through the mini_completion envelope which only carried `prompt`,
 * silently dropping model/systemPrompt/outputSchema/etc. The round-trip invariant
 * test below ensures the full request shape propagates end-to-end and fails loudly
 * if someone adds a new LLMQueryRequest field and forgets to plumb it through.
 */
import { describe, expect, it } from 'bun:test';
import { PiAgent } from '../pi-agent.ts';
import type { BackendConfig } from '../backend/types.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../llm-tool.ts';

function createConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/craft-agent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/craft-agent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
    ...overrides,
  };
}

/**
 * Install a minimal subprocess stub so ensureSubprocess() resolves immediately
 * and send() captures outbound messages without hitting real stdin.
 */
function installFakeSubprocess(agent: PiAgent): { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  (agent as any).ensureSubprocess = async () => {};
  (agent as any).send = (cmd: Record<string, unknown>) => {
    sent.push(cmd);
  };
  return { sent };
}

/**
 * queryLlm awaits ensureSubprocess() before it calls send(), so a microtask
 * has to drain before the outbound envelope is captured.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PiAgent.queryLlm — subprocess RPC round-trip', () => {
  it('cleans up query correlation when transport dispatch throws', async () => {
    const agent = new PiAgent(createConfig());
    installFakeSubprocess(agent);
    (agent as any).send = () => { throw new Error('transport closed'); };
    await expect(agent.queryLlm({ prompt: 'preview', previewOnly: true })).rejects.toThrow('transport closed');
    expect((agent as any).pendingLlmQueries.size).toBe(0);
    agent.destroy();
  });

  it('uses the frozen prepared input once and refuses changed graph text before hooks or dispatch', async () => {
    const agent = new PiAgent(createConfig());
    installFakeSubprocess(agent);
    let assemblies = 0;
    let hooks = 0;
    const sent: any[] = [];
    (agent as any).buildTurnInput = (message: string) => ({ systemPrompt: `platform-${++assemblies}`, message });
    (agent as any).emitAutomationEvent = (name: string) => { if (name === 'UserPromptSubmit') hooks++; };
    agent.previewInput = async input => ({ context: { systemPrompt: input.systemPrompt, messages: [], tools: [] }, model: { id: 'test', api: 'test', provider: 'test', contextWindow: 8192 }, hash: 'frozen-hash' });
    (agent as any).send = (message: any) => { sent.push(message); (agent as any).eventQueue.complete(); };
    const snapshot = await agent.prepareThoughtInput('graph');
    expect(hooks).toBe(0);
    for await (const _event of agent.chat('graph', undefined, { strictInput: true, inputHash: snapshot.hash })) { /* drain */ }
    expect(assemblies).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ type: 'prompt', systemPrompt: 'platform-1', message: 'graph', inputHash: snapshot.hash })]);
    expect(hooks).toBe(1);
    const errors: unknown[] = [];
    for await (const event of agent.chat('changed graph', undefined, { strictInput: true, inputHash: snapshot.hash })) errors.push(event);
    expect(JSON.stringify(errors)).toContain('preview expired');
    expect(sent).toHaveLength(1);
    expect(hooks).toBe(1);
    agent.destroy();
  });

  it('correlates concurrent input previews without sending a model prompt', async () => {
    const agent = new PiAgent(createConfig());
    const { sent } = installFakeSubprocess(agent);
    const first = agent.previewInput({ systemPrompt: 'system', message: 'first' });
    const second = agent.previewInput({ systemPrompt: 'system', message: 'second' });
    await flushMicrotasks();
    expect(sent.map(message => message.type)).toEqual(['preview_prompt', 'preview_prompt']);
    const snapshot = { context: { systemPrompt: 'system', messages: [], tools: [] }, model: { id: 'test', api: 'test', provider: 'test', contextWindow: 8192 }, hash: 'second-hash' };
    (agent as any).handleLine(JSON.stringify({ type: 'preview_prompt_result', id: sent[1]!.id, snapshot }));
    expect(await second).toEqual(snapshot);
    (agent as any).handleLine(JSON.stringify({ type: 'preview_prompt_result', id: sent[0]!.id, errorMessage: 'preview rejected' }));
    await expect(first).rejects.toThrow('preview rejected');
    expect((agent as any).pendingInputPreviews.size).toBe(0);
    agent.destroy();
  });

  it('rejects input previews on subprocess exit and clears their timers', async () => {
    const agent = new PiAgent(createConfig());
    installFakeSubprocess(agent);
    const pending = agent.previewInput({ systemPrompt: 'system', message: 'graph' });
    await flushMicrotasks();
    (agent as any).handleSubprocessExit(1, null);
    await expect(pending).rejects.toThrow('subprocess exited');
    expect((agent as any).pendingInputPreviews.size).toBe(0);
    agent.destroy();
  });

  it('isolates preview sequences by query and ignores duplicate and late deltas', async () => {
    const agent = new PiAgent(createConfig());
    const { sent } = installFakeSubprocess(agent);
    const preview: string[] = [];
    const pending = agent.queryLlm({ prompt: 'hi' }, text => preview.push(text));
    await flushMicrotasks();
    const id = sent[0]!.id;
    expect(sent[0]!.stream).toBe(true);
    const receive = (message: object) => (agent as any).handleLine(JSON.stringify(message));
    receive({ type: 'llm_query_delta', id: 'foreign', sequence: 1, text: 'wrong' });
    receive({ type: 'llm_query_delta', id, sequence: 1, text: 'hello' });
    receive({ type: 'llm_query_delta', id, sequence: 1, text: 'duplicate' });
    receive({ type: 'llm_query_delta', id, sequence: 0, text: 'old' });
    receive({ type: 'llm_query_delta', id, sequence: 2, text: ' world' });
    receive({ type: 'llm_query_result', id, result: { text: 'final', model: 'test' } });
    receive({ type: 'llm_query_delta', id, sequence: 3, text: 'late' });
    expect((await pending).text).toBe('final');
    expect(preview).toEqual(['hello', ' world']);
    agent.destroy();
  });

  it('propagates the full LLMQueryRequest shape over the llm_query RPC unchanged', async () => {
    const agent = new PiAgent(createConfig());
    const { sent } = installFakeSubprocess(agent);

    const request: LLMQueryRequest = {
      prompt: 'Summarize this transcript',
      images: [{ mimeType: 'image/png', data: 'aW1hZ2U=' }],
      strictInput: true,
      messages: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }],
      systemPrompt: 'You are a concise summarizer.',
      model: 'pi/gpt-5-mini',
      maxTokens: 512,
      temperature: 0.3,
      outputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    };

    // Start the query and complete it by injecting a result for the captured id.
    const pending = agent.queryLlm(request);
    await flushMicrotasks();

    expect(sent).toHaveLength(1);
    const outbound = sent[0]!;
    expect(outbound.type).toBe('llm_query');
    expect(typeof outbound.id).toBe('string');

    // DRIFT GUARD: the outbound envelope must carry the entire request shape
    // byte-for-byte. If someone adds a field to LLMQueryRequest but doesn't
    // propagate it, this fails — prompting them to revisit queryLlm.
    expect(JSON.stringify(outbound.request)).toBe(JSON.stringify(request));

    // Resolve the pending query so the test doesn't hang.
    (agent as any).handleLine(JSON.stringify({
      type: 'llm_query_result',
      id: outbound.id,
      result: { text: 'ok', model: 'pi/gpt-5-mini' },
    }));

    const result = await pending;
    expect(result).toEqual({ text: 'ok', model: 'pi/gpt-5-mini' });

    agent.destroy();
  });

  it('resolves queryLlm with the exact returned text and model', async () => {
    const agent = new PiAgent(createConfig());
    const { sent } = installFakeSubprocess(agent);

    const pending = agent.queryLlm({ prompt: 'hi' });
    await flushMicrotasks();
    const id = sent[0]!.id as string;

    const expected: LLMQueryResult = {
      text: 'hello world',
      model: 'pi/gpt-5-mini',
      inputTokens: 7,
      outputTokens: 3,
    };

    (agent as any).handleLine(JSON.stringify({
      type: 'llm_query_result',
      id,
      result: expected,
    }));

    const result = await pending;
    expect(result).toEqual(expected);
    expect((agent as any).pendingLlmQueries.size).toBe(0);

    agent.destroy();
  });

  it('rejects queryLlm and fires refreshAndPushTokens on auth errors for OAuth connections', async () => {
    const agent = new PiAgent(createConfig({ authType: 'oauth' }));
    const { sent } = installFakeSubprocess(agent);

    // Stub refreshAndPushTokens so we can observe the auth-refresh attempt.
    let refreshAttempts = 0;
    (agent as any).refreshAndPushTokens = async () => {
      refreshAttempts++;
    };

    const pending = agent.queryLlm({ prompt: 'hi' });
    await flushMicrotasks();
    expect(sent).toHaveLength(1);

    // Simulate the subprocess dual-emit: generic `error` first (triggers
    // centralized auth refresh), then the targeted `llm_query_result` that
    // rejects the specific promise.
    (agent as any).handleLine(JSON.stringify({
      type: 'error',
      code: 'llm_query_error',
      message: 'HTTP 401: Unauthorized',
    }));

    // The generic error loop already rejected the pending query, so the targeted
    // result handler is a no-op. That's fine — the dual-emit is defense-in-depth.
    let rejection: Error | null = null;
    try {
      await pending;
    } catch (err) {
      rejection = err as Error;
    }

    expect(rejection).not.toBeNull();
    expect(rejection!.message).toContain('401');

    // Yield once so the async refresh closure schedules.
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshAttempts).toBe(1);
    expect((agent as any).pendingLlmQueries.size).toBe(0);

    agent.destroy();
  });

  it('rejects queryLlm with a timeout message when no result arrives in time', async () => {
    const agent = new PiAgent(createConfig());
    installFakeSubprocess(agent);

    // Shrink the wait so we don't actually block for 120s in the test.
    // The implementation uses LLM_QUERY_TIMEOUT_MS via setTimeout; we intercept
    // setTimeout to fire the timer synchronously-ish.
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((fn: () => void) => {
      return originalSetTimeout(fn, 1);
    }) as typeof setTimeout;

    try {
      let rejection: Error | null = null;
      try {
        await agent.queryLlm({ prompt: 'hi' });
      } catch (err) {
        rejection = err as Error;
      }

      expect(rejection).not.toBeNull();
      expect(rejection!.message).toMatch(/timed out/i);
      expect((agent as any).pendingLlmQueries.size).toBe(0);
    } finally {
      (globalThis as any).setTimeout = originalSetTimeout;
    }

    agent.destroy();
  });

  it('rejects all pending queryLlm calls when the subprocess exits', async () => {
    const agent = new PiAgent(createConfig());
    installFakeSubprocess(agent);

    const p1 = agent.queryLlm({ prompt: 'one' });
    const p2 = agent.queryLlm({ prompt: 'two' });
    await flushMicrotasks();

    expect((agent as any).pendingLlmQueries.size).toBe(2);

    // Simulate subprocess death (the exit handler clears pending queries).
    (agent as any).handleSubprocessExit(1, null);

    const [r1, r2] = await Promise.allSettled([p1, p2]);
    expect(r1.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
    expect((r1 as PromiseRejectedResult).reason.message).toMatch(/subprocess exited/i);
    expect((r2 as PromiseRejectedResult).reason.message).toMatch(/subprocess exited/i);
    expect((agent as any).pendingLlmQueries.size).toBe(0);

    agent.destroy();
  });
});
