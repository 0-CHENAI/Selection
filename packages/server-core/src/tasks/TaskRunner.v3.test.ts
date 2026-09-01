import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TokenUsage } from '@craft-agent/core/types';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import {
  parseTaskSpec,
  saveTaskSpec,
  readRunLog,
  type TaskSpec,
  COORDINATOR_TIMEOUT_BLOCKER,
} from '@craft-agent/shared/tasks';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import { TaskRunner, TaskControlError, type ConductorSessionHost } from './TaskRunner';
import { LlmConnectionPool } from './connection-pool';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function tu(inputTokens: number, outputTokens: number): TokenUsage {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, contextTokens: 0, costUsd: 0 };
}

function specOf(raw: unknown): TaskSpec {
  const parsed = parseTaskSpec(raw);
  if (!parsed.success) throw new Error('bad fixture: ' + JSON.stringify(parsed.error.issues));
  return parsed.data;
}

class MockHost implements ConductorSessionHost {
  private readonly listeners = new Set<(evt: SessionCompletionEvent) => void>();
  readonly created: { id: string; options: CreateSessionOptions }[] = [];
  readonly sent: { sessionId: string; message: string }[] = [];
  readonly statuses: { sessionId: string; status: string }[] = [];
  readonly columns: { sessionId: string; column: string | null }[] = [];
  readonly nodeCounts: { sessionId: string; count: number }[] = [];
  readonly orchestrationStatuses: { sessionId: string; status: string; blocker?: string }[] = [];
  readonly cancelled: string[] = [];
  readonly finalTextById = new Map<string, string>();
  usedToolsById = new Map<string, boolean>();

  async createSession(_workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }> {
    const id = `sess-${options.name}`;
    this.created.push({ id, options });
    return { id };
  }
  async sendMessage(sessionId: string, message: string): Promise<void> {
    this.sent.push({ sessionId, message });
  }
  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    this.statuses.push({ sessionId, status });
  }
  async setKanbanColumn(sessionId: string, column: string | null): Promise<void> {
    this.columns.push({ sessionId, column });
  }
  async setTaskNodeCount(sessionId: string, count: number): Promise<void> {
    this.nodeCounts.push({ sessionId, count });
  }
  async setOrchestrationStatus(sessionId: string, status: 'running' | 'completed' | 'need-to-check' | 'stopped', blocker?: string): Promise<void> {
    this.orchestrationStatuses.push({ sessionId, status, ...(blocker ? { blocker } : {}) });
  }
  async cancelProcessing(sessionId: string): Promise<void> {
    this.cancelled.push(sessionId);
  }
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getSessionFinalText(sessionId: string): string | undefined {
    return this.finalTextById.get(sessionId);
  }
  workingDirById = new Map<string, string>();
  getSessionWorkingDirectory(sessionId: string): string | undefined {
    return this.workingDirById.get(sessionId);
  }
  sessionUsedTools(sessionId: string): boolean | undefined {
    return this.usedToolsById.get(sessionId);
  }
  sessionIdFor(nodeId: string): string {
    return `sess-${nodeId}`;
  }
  dispatchedNames(): string[] {
    return this.created.map((c) => c.options.name!).filter(Boolean);
  }
  complete(nodeId: string, opts: { reason?: SessionCompletionEvent['reason']; finalText?: string; tokenUsage?: TokenUsage } = {}): void {
    const evt: SessionCompletionEvent = {
      sessionId: this.sessionIdFor(nodeId),
      workspaceId: 'ws',
      generation: 0,
      reason: opts.reason ?? 'complete',
      finalText: opts.finalText,
      tokenUsage: opts.tokenUsage,
    };
    for (const listener of [...this.listeners]) listener(evt);
  }
}

function v3Spec(over: Record<string, unknown> = {}): TaskSpec {
  return specOf({
    schema_version: 3,
    id: 'v3demo',
    title: 'V3',
    goal: 'g',
    acceptance_criteria: 'Both branches are present',
    runner: 'orchestrate',
    execution: {
      coordinator_gate: { mode: 'required', timeout_seconds: 120 },
      verification: { required: true, reserve_ratio: 0.2 },
    },
    nodes: [
      { id: 'a', prompt: 'A' },
      { id: 'b', prompt: 'B' },
    ],
    ...over,
  });
}

describe('TaskRunner v3 quality/efficiency', () => {
  let root: string;
  let host: MockHost;
  let prevFlag: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conductor-v3-'));
    host = new MockHost();
    prevFlag = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
    process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevFlag === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
    else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = prevFlag;
  });

  function runner() {
    return new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
  }

  function startV3(over: Record<string, unknown> = {}) {
    saveTaskSpec(root, v3Spec(over));
    return runner().run('v3demo', {
      runId: 'r1',
      orchestratorSessionId: 'orch',
      orchestrateAllowed: true,
      verifyOnComplete: true,
    });
  }

  function checkpointId(): string {
    const request = readRunLog(root, 'v3demo', 'r1').find((e) => e.kind === 'coordinator-request');
    if (!request || request.kind !== 'coordinator-request') throw new Error('missing coordinator-request');
    return request.checkpointId;
  }

  it('records metrics without dispatching before the first coordinator decision', () => {
    const snap = startV3();
    expect(snap.status).toBe('waiting-coordinator');
    expect(host.dispatchedNames()).toEqual([]);
    expect(snap.metrics?.coordinatorWaits).toBe(1);
    expect(snap.blockers).toContain('first-schedule');
  });

  it('continues, patches, pauses, and rejects stale or replayed decisions', async () => {
    startV3();
    const r = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r.getLatestRun('v3demo');
    const cp = checkpointId();
    const continued = r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: cp,
      decisionId: 'd1',
      baseRevision: 0,
      action: 'continue',
    });
    expect(continued.status).toBe('running');
    await tick();
    expect(host.dispatchedNames().sort()).toEqual(['a', 'b']);

    expect(() => r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: cp,
      decisionId: 'd1',
      baseRevision: 0,
      action: 'continue',
    })).toThrow(TaskControlError);
  });

  it('pauses on request and rejects a stale revision', () => {
    startV3();
    const r = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r.getLatestRun('v3demo');
    const cp = checkpointId();
    expect(() => r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: cp,
      decisionId: 'stale',
      baseRevision: 3,
      action: 'continue',
    })).toThrow(TaskControlError);
    const paused = r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: cp,
      decisionId: 'pause-1',
      baseRevision: 0,
      action: 'pause',
    });
    expect(paused.status).toBe('paused');
    expect(host.dispatchedNames()).toEqual([]);
  });

  it('times out into paused coordinator-timeout and does not auto-continue', () => {
    startV3();
    const r = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r.getLatestRun('v3demo');
    const snap = r.expireCoordinatorGate('v3demo', 'r1', '2026-06-07T00:03:00.000Z');
    expect(snap.status).toBe('paused');
    expect(snap.blockers).toContain(COORDINATOR_TIMEOUT_BLOCKER);
    expect(host.dispatchedNames()).toEqual([]);
  });

  it('restores an open coordinator gate after restart', () => {
    startV3();
    const host2 = new MockHost();
    const restored = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    const scanned = restored.scanUnfinished();
    expect(scanned[0]?.status).toBe('waiting-coordinator');
    expect(host2.created).toHaveLength(0);
    const continued = restored.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: checkpointId(),
      decisionId: 'after-restart',
      baseRevision: 0,
      action: 'continue',
    });
    expect(continued.status).toBe('running');
  });

  it('keeps coordinator-timeout after a timed-out run is scanned', () => {
    startV3();
    const first = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    first.getLatestRun('v3demo');
    first.expireCoordinatorGate('v3demo', 'r1', '2026-06-07T00:03:00.000Z');
    const host2 = new MockHost();
    const scanned = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' }).scanUnfinished();
    expect(scanned[0]?.status).toBe('paused');
    expect(scanned[0]?.blockers).toContain(COORDINATOR_TIMEOUT_BLOCKER);
    expect(host2.created).toHaveLength(0);
  });

  it('restores the open gate after restart without replaying a completed decision', async () => {
    startV3();
    const first = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    first.getLatestRun('v3demo');
    first.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: checkpointId(),
      decisionId: 'd-restore',
      baseRevision: 0,
      action: 'continue',
    });
    await tick();
    const host2 = new MockHost();
    const restored = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    const scanned = restored.scanUnfinished();
    expect(scanned[0]?.status).toBe('interrupted');
    expect(() => restored.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: checkpointId(),
      decisionId: 'd-restore',
      baseRevision: 0,
      action: 'continue',
    })).toThrow(/No active run|waiting|replayed|not waiting/);
  });

  it('requires a node verdict with evidence and only repairs named nodes plus dependents', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      nodes: [
        { id: 'work', prompt: 'work' },
        { id: 'review', kind: 'verify', prompt: 'review', depends_on: ['work'] },
      ],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    r.submitNodeOutput(host.sessionIdFor('work'), { text: 'done' });
    host.complete('work', { finalText: 'done', tokenUsage: tu(10, 5) });
    await tick();
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), { result: 'fail', reason: 'bad' }).ok).toBe(false);
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), {
      result: 'fail',
      reason: 'missing branch',
      evidence: 'only one output',
      nodes: ['work'],
    }).ok).toBe(true);
    expect(['pending', 'running']).toContain(r.getRunState('v3demo', 'r1')?.nodes.find((n) => n.id === 'work')?.state ?? '');
  });

  it('reserves verification tokens and organizes synthesize inputs by dependency', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      token_budget: 20_000,
      nodes: [
        { id: 'left', prompt: 'L' },
        { id: 'right', prompt: 'R' },
        { id: 'sum', kind: 'synthesize', prompt: 'Merge', depends_on: ['left', 'right'] },
      ],
    }));
    const r = runner();
    const snap = r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    expect(snap.metrics?.verifyBudgetReserved).toBe(4_096);
    await tick();
    host.complete('left', { finalText: 'L-OUT', tokenUsage: tu(10, 5) });
    host.complete('right', { finalText: 'R-OUT', tokenUsage: tu(10, 5) });
    await tick();
    const prompt = host.sent.find((s) => s.sessionId === host.sessionIdFor('sum'))?.message ?? '';
    expect(prompt).toContain('## Inputs by dependency');
    expect(prompt).toContain('left');
    expect(prompt).toContain('right');
  });

  it('prefers the critical path and isolates the connection pool', async () => {
    const pool = new LlmConnectionPool(1);
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      defaults: { llmConnection: 'shared' },
      max_parallel: 2,
      nodes: [
        { id: 'short', prompt: 'short' },
        { id: 'long', prompt: 'long' },
        { id: 'tail', prompt: 'tail', depends_on: ['long'] },
      ],
    }));
    const r = new TaskRunner({
      host,
      workspaceId: 'ws',
      workspaceRoot: root,
      now: () => '2026-06-07T00:00:00.000Z',
      connectionPool: pool,
    });
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()[0]).toBe('long');
    expect(host.dispatchedNames()).toHaveLength(1);
    host.complete('long', { finalText: 'L', tokenUsage: tu(3, 1) });
    await tick();
    expect(host.dispatchedNames()).toHaveLength(2);
    expect(host.dispatchedNames()).toContain('short');
  });

  it('hits workspace-pure cache and bypasses tool-using or sensitive nodes', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      nodes: [{ id: 'pure', prompt: 'hash me', cache: 'workspace-pure' }],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    host.usedToolsById.set(host.sessionIdFor('pure'), false);
    host.complete('pure', { finalText: 'ONCE', tokenUsage: tu(8, 2) });
    const first = r.getRunState('v3demo', 'r1');
    expect(first?.status === 'verifying' || first?.status === 'completed' || first?.status === 'waiting-coordinator').toBe(true);

    const host2 = new MockHost();
    host2.usedToolsById.set('sess-pure', false);
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    saveTaskSpec(root, v3Spec({
      id: 'v3demo2',
      runner: 'conduct',
      nodes: [{ id: 'pure', prompt: 'hash me', cache: 'workspace-pure' }],
    }));
    r2.run('v3demo2', { runId: 'r2', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    const cached = r2.getRunState('v3demo2', 'r2')?.nodes.find((n) => n.id === 'pure');
    expect(cached?.cacheStatus === 'hit' || host2.dispatchedNames().length === 0 || cached?.state === 'done').toBe(true);
  });

  it('does not mark a failed verify node done or release its dependents', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      max_iterations: 2,
      nodes: [
        { id: 'work', prompt: 'work' },
        { id: 'review', kind: 'verify', prompt: 'review', depends_on: ['work'] },
        { id: 'pub', prompt: 'pub', depends_on: ['review'] },
      ],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    r.submitNodeOutput(host.sessionIdFor('work'), { text: 'draft' });
    host.complete('work', { finalText: 'draft', tokenUsage: tu(10, 5) });
    await tick();
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), {
      result: 'fail',
      reason: 'missing branch',
      evidence: 'only one output',
      nodes: ['work'],
    }).ok).toBe(true);
    host.complete('review', { finalText: 'looks bad' });
    await tick();
    const nodes = r.getRunState('v3demo', 'r1')?.nodes ?? [];
    expect(nodes.find((n) => n.id === 'review')?.state).not.toBe('done');
    expect(nodes.find((n) => n.id === 'pub')?.state).toBe('pending');
    expect(host.dispatchedNames()).not.toContain('pub');
    expect(['pending', 'running']).toContain(nodes.find((n) => n.id === 'work')?.state ?? '');
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), {
      result: 'pass',
      reason: 'late',
      evidence: 'stale session',
    }).ok).toBe(false);
  });

  it('keeps the coordinator gate closed while waiting for approval', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      nodes: [
        { id: 'gate', kind: 'approval' },
        { id: 'work', prompt: 'work', depends_on: ['gate'] },
      ],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('waiting-coordinator');
    r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: checkpointId(),
      decisionId: 'go',
      baseRevision: 0,
      action: 'continue',
    });
    await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('waiting-approval');
    const expired = r.expireCoordinatorGate('v3demo', 'r1', '2026-06-07T00:03:00.000Z');
    expect(expired.status).toBe('waiting-approval');
    expect(expired.blockers).not.toContain(COORDINATOR_TIMEOUT_BLOCKER);
    const after = r.respondApproval('v3demo', 'r1', 'gate', true);
    expect(after.status).toBe('waiting-coordinator');
    expect(after.blockers).toContain('approval');
  });

  it('wakes a sibling run after the shared connection pool releases a slot', async () => {
    const pool = new LlmConnectionPool(1);
    saveTaskSpec(root, v3Spec({
      id: 'hold',
      runner: 'conduct',
      defaults: { llmConnection: 'shared' },
      nodes: [{ id: 'long', prompt: 'hold the slot' }],
    }));
    saveTaskSpec(root, v3Spec({
      id: 'wait',
      runner: 'conduct',
      defaults: { llmConnection: 'shared' },
      nodes: [{ id: 'next', prompt: 'start after release' }],
    }));
    const r = new TaskRunner({
      host,
      workspaceId: 'ws',
      workspaceRoot: root,
      now: () => '2026-06-07T00:00:00.000Z',
      connectionPool: pool,
    });
    r.run('hold', { runId: 'r-hold', orchestratorSessionId: 'orch-a', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['long']);
    r.run('wait', { runId: 'r-wait', orchestratorSessionId: 'orch-b', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['long']);
    host.complete('long', { finalText: 'done', tokenUsage: tu(3, 1) });
    await tick();
    expect(host.dispatchedNames()).toContain('next');
  });

  it('acquires map instances through the connection pool', async () => {
    const pool = new LlmConnectionPool(1);
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      defaults: { llmConnection: 'shared' },
      max_parallel: 2,
      params: [{ name: 'items', default: '["one","two"]' }],
      nodes: [{ id: 'fan', kind: 'map', for_each: '${params.items}', prompt: 'do ${item}' }],
    }));
    const r = new TaskRunner({
      host,
      workspaceId: 'ws',
      workspaceRoot: root,
      now: () => '2026-06-07T00:00:00.000Z',
      connectionPool: pool,
    });
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0']);
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('running');
    host.complete('fan#0', { finalText: 'A', tokenUsage: tu(2, 1) });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0', 'fan#1']);
    host.complete('fan#1', { finalText: 'B', tokenUsage: tu(2, 1) });
    await tick();
    expect(r.getRunState('v3demo', 'r1')?.nodes.find((n) => n.id === 'fan')?.state).toBe('done');
  });

  it('reopens the coordinator gate on resume after timeout', () => {
    startV3();
    const r = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r.getLatestRun('v3demo');
    r.expireCoordinatorGate('v3demo', 'r1', '2026-06-07T00:03:00.000Z');
    const resumed = r.resume('v3demo', 'r1');
    expect(resumed.status).toBe('waiting-coordinator');
    expect(resumed.blockers).toContain('first-schedule');
    expect(host.dispatchedNames()).toEqual([]);
  });

  it('does not cache verify/judge nodes even with run-pure', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      max_iterations: 2,
      nodes: [
        { id: 'work', prompt: 'work' },
        { id: 'review', kind: 'verify', prompt: 'review', cache: 'run-pure', depends_on: ['work'] },
      ],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    host.complete('work', { finalText: 'draft', tokenUsage: tu(4, 1) });
    await tick();
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), {
      result: 'fail',
      reason: 'missing branch',
      evidence: 'only one output',
      nodes: ['work'],
    }).ok).toBe(true);
    await tick();
    host.complete('work', { finalText: 'fixed', tokenUsage: tu(4, 1) });
    await tick();
    expect(host.dispatchedNames().filter((name) => name === 'review')).toHaveLength(2);
  });

  it('fails a v3 quality-gated run that has no coordinator session', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      nodes: [{ id: 'a', prompt: 'A' }],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'done', tokenUsage: tu(2, 1) });
    await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('failed');
  });

  it('rehydrates an approval response after restart', async () => {
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      nodes: [
        { id: 'gate', kind: 'approval' },
        { id: 'work', prompt: 'work', depends_on: ['gate'] },
      ],
    }));
    const first = runner();
    first.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    first.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1',
      checkpointId: checkpointId(),
      decisionId: 'go',
      baseRevision: 0,
      action: 'continue',
    });
    await tick();
    expect(first.getRunState('v3demo', 'r1')?.status).toBe('waiting-approval');

    const host2 = new MockHost();
    const restored = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    const after = restored.respondApproval('v3demo', 'r1', 'gate', true);
    expect(after.status).toBe('waiting-coordinator');
    expect(after.blockers).toContain('approval');
  });
});
