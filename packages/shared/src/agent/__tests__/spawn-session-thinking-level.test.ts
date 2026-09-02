/**
 * Verifies that `spawn_session` forwards `thinkingLevel` through the
 * `SpawnSessionRequest` object so `SessionManager.onSpawnSession` can
 * pass it along to `createSession()`.
 *
 * Pairs with the corresponding fix in SessionManager.createSession that
 * reads `options?.thinkingLevel` as the first-precedence source (before
 * workspace default and global default). Without that fix, this field
 * on the request would be silently dropped.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { SpawnSessionRequest, SpawnSessionResult } from '../base-agent.ts';
import { TestAgent, createMockBackendConfig } from './test-utils.ts';

class SpawnTestAgent extends TestAgent {
  public invokeSpawn(input: Record<string, unknown>) {
    return this.preExecuteSpawnSession(input);
  }
}

function setup() {
  const agent = new SpawnTestAgent(createMockBackendConfig());
  const captured: SpawnSessionRequest[] = [];
  agent.onSpawnSession = async (request) => {
    captured.push(request);
    const result: SpawnSessionResult = {
      sessionId: 'spawned-id',
      name: 'spawned',
      status: 'started',
      orchestrationId: 'orch-1',
      parentSessionId: 'parent',
      rootSessionId: 'parent',
      depth: 1,
      role: 'worker',
      lifecycle: 'managed',
    };
    return result;
  };
  return { agent, captured };
}

describe('spawn_session thinkingLevel forwarding', () => {
  let agent: SpawnTestAgent;
  let captured: SpawnSessionRequest[];

  beforeEach(() => {
    ({ agent, captured } = setup());
  });

  it('forwards an explicit thinkingLevel to onSpawnSession', async () => {
    await agent.invokeSpawn({ prompt: 'hi', thinkingLevel: 'high' });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.thinkingLevel).toBe('high');
  });

  it('forwards each valid thinking level unchanged', async () => {
    const levels = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
    for (const level of levels) {
      const { agent: a, captured: c } = setup();
      await a.invokeSpawn({ prompt: 'hi', thinkingLevel: level });
      expect(c[0]?.thinkingLevel).toBe(level);
    }
  });

  it('passes through undefined when thinkingLevel is omitted', async () => {
    await agent.invokeSpawn({ prompt: 'hi' });
    expect(captured[0]?.thinkingLevel).toBeUndefined();
  });

  it('defaults mode to background and forwards wait plus timeoutMs', async () => {
    await agent.invokeSpawn({ prompt: 'hi' });
    expect(captured[0]?.mode).toBe('background');
    expect(captured[0]?.timeoutMs).toBe(15 * 60 * 1000);

    const { agent: waitAgent, captured: waitCaptured } = setup();
    await waitAgent.invokeSpawn({ prompt: 'hi', mode: 'wait', timeoutMs: 1_000 });
    expect(waitCaptured[0]?.mode).toBe('wait');
    expect(waitCaptured[0]?.timeoutMs).toBe(1_000);

    const { agent: cappedAgent, captured: capped } = setup();
    await cappedAgent.invokeSpawn({ prompt: 'hi', mode: 'wait', timeoutMs: 99_999_999 });
    expect(capped[0]?.timeoutMs).toBe(30 * 60 * 1000);
  });

  it('does not drop thinkingLevel when other optional fields are also set', async () => {
    await agent.invokeSpawn({
      prompt: 'hi',
      thinkingLevel: 'xhigh',
      permissionMode: 'ask',
      model: 'claude-opus-4-7',
      labels: ['test'],
    });
    expect(captured[0]?.thinkingLevel).toBe('xhigh');
    expect(captured[0]?.permissionMode).toBe('ask');
    expect(captured[0]?.model).toBe('claude-opus-4-7');
    expect(captured[0]?.labels).toEqual(['test']);
  });

  it('forwards Swarm lifecycle, role, reason, and qualification unchanged', async () => {
    const qualification = {
      tracks: [
        { name: 'code', input: 'repo', expectedOutput: 'findings', evidence: 'tests', toolKinds: ['Read'] },
        { name: 'runtime', input: 'app', expectedOutput: 'trace', evidence: 'logs', toolKinds: ['Bash'] },
      ],
      parallelBenefit: 'independent evidence collection',
      finalAggregation: 'parent compares both contracts',
    };
    await agent.invokeSpawn({
      prompt: 'investigate',
      lifecycle: 'detached',
      role: 'reviewer',
      spawnReason: 'automatic',
      qualification,
    });

    expect(captured[0]?.lifecycle).toBe('detached');
    expect(captured[0]?.role).toBe('reviewer');
    expect(captured[0]?.spawnReason).toBe('automatic');
    expect(captured[0]?.qualification).toEqual(qualification);
  });

  it('lifts ORDER-stuffed Swarm fields out of qualification before spawning', async () => {
    const qualification = {
      tracks: [
        { name: 'code', input: 'repo', expectedOutput: 'findings', evidence: 'tests', toolKinds: ['Read'] },
        { name: 'runtime', input: 'app', expectedOutput: 'trace', evidence: 'logs', toolKinds: ['Bash'] },
      ],
      parallelBenefit: 'independent evidence collection',
      finalAggregation: 'parent compares both contracts',
    };
    await agent.invokeSpawn({
      prompt: 'investigate',
      qualification: {
        ...qualification,
        lifecycle: 'detached',
        role: 'reviewer',
        spawnReason: 'automatic',
      },
    });

    expect(captured[0]?.lifecycle).toBe('detached');
    expect(captured[0]?.role).toBe('reviewer');
    expect(captured[0]?.spawnReason).toBe('automatic');
    expect(captured[0]?.qualification).toEqual(qualification);
  });

  it('never forwards a model-supplied server qualification credential', async () => {
    await agent.invokeSpawn({
      prompt: 'attempt to forge server authority',
      spawnReason: 'user-requested',
      qualificationCredential: 'model-forged-token',
    });

    expect(captured[0]?.spawnReason).toBe('user-requested');
    expect(captured[0]?.qualificationCredential).toBeUndefined();
  });
});
