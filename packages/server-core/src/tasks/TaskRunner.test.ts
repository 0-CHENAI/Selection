import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TokenUsage } from '@craft-agent/core/types';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import { parseTaskSpec, saveTaskSpec, readRunLog, readNodeOutput, specRevisionPath, writeSpecRevision, type TaskSpec } from '@craft-agent/shared/tasks';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import { TaskRunner, TaskControlError, type ConductorSessionHost } from './TaskRunner';

// Flush pending microtasks so the runner's async dispatch (create → column → send) settles.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function tu(inputTokens: number, outputTokens: number): TokenUsage {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, contextTokens: 0, costUsd: 0 };
}

function specOf(raw: unknown): TaskSpec {
  const r = parseTaskSpec(raw);
  if (!r.success) throw new Error('bad fixture: ' + JSON.stringify(r.error.issues));
  return r.data;
}

/** Mock host: records calls; the test drives completions via complete(). */
class MockHost implements ConductorSessionHost {
  // A Set, mirroring SessionManager — the Conductor keeps its main subscription AND a one-shot
  // verdict listener attached at the same time while a run is `verifying`.
  private readonly listeners = new Set<(evt: SessionCompletionEvent) => void>();
  readonly created: { id: string; options: CreateSessionOptions }[] = [];
  readonly sent: { sessionId: string; message: string }[] = [];
  readonly statuses: { sessionId: string; status: string }[] = [];
  readonly columns: { sessionId: string; column: string | null }[] = [];
  readonly nodeCounts: { sessionId: string; count: number }[] = [];
  readonly orchestrationStatuses: { sessionId: string; status: string; blocker?: string }[] = [];
  readonly cancelled: string[] = [];
  stopSwarm?: ConductorSessionHost['stopSwarm'];
  readonly finalTextById = new Map<string, string>();
  resolveKanbanColumn?: (sessionId: string, statusId: string) => Promise<string | null>;

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

  // --- test helpers (sessionId is derived from the node title, which defaults to the node id) ---
  sessionIdFor(nodeId: string): string {
    return `sess-${nodeId}`;
  }
  promptFor(nodeId: string): string | undefined {
    return this.sent.find((s) => s.sessionId === this.sessionIdFor(nodeId))?.message;
  }
  dispatchedNames(): string[] {
    return this.created.map((c) => c.options.name!).filter(Boolean);
  }
  complete(nodeId: string, opts: { reason?: SessionCompletionEvent['reason']; finalText?: string; tokenUsage?: TokenUsage } = {}): void {
    this.completeSession(this.sessionIdFor(nodeId), opts);
  }
  /** Fire a completion for an arbitrary session id (e.g. the orchestrator's verification verdict). */
  completeSession(sessionId: string, opts: { reason?: SessionCompletionEvent['reason']; finalText?: string; tokenUsage?: TokenUsage } = {}): void {
    const evt: SessionCompletionEvent = {
      sessionId,
      workspaceId: 'ws',
      generation: 0,
      reason: opts.reason ?? 'complete',
      finalText: opts.finalText,
      tokenUsage: opts.tokenUsage,
    };
    for (const listener of [...this.listeners]) listener(evt);
  }
}

describe('TaskRunner (Conductor)', () => {
  let root: string;
  let host: MockHost;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conductor-test-'));
    host = new MockHost();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeRunner() {
    return new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
  }

  it('runs a dependency chain, feeding each output into the next', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'demo',
        title: 'Demo',
        goal: 'audit then design then implement',
        nodes: [
          { id: 'audit', prompt: 'Audit the code' },
          { id: 'design', depends_on: ['audit'], prompt: 'Design using ${nodes.audit.output}' },
          { id: 'impl', depends_on: ['design'], prompt: 'Implement ${nodes.design.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('demo', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    expect(host.dispatchedNames()).toEqual(['audit']);
    expect(host.promptFor('audit')).toBe('Audit the code');

    host.complete('audit', { finalText: 'AUDIT', tokenUsage: tu(10, 5) });
    await tick();
    expect(host.dispatchedNames()).toEqual(['audit', 'design']);
    expect(host.promptFor('design')).toBe('Design using AUDIT');

    host.complete('design', { finalText: 'DESIGN', tokenUsage: tu(20, 10) });
    await tick();
    expect(host.promptFor('impl')).toBe('Implement DESIGN');

    host.complete('impl', { finalText: 'IMPL', tokenUsage: tu(5, 5) });
    await tick();

    // All nodes done → the run is verifying (not yet terminal) until the orchestrator returns a verdict.
    expect(runner.getRunState('demo', 'r1')!.status).toBe('verifying');
    expect(host.sent.some((s) => s.sessionId === 'orch' && s.message.includes('finished running'))).toBe(true);

    host.completeSession('orch', { finalText: 'Looks correct.\nVERDICT: PASS' });
    await tick();

    const snap = runner.getRunState('demo', 'r1')!;
    expect(snap.status).toBe('completed');
    expect(snap.nodes.every((n) => n.state === 'done')).toBe(true);
    expect(snap.tokensUsed).toBe(55);
    expect(host.orchestrationStatuses.some((entry) => entry.sessionId === 'orch' && entry.status === 'running')).toBe(true);
    expect(host.orchestrationStatuses.at(-1)).toMatchObject({ sessionId: 'orch', status: 'completed' });

    // Run-log + node output persisted.
    const log = readRunLog(root, 'demo', 'r1');
    expect(log[0]).toMatchObject({ kind: 'run-started' });
    expect(log.some((e) => e.kind === 'run-completed')).toBe(true);
    expect(log.map((entry) => entry.seq)).toEqual(log.map((_, index) => index + 1));
    expect(log.every((entry) => typeof entry.revision === 'number')).toBe(true);
    expect(readNodeOutput(root, 'demo', 'r1', 'audit')).toEqual({ text: 'AUDIT' });
  });

  it('passes llmConnection (node value, else the task default) to createSession', async () => {
    // Regression: pi/* models complete instantly with empty output unless the child session is
    // created with the connection slug that serves the model.
    saveTaskSpec(
      root,
      specOf({
        id: 'conn',
        title: 'Conn',
        goal: 'g',
        defaults: { llmConnection: 'default-conn' },
        nodes: [
          { id: 'a', prompt: 'a', model: 'pi/gpt-5.5', llmConnection: 'pi-conn' },
          { id: 'b', prompt: 'b', model: 'claude-opus-4-8' }, // inherits the task default
        ],
      }),
    )
    const runner = makeRunner()
    runner.run('conn', { runId: 'r1' })
    await tick()

    const optsA = host.created.find((c) => c.options.name === 'a')?.options
    const optsB = host.created.find((c) => c.options.name === 'b')?.options
    expect(optsA?.llmConnection).toBe('pi-conn')
    expect(optsB?.llmConnection).toBe('default-conn')
  })

  it('resolves permissionMode: node override → task default → child (never the workspace default)', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'perm',
        title: 'Perm',
        goal: 'g',
        defaults: { permissionMode: 'ask' },
        nodes: [
          { id: 'a', prompt: 'a', permissionMode: 'safe' }, // node override wins
          { id: 'b', prompt: 'b' }, // inherits the task default
        ],
      }),
    )
    const runner = makeRunner()
    runner.run('perm', { runId: 'r1' })
    await tick()

    expect(host.created.find((c) => c.options.name === 'a')?.options.permissionMode).toBe('safe')
    expect(host.created.find((c) => c.options.name === 'b')?.options.permissionMode).toBe('ask')
  })

  it('defaults an omitted permission mode to safe instead of inheriting write authority', async () => {
    // A hand-authored spec that sets no permission mode must not fall through
    // to a permissive workspace default.
    saveTaskSpec(
      root,
      specOf({ id: 'perm2', title: 'Perm2', goal: 'g', nodes: [{ id: 'c', prompt: 'c' }] }),
    )
    const runner = makeRunner()
    runner.run('perm2', { runId: 'r1' })
    await tick()

    expect(host.created.find((c) => c.options.name === 'c')?.options.permissionMode).toBe('safe')
  })

  it('turns unattended ask permission into a parent need-to-check blocker', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'perm-ask',
        title: 'Perm ask',
        goal: 'g',
        defaults: { permissionMode: 'ask' },
        nodes: [{ id: 'a', prompt: 'a' }],
      }),
    )
    const runner = makeRunner()
    runner.run('perm-ask', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false })
    await tick()

    expect(host.created).toHaveLength(0)
    expect(runner.getRunState('perm-ask', 'r1')?.status).toBe('failed')
    expect(host.orchestrationStatuses.at(-1)).toMatchObject({
      sessionId: 'orch',
      status: 'need-to-check',
      blocker: 'failed: a',
    })
  })

  it('stamps task/run/node linkage on each dispatched child session', async () => {
    // The manual subtask composer skips Conductor-owned children by checking taskRunId.
    saveTaskSpec(
      root,
      specOf({ id: 'link', title: 'Link', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }),
    )
    const runner = makeRunner()
    runner.run('link', { runId: 'r1', orchestratorSessionId: 'orch' })
    await tick()

    const optsA = host.created.find((c) => c.options.name === 'a')?.options
    expect(optsA?.taskSlug).toBe('link')
    expect(optsA?.taskRunId).toBe('r1')
    expect(optsA?.taskNodeId).toBe('a')
  })

  it('creates persisted child sessions but hides DAG workers from the ordinary session list', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'announce', title: 'Announce', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] }),
    )
    const runner = makeRunner()
    runner.run('announce', { runId: 'r1' })
    await tick()

    expect(host.created.map((c) => c.id)).toEqual([host.sessionIdFor('a'), host.sessionIdFor('b')])
    expect(host.created.every((child) => child.options.hidden === true)).toBe(true)
  })

  it("children inherit the orchestrator's working directory (falling back to spec.cwd)", async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'cwd', title: 'Cwd', goal: 'g', cwd: '/spec/dir', nodes: [{ id: 'a', prompt: 'a' }] }),
    )
    host.workingDirById.set('orch', '/parent/dir')
    const runner = makeRunner()
    runner.run('cwd', { runId: 'r1', orchestratorSessionId: 'orch' })
    await tick()
    // Orchestrator cwd wins over the spec default.
    expect(host.created.find((c) => c.options.name === 'a')?.options.workingDirectory).toBe('/parent/dir')

    // With no orchestrator cwd, the spec's declared cwd is used.
    host.created.length = 0
    host.workingDirById.clear()
    const runner2 = makeRunner()
    runner2.run('cwd', { runId: 'r2', orchestratorSessionId: 'orch' })
    await tick()
    expect(host.created.find((c) => c.options.name === 'a')?.options.workingDirectory).toBe('/spec/dir')
  })

  it('moves the orchestrator tile to in-progress on start and needs-review on completion', async () => {
    saveTaskSpec(root, specOf({ id: 'col', title: 'Col', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }))
    const runner = makeRunner()
    runner.run('col', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false })
    await tick()
    expect(host.columns).toContainEqual({ sessionId: 'orch', column: 'in-progress' })
    expect(host.statuses).toContainEqual({ sessionId: 'orch', status: 'in-progress' })

    host.complete('a', { finalText: 'A' })
    await tick()
    expect(host.statuses).toContainEqual({ sessionId: 'orch', status: 'needs-review' })
    expect(host.columns.some((c) => c.sessionId === 'orch' && c.column === 'done')).toBe(false)
  })

  it('runs a fan-out and joins at the synthesizer', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'fan',
        title: 'Fan',
        goal: 'g',
        nodes: [
          { id: 'design', prompt: 'design' },
          { id: 'impl-a', depends_on: ['design'], prompt: 'A: ${nodes.design.output}' },
          { id: 'impl-b', depends_on: ['design'], prompt: 'B: ${nodes.design.output}' },
          { id: 'review', depends_on: ['impl-a', 'impl-b'], prompt: 'review ${nodes.impl-a.output} ${nodes.impl-b.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('fan', { runId: 'r1' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['design']);

    host.complete('design', { finalText: 'D' });
    await tick();
    // Both siblings dispatch in parallel; review waits for the barrier.
    expect(host.dispatchedNames().sort()).toEqual(['design', 'impl-a', 'impl-b']);
    expect(host.promptFor('review')).toBeUndefined();

    host.complete('impl-a', { finalText: 'A' });
    await tick();
    expect(host.promptFor('review')).toBeUndefined(); // still waiting on impl-b

    host.complete('impl-b', { finalText: 'B' });
    await tick();
    expect(host.promptFor('review')).toBe('review A B');

    host.complete('review', { finalText: 'R' });
    await tick();
    expect(runner.getRunState('fan', 'r1')!.status).toBe('completed');
  });

  it('marks a node failed, cancels blocked dependents, and settles the run as failed', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'fail',
        title: 'F',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('fail', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    host.complete('a', { reason: 'error' });
    await tick();

    const snap = runner.getRunState('fail', 'r1')!;
    expect(snap.status).toBe('failed');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('failed');
    expect(snap.nodes.find((n) => n.id === 'b')!.state).toBe('cancelled');
    expect(host.promptFor('b')).toBeUndefined();
    expect(host.statuses.some((s) => s.sessionId === 'sess-a' && s.status === 'needs-review')).toBe(true);
    expect(host.orchestrationStatuses.at(-1)).toMatchObject({
      sessionId: 'orch',
      status: 'need-to-check',
      blocker: 'failed: a',
    });

    const log = readRunLog(root, 'fail', 'r1');
    expect(log.some((e) => e.kind === 'node-finished' && (e as { state?: string }).state === 'failed')).toBe(true);
    expect(log.some((e) => e.kind === 'run-failed')).toBe(true);
  });

  it('honors max_parallel', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'par',
        title: 'P',
        goal: 'g',
        max_parallel: 1,
        nodes: [
          { id: 'x', prompt: 'x' },
          { id: 'y', prompt: 'y' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('par', { runId: 'r1' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['x']); // only one slot

    host.complete('x', { finalText: 'X' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['x', 'y']);

    host.complete('y', { finalText: 'Y' });
    await tick();
    expect(runner.getRunState('par', 'r1')!.status).toBe('completed');
  });

  it('pauses scheduling and resumes', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'pz',
        title: 'Pz',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('pz', { runId: 'r1' });
    await tick();

    runner.pause('pz', 'r1');
    expect(runner.getRunState('pz', 'r1')!.status).toBe('pausing');
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(host.promptFor('b')).toBeUndefined(); // paused → no scheduling
    expect(runner.getRunState('pz', 'r1')!.status).toBe('paused');

    runner.resume('pz', 'r1');
    await tick();
    expect(host.promptFor('b')).toBe('b A');

    host.complete('b', { finalText: 'B' });
    await tick();
    expect(runner.getRunState('pz', 'r1')!.status).toBe('completed');
  });

  it('stops a run and cancels in-flight children', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'st',
        title: 'St',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('st', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    await runner.stop('st', 'r1');
    const snap = runner.getRunState('st', 'r1')!;
    expect(snap.status).toBe('stopped');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('cancelled');
    expect(host.cancelled).toContain('sess-a');
    expect(host.statuses).toContainEqual({ sessionId: 'orch', status: 'needs-review' });
    expect(host.columns.some((c) => c.sessionId === 'orch' && c.column === 'done')).toBe(false);
  });

  it('resumes a run from the persisted run-log after a restart, reusing finished node outputs', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'res',
        title: 'Res',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    // First runner: complete 'a' (output persisted), leave 'b' pending, then "crash" (drop the runner).
    const r1 = makeRunner();
    r1.run('res', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    r1.pause('res', 'r1'); // so completing 'a' does not dispatch 'b'
    host.complete('a', { finalText: 'A', tokenUsage: tu(3, 4) });
    await tick();
    expect(readNodeOutput(root, 'res', 'r1', 'a')).toEqual({ text: 'A' });

    // Simulate an app restart: a brand-new runner + host with empty in-memory state.
    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r2.resume('res', 'r1'); // not in memory → rehydrate from the run-log
    await tick();

    // 'a' is reused from disk (NOT re-spawned); only 'b' dispatches, seeded with a's recovered output.
    expect(host2.dispatchedNames()).toEqual(['b']);
    expect(host2.promptFor('b')).toBe('b A');
    // The orchestrator linkage is recovered from the run-log.
    expect(host2.created.find((c) => c.options.name === 'b')?.options.parentSessionId).toBe('orch');

    host2.complete('b', { finalText: 'B' });
    await tick();
    // Resumed run re-verifies (orchestrator recovered from the run-log) before going terminal.
    expect(r2.getRunState('res', 'r1')!.status).toBe('verifying');
    host2.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(r2.getRunState('res', 'r1')!.status).toBe('completed');
  });

  it('retries a failed node up to retry.limit, then fails', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rt', title: 'Rt', goal: 'g', nodes: [{ id: 'a', prompt: 'do a', retry: { limit: 1 } }] }),
    );
    const runner = makeRunner();
    runner.run('rt', { runId: 'r1' });
    await tick();

    // First failure → within budget → re-dispatched (still running, attempt 2).
    host.complete('a', { reason: 'error' });
    await tick();
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(2);
    let snap = runner.getRunState('rt', 'r1')!;
    expect(snap.nodes[0]!.state).toBe('running');
    expect(snap.nodes[0]!.attempt).toBe(2);

    // Second failure → budget exhausted → failed.
    host.complete('a', { reason: 'error' });
    await tick();
    snap = runner.getRunState('rt', 'r1')!;
    expect(snap.status).toBe('failed');
    expect(snap.nodes[0]!.state).toBe('failed');
    expect(readRunLog(root, 'rt', 'r1').some((e) => e.kind === 'node-retry')).toBe(true);
  });

  it('does not retry when retry.limit is 0', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rt0', title: 'Rt0', goal: 'g', nodes: [{ id: 'a', prompt: 'a', retry: { limit: 0 } }] }),
    );
    const runner = makeRunner();
    runner.run('rt0', { runId: 'r1' });
    await tick();
    host.complete('a', { reason: 'error' });
    await tick();
    expect(runner.getRunState('rt0', 'r1')!.status).toBe('failed');
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
  });

  it('feeds the prior failure into the retried prompt and can then succeed', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rtok', title: 'RtOk', goal: 'g', nodes: [{ id: 'a', prompt: 'do a', retry: { limit: 2 } }] }),
    );
    const runner = makeRunner();
    runner.run('rtok', { runId: 'r1' });
    await tick();

    host.complete('a', { reason: 'timeout' });
    await tick();
    const retryPrompt = host.sent.filter((s) => s.sessionId === 'sess-a')[1]!.message;
    expect(retryPrompt).toContain('Previous attempt failed: timeout');
    expect(retryPrompt).toContain('do a');

    host.complete('a', { finalText: 'OK' });
    await tick();
    expect(runner.getRunState('rtok', 'r1')!.status).toBe('completed');
  });

  it('does not retry on error when retry.when targets a different failure class', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rtw', title: 'RtW', goal: 'g', nodes: [{ id: 'a', prompt: 'a', retry: { limit: 3, when: 'empty' } }] }),
    );
    const runner = makeRunner();
    runner.run('rtw', { runId: 'r1' });
    await tick();
    host.complete('a', { reason: 'error' });
    await tick();
    expect(runner.getRunState('rtw', 'r1')!.status).toBe('failed');
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
  });

  it('completes without verifying when there is no orchestrator', async () => {
    saveTaskSpec(root, specOf({ id: 'nov', title: 'NoV', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('nov', { runId: 'r1' }); // no orchestratorSessionId → nothing to verify against
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('nov', 'r1')!.status).toBe('completed');
    expect(readRunLog(root, 'nov', 'r1').some((e) => e.kind === 'run-verifying')).toBe(false);
  });

  it('gates the run on the orchestrator verdict and includes acceptance_criteria in the prompt', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'vp', title: 'Vp', goal: 'g', acceptance_criteria: 'must be perfect', nodes: [{ id: 'a', prompt: 'do a' }] }),
    );
    const runner = makeRunner();
    runner.run('vp', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('vp', 'r1')!.status).toBe('verifying');
    const vmsg = host.sent.find((s) => s.sessionId === 'orch')!.message;
    expect(vmsg).toContain('must be perfect');
    expect(vmsg).toContain('VERDICT: PASS');

    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('vp', 'r1')!.status).toBe('completed');
  });

  it('re-runs the terminal node once on a FAIL verdict, then completes on PASS', async () => {
    saveTaskSpec(root, specOf({ id: 'vf', title: 'Vf', goal: 'g', nodes: [{ id: 'a', prompt: 'do a' }] }));
    const runner = makeRunner();
    runner.run('vf', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'first' });
    await tick();

    host.completeSession('orch', { finalText: 'Not good enough.\nVERDICT: FAIL — missing X' });
    await tick();
    const snap = runner.getRunState('vf', 'r1')!;
    expect(snap.status).toBe('running');
    expect(snap.nodes[0]!.state).toBe('running');
    expect(snap.nodes[0]!.attempt).toBe(2);
    const retryPrompt = host.sent.filter((s) => s.sessionId === 'sess-a')[1]!.message;
    expect(retryPrompt).toContain('rejected on verification: missing X');

    host.complete('a', { finalText: 'second' });
    await tick();
    expect(runner.getRunState('vf', 'r1')!.status).toBe('verifying');
    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('vf', 'r1')!.status).toBe('completed');
  });

  it('fails the run when FAIL verdicts exhaust the repair budget (max_iterations)', async () => {
    // max_iterations: 1 → one repair allowed; the second FAIL breaches the iteration budget.
    saveTaskSpec(root, specOf({ id: 'vff', title: 'Vff', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'do a' }] }));
    const runner = makeRunner();
    runner.run('vff', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — nope' });
    await tick();
    expect(runner.getRunState('vff', 'r1')!.status).toBe('running'); // first repair in flight

    host.complete('a', { finalText: 'y' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — still nope' });
    await tick();
    expect(runner.getRunState('vff', 'r1')!.status).toBe('failed');
    const log = readRunLog(root, 'vff', 'r1');
    expect(log.filter((e) => e.kind === 'verdict').length).toBe(2);
    expect(log.some((e) => e.kind === 'budget-breach' && (e as { metric?: string }).metric === 'iterations')).toBe(true);
    expect(log.some((e) => e.kind === 'run-failed')).toBe(true);
  });

  it('re-asks on an unparsable verdict and fails only after the re-ask budget is exhausted', async () => {
    saveTaskSpec(root, specOf({ id: 'unp', title: 'Unp', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('unp', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();

    // First malformed reply → re-asked, run stays verifying (not terminal).
    host.completeSession('orch', { finalText: 'I think it is fine but forgot the verdict line.' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('verifying');
    expect(host.sent.filter((s) => s.sessionId === 'orch' && s.message.includes('did not include a parseable verdict')).length).toBe(1);

    // Second malformed reply → re-asked again (MAX_UNPARSED_REASKS = 2).
    host.completeSession('orch', { finalText: 'still no verdict line, sorry' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('verifying');

    // Third malformed reply → budget exhausted → failed.
    host.completeSession('orch', { finalText: 'nope, no verdict again' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('failed');
    expect(readRunLog(root, 'unp', 'r1').filter((e) => e.kind === 'verdict' && (e as { result?: string }).result === 'unparsed').length).toBe(3);
  });

  it('scopes a repair to the named nodes and their transitive dependents', async () => {
    // Chain a → b → c. A FAIL naming only `b` must re-run b AND c (downstream), but leave a done.
    saveTaskSpec(
      root,
      specOf({
        id: 'scope',
        title: 'Scope',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
          { id: 'c', depends_on: ['b'], prompt: 'c ${nodes.b.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('scope', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'A' });
    await tick();
    host.complete('b', { finalText: 'B' });
    await tick();
    host.complete('c', { finalText: 'C' });
    await tick();
    expect(runner.getRunState('scope', 'r1')!.status).toBe('verifying');

    host.completeSession('orch', { finalText: 'VERDICT: FAIL — nodes=b — b is wrong' });
    await tick();
    const snap = runner.getRunState('scope', 'r1')!;
    expect(snap.status).toBe('running');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('done'); // upstream untouched
    expect(snap.nodes.find((n) => n.id === 'b')!.state).toBe('running'); // re-dispatched
    expect(snap.nodes.find((n) => n.id === 'c')!.state).toBe('pending'); // waits on b
    // a ran once; b re-dispatched (2); c not yet re-dispatched.
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
    expect(host.created.filter((c) => c.options.name === 'b')).toHaveLength(2);
    expect(host.created.filter((c) => c.options.name === 'c')).toHaveLength(1);
  });

  it('an unparsed re-ask does not consume the repair budget', async () => {
    // max_iterations: 1. An intervening unparsed verdict must not eat the single repair allowance.
    saveTaskSpec(root, specOf({ id: 'unb', title: 'Unb', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('unb', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();

    host.completeSession('orch', { finalText: 'no verdict here' }); // unparsed → re-ask
    await tick();
    expect(runner.getRunState('unb', 'r1')!.status).toBe('verifying');

    host.completeSession('orch', { finalText: 'VERDICT: FAIL — fix it' }); // first real FAIL → repair still allowed
    await tick();
    expect(runner.getRunState('unb', 'r1')!.status).toBe('running');
  });

  it('does not hang in verifying when the verification send rejects', async () => {
    saveTaskSpec(root, specOf({ id: 'snd', title: 'Snd', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('snd', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    // Make the orchestrator verification send reject (the verdict can never arrive).
    const origSend = host.sendMessage.bind(host);
    host.sendMessage = async (sessionId: string, message: string) => {
      if (sessionId === 'orch') throw new Error('send boom');
      return origSend(sessionId, message);
    };
    host.complete('a', { finalText: 'x' });
    await tick();
    await tick();
    expect(runner.getRunState('snd', 'r1')!.status).toBe('failed');
  });

  it('ignores a verdict that arrives after the run was stopped', async () => {
    saveTaskSpec(root, specOf({ id: 'late', title: 'Late', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('late', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('late', 'r1')!.status).toBe('verifying');

    await runner.stop('late', 'r1');
    expect(runner.getRunState('late', 'r1')!.status).toBe('stopped');

    // A late verdict for the (now stopped) run must not flip it back to completed/failed.
    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('late', 'r1')!.status).toBe('stopped');
  });

  it('reconstructs the repair counter from the run-log on a cross-restart resume', async () => {
    // max_iterations: 1. Consume the single repair, then "restart": the resumed run must remember
    // repairsUsed=1 (from the persisted FAIL verdict) so the next FAIL fails immediately.
    saveTaskSpec(root, specOf({ id: 'hyd', title: 'Hyd', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'a' }] }));
    const r1 = makeRunner();
    r1.run('hyd', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — redo' }); // consumes the one repair
    await tick();
    expect(r1.getRunState('hyd', 'r1')!.status).toBe('running');

    // Restart: fresh host + runner with empty in-memory state, resume from the run-log.
    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    const scanned = r2.scanUnfinished();
    expect(scanned.some((s) => s.runId === 'r1' && s.status === 'interrupted')).toBe(true);
    r2.continue('hyd', 'r1');
    await tick();
    expect(r2.getRunState('hyd', 'r1')!.status).toBe('verifying');

    // A single FAIL now exhausts the (carried-over) budget immediately.
    host2.completeSession('orch', { finalText: 'VERDICT: FAIL — still bad' });
    await tick();
    expect(r2.getRunState('hyd', 'r1')!.status).toBe('failed');
  });

  it('fails a node that completes with no text despite declaring outputs (instead of marking it done)', async () => {
    // Bug 2: a clean turn-completion is not proof of success. A node that declared `outputs` but
    // produced empty final text delivered nothing — it must fail (→ needs-review), not silently pass.
    saveTaskSpec(
      root,
      specOf({
        id: 'empty',
        title: 'Empty',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'result' }] }],
      }),
    );
    const runner = makeRunner();
    runner.run('empty', { runId: 'r1' });
    await tick();

    host.complete('a', { finalText: '   ' }); // whitespace-only → counts as empty
    await tick();

    const snap = runner.getRunState('empty', 'r1')!;
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('failed');
    expect(snap.status).toBe('failed');
    expect(host.statuses.some((s) => s.sessionId === 'sess-a' && s.status === 'needs-review')).toBe(true);
  });

  it('still marks a node done on empty text when it declares no outputs (lenient default)', async () => {
    // The empty-output guard must only bite nodes that declared outputs; output-less nodes keep the
    // lenient "completed = done" behavior.
    saveTaskSpec(root, specOf({ id: 'lenient', title: 'Lenient', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('lenient', { runId: 'r1' });
    await tick();

    host.complete('a', { finalText: '' });
    await tick();

    expect(runner.getRunState('lenient', 'r1')!.nodes.find((n) => n.id === 'a')!.state).toBe('done');
  });

  it('publishes the total node count to the orchestrator at run start (stable board denominator)', async () => {
    // Bug 3: the board derives subtask progress from lazily-spawned child sessions, so without an
    // up-front total the denominator grows (0/1 → 1/2 …). The runner publishes spec.nodes.length once.
    saveTaskSpec(
      root,
      specOf({
        id: 'count',
        title: 'Count',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
          { id: 'c', depends_on: ['b'], prompt: 'c' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('count', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    expect(host.nodeCounts).toContainEqual({ sessionId: 'orch', count: 3 });
  });

  it('skips non-session node kinds and only dispatches session nodes', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'kinds',
        title: 'Kinds',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'gate', kind: 'approval', prompt: 'ignored' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('kinds', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false });
    await tick();

    expect(host.dispatchedNames()).toEqual(['a']);
    expect(runner.getRunState('kinds', 'r1')!.nodes.find((n) => n.id === 'gate')!.state).toBe('skipped');
    expect(host.nodeCounts).toContainEqual({ sessionId: 'orch', count: 2 });

    host.complete('a');
    await tick();
    host.complete('b');
    await tick();

    expect(host.dispatchedNames()).toEqual(['a', 'b']);
    expect(runner.getRunState('kinds', 'r1')!.status).toBe('completed');
  });

  it('treats skipped nodes as satisfied dependencies', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'skip-dep',
        title: 'Skip dep',
        goal: 'g',
        nodes: [
          { id: 'gate', kind: 'approval', prompt: 'ignored' },
          { id: 'work', depends_on: ['gate'], prompt: 'work' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('skip-dep', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false });
    await tick();

    expect(host.dispatchedNames()).toEqual(['work']);
    host.complete('work');
    await tick();
    expect(runner.getRunState('skip-dep', 'r1')!.status).toBe('completed');
  });

  it('refuses to start a v2 run that contains unimplemented kinds', () => {
    const { unimplementedV2Nodes } = require('./executors') as typeof import('./executors');
    expect(unimplementedV2Nodes([{ id: 'ghost', kind: 'not-a-kind' as never }])).toHaveLength(1);
  });

  it('runs a v2 file that only uses implemented kinds', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'v2-ok',
        title: 'V2 ok',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a' }],
      }),
    );
    const runner = makeRunner();
    runner.run('v2-ok', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['a']);
    host.complete('a');
    await tick();
    expect(runner.getRunState('v2-ok', 'r1')!.status).toBe('completed');
  });

  it('dispatches orchestrator-kind nodes (v1 escape hatch)', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'orch-kind',
        title: 'Orch kind',
        goal: 'g',
        nodes: [{ id: 'lead', kind: 'orchestrator', prompt: 'coordinate' }],
      }),
    );
    const runner = makeRunner();
    runner.run('orch-kind', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['lead']);
    host.complete('lead');
    await tick();
    expect(runner.getRunState('orch-kind', 'r1')!.status).toBe('completed');
  });

  it('does not dispatch deferred kinds when resuming a hydrated run', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'resume-skip',
        title: 'Resume skip',
        goal: 'g',
        nodes: [
          { id: 'work', prompt: 'work' },
          { id: 'gate', kind: 'route', prompt: 'ignored' },
        ],
      }),
    );
    const r1 = makeRunner();
    r1.run('resume-skip', { runId: 'r1', verifyOnComplete: false });
    await tick();
    r1.pause('resume-skip', 'r1');

    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r2.resume('resume-skip', 'r1');
    await tick();

    expect(host2.dispatchedNames()).toEqual(['work']);
    expect(r2.getRunState('resume-skip', 'r1')!.nodes.find((n) => n.id === 'gate')!.state).toBe('skipped');
  });

  it('scans a crashed running run as interrupted and continues without re-running done nodes', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'crash',
        title: 'Crash',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    const r1 = makeRunner();
    r1.run('crash', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['a', 'b']);

    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    const scanned = r2.scanUnfinished();
    expect(scanned[0]?.status).toBe('interrupted');
    expect(scanned[0]?.nodes.find((n) => n.id === 'a')!.state).toBe('done');
    expect(scanned[0]?.nodes.find((n) => n.id === 'b')!.state).toBe('interrupted');
    expect(host2.dispatchedNames()).toEqual([]);

    expect(() => r2.resume('crash', 'r1')).toThrow(TaskControlError);

    r2.continue('crash', 'r1');
    await tick();
    expect(host2.dispatchedNames()).toEqual(['b']);
    expect(host2.promptFor('b')).toBe('b A');
    host2.complete('b', { finalText: 'B' });
    await tick();
    expect(r2.getRunState('crash', 'r1')!.status).toBe('completed');
  });

  it('restores the checkpointed run revision and ignores a newer orphan revision file', async () => {
    const frozen = specOf({
      schema_version: 2,
      id: 'frozen',
      title: 'Frozen',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'a' }],
    });
    saveTaskSpec(root, frozen);
    const r1 = makeRunner();
    r1.run('frozen', { runId: 'r1', verifyOnComplete: false });
    await tick();

    // Simulate a crash after a revision file was written but before any event
    // or checkpoint acknowledged it.
    writeSpecRevision(root, 'frozen', 'r1', 1, {
      ...frozen,
      nodes: [...frozen.nodes, { id: 'orphan', kind: 'session', prompt: 'must not run' }],
    });

    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root });
    const [snapshot] = r2.scanUnfinished();
    expect(snapshot?.revision).toBe(0);
    expect(snapshot?.nodes.map((node) => node.id)).toEqual(['a']);
  });

  it('moves a child onto a custom dropStatusId column and keeps the top card off done', async () => {
    const columns = [
      { id: 'doing', dropStatusId: 'in-progress' },
      { id: 'review', dropStatusId: 'needs-review' },
    ];
    host.resolveKanbanColumn = async (_id, status) => {
      const { resolveKanbanColumnId } = await import('@craft-agent/shared/tasks');
      return resolveKanbanColumnId(status, columns);
    };
    saveTaskSpec(root, specOf({ id: 'mapcol', title: 'Map', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('mapcol', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false });
    await tick();
    expect(host.columns).toContainEqual({ sessionId: 'orch', column: 'doing' });
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(host.columns).toContainEqual({ sessionId: 'orch', column: 'review' });
    expect(host.statuses).toContainEqual({ sessionId: 'orch', status: 'needs-review' });
  });

  it('emits a snapshot on every run change', async () => {
    const snaps: string[] = [];
    saveTaskSpec(root, specOf({ id: 'push', title: 'Push', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = new TaskRunner({
      host,
      workspaceId: 'ws',
      workspaceRoot: root,
      now: () => '2026-06-07T00:00:00.000Z',
      onRunChanged: (s) => snaps.push(s.status),
    });
    runner.run('push', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(snaps).toContain('running');
    expect(snaps).toContain('completed');
  });

  it('v2 parallel completes without a session and unblocks dependents', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'par',
        title: 'Par',
        goal: 'g',
        nodes: [
          { id: 'fork', kind: 'parallel' },
          { id: 'a', depends_on: ['fork'], prompt: 'a' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('par', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(existsSync(specRevisionPath(root, 'par', 'r1', 0))).toBe(true);
    expect(host.dispatchedNames()).toEqual(['a']);
    expect(runner.getRunState('par', 'r1')!.nodes.find((n) => n.id === 'fork')!.state).toBe('done');
    host.complete('a');
    await tick();
    expect(runner.getRunState('par', 'r1')!.status).toBe('completed');
  });

  it('v2 route skips the unselected branch', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'rt',
        title: 'Rt',
        goal: 'g',
        params: [{ name: 'env', default: 'dev' }],
        nodes: [
          {
            id: 'decide',
            kind: 'route',
            route: {
              cases: [{ when: { ref: 'params.env', op: 'eq', value: 'prod' }, goto: 'prod' }],
              default: 'dev',
            },
          },
          { id: 'prod', depends_on: ['decide'], prompt: 'prod' },
          { id: 'dev', depends_on: ['decide'], prompt: 'dev' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('rt', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['dev']);
    expect(runner.getRunState('rt', 'r1')!.nodes.find((n) => n.id === 'prod')!.state).toBe('skipped');
    host.complete('dev');
    await tick();
    expect(runner.getRunState('rt', 'r1')!.status).toBe('completed');
  });

  it('v2 approval waits, reject fails, approve continues', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'appr',
        title: 'Appr',
        goal: 'g',
        nodes: [
          { id: 'gate', kind: 'approval' },
          { id: 'work', depends_on: ['gate'], prompt: 'work' },
        ],
      }),
    );
    const rejector = makeRunner();
    rejector.run('appr', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(rejector.getRunState('appr', 'r1')!.status).toBe('waiting-approval');
    rejector.respondApproval('appr', 'r1', 'gate', false);
    await tick();
    expect(rejector.getRunState('appr', 'r1')!.nodes.find((n) => n.id === 'gate')!.state).toBe('failed');
    expect(rejector.getRunState('appr', 'r1')!.status).toBe('failed');

    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'appr2',
        title: 'Appr2',
        goal: 'g',
        nodes: [
          { id: 'gate', kind: 'approval' },
          { id: 'work', depends_on: ['gate'], prompt: 'work' },
        ],
      }),
    );
    const approver = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    approver.run('appr2', { runId: 'r2', verifyOnComplete: false });
    await tick();
    approver.respondApproval('appr2', 'r2', 'gate', true);
    await tick();
    expect(host.dispatchedNames()).toContain('work');
    host.complete('work');
    await tick();
    expect(approver.getRunState('appr2', 'r2')!.status).toBe('completed');

    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'appr3',
        title: 'Appr3',
        goal: 'g',
        nodes: [
          { id: 'gate', kind: 'approval', timeout: 1 },
          { id: 'work', depends_on: ['gate'], prompt: 'work' },
        ],
      }),
    );
    let now = '2026-06-07T00:00:00.000Z';
    const timed = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => now });
    timed.run('appr3', { runId: 'r3', verifyOnComplete: false });
    await tick();
    expect(timed.getRunState('appr3', 'r3')!.status).toBe('waiting-approval');
    now = '2026-06-07T00:00:02.000Z';
    const scanned = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => now });
    scanned.scanUnfinished();
    expect(scanned.getRunState('appr3', 'r3')!.nodes.find((n) => n.id === 'gate')!.state).toBe('failed');
    expect(scanned.getRunState('appr3', 'r3')!.status).toBe('interrupted');
  });

  it('v2 finally runs after a failure and does not overwrite the original failure', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'fin',
        title: 'Fin',
        goal: 'g',
        nodes: [
          { id: 'work', prompt: 'work' },
          { id: 'cleanup', kind: 'finally', prompt: 'cleanup' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('fin', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('work', { reason: 'error' });
    await tick();
    expect(host.dispatchedNames()).toContain('cleanup');
    host.complete('cleanup');
    await tick();
    expect(runner.getRunState('fin', 'r1')!.status).toBe('failed');
    expect(runner.getRunState('fin', 'r1')!.nodes.find((n) => n.id === 'cleanup')!.state).toBe('done');
  });

  it('v2 stop still runs a ready finally node', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'stfin',
        title: 'Stfin',
        goal: 'g',
        nodes: [
          { id: 'work', prompt: 'work' },
          { id: 'cleanup', kind: 'finally', prompt: 'cleanup' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('stfin', { runId: 'r1', verifyOnComplete: false });
    await tick();
    await runner.stop('stfin', 'r1');
    await tick();
    expect(host.cancelled).toContain('sess-work');
    expect(host.dispatchedNames()).toContain('cleanup');
    host.complete('cleanup');
    await tick();
    expect(runner.getRunState('stfin', 'r1')!.status).toBe('stopped');
  });

  it('v2 stop runs finally even when the run is already over its token budget', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'stfin-budget',
        title: 'Stfin budget',
        goal: 'g',
        token_budget: 1,
        nodes: [
          { id: 'work', prompt: 'work' },
          { id: 'cleanup', kind: 'finally', prompt: 'cleanup' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('stfin-budget', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('work', { finalText: 'done', tokenUsage: tu(2, 2) });
    await tick();
    expect(runner.getRunState('stfin-budget', 'r1')?.status).toBe('waiting-budget');

    await runner.stop('stfin-budget', 'r1');
    await tick();
    expect(host.dispatchedNames()).toContain('cleanup');
    host.complete('cleanup');
    await tick();
    expect(runner.getRunState('stfin-budget', 'r1')?.status).toBe('stopped');
  });

  it('v2 stop still settles and runs finally when descendant cancellation throws', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'stfin-cancel-error',
      title: 'Stfin cancel error',
      goal: 'g',
      nodes: [
        { id: 'work', prompt: 'work' },
        { id: 'cleanup', kind: 'finally', prompt: 'cleanup' },
      ],
    }));
    host.stopSwarm = async () => { throw new Error('swarm transport failed'); };
    host.cancelProcessing = async () => { throw new Error('cancel transport failed'); };
    const runner = makeRunner();
    runner.run('stfin-cancel-error', { runId: 'r1', verifyOnComplete: false });
    await tick();
    await runner.stop('stfin-cancel-error', 'r1');
    await tick();
    expect(host.dispatchedNames()).toContain('cleanup');
    host.complete('cleanup');
    await tick();
    expect(runner.getRunState('stfin-cancel-error', 'r1')?.status).toBe('stopped');
  });

  it('v2 skips a node whose when condition is false', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'when',
        title: 'When',
        goal: 'g',
        params: [{ name: 'ok', default: false }],
        nodes: [
          { id: 'maybe', prompt: 'maybe', when: { ref: 'params.ok', op: 'eq', value: true } },
          { id: 'always', prompt: 'always' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('when', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['always']);
    expect(runner.getRunState('when', 'r1')!.nodes.find((n) => n.id === 'maybe')!.state).toBe('skipped');
    host.complete('always');
    await tick();
    expect(runner.getRunState('when', 'r1')!.status).toBe('completed');
  });

  it('v2 marks a node invalid when declared outputs are not submitted', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'out',
        title: 'Out',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'summary', required: true }] }],
      }),
    );
    const runner = makeRunner();
    runner.run('out', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'ignored without submit' });
    await tick();
    expect(runner.getRunState('out', 'r1')!.nodes.find((n) => n.id === 'a')!.state).toBe('invalid');
    expect(runner.getRunState('out', 'r1')!.status).toBe('failed');
  });

  it('v2 accepts submit_task_output and submit_task_verdict; parent text is not a verdict', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'ver',
        title: 'Ver',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'summary' }] }],
      }),
    );
    const runner = makeRunner();
    runner.run('ver', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    expect(runner.submitNodeOutput('sess-a', { values: { summary: 'ok' } }).ok).toBe(true);
    host.complete('a', { finalText: 'assistant prose' });
    await tick();
    expect(runner.getRunState('ver', 'r1')!.status).toBe('verifying');
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — human chatter' });
    await tick();
    expect(runner.getRunState('ver', 'r1')!.status).toBe('verifying');
    runner.submitVerdict('orch', { result: 'pass' });
    expect(runner.getRunState('ver', 'r1')!.status).toBe('completed');
  });

  it('v2 rejects missing and incorrectly typed structured outputs', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'typed-out',
        title: 'Typed out',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'score', type: 'number' }] }],
      }),
    );
    const runner = makeRunner();
    runner.run('typed-out', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(runner.submitNodeOutput('sess-a', { text: 'prose only' })).toEqual({
      ok: false,
      error: 'Missing required output "score"',
    });
    expect(runner.submitNodeOutput('sess-a', { values: { score: 'high' } })).toEqual({
      ok: false,
      error: 'Output "score" must be a finite number',
    });
    expect(runner.submitNodeOutput('sess-a', { values: { score: 9 } })).toEqual({ ok: true });
  });

  it('v2 waiting-budget promotes only when idle and resumes after updateRunLimits', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'bud',
        title: 'Bud',
        goal: 'g',
        token_budget: 1,
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('bud', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'A', tokenUsage: tu(2, 2) });
    await tick();
    expect(runner.getRunState('bud', 'r1')).toEqual(expect.objectContaining({
      status: 'waiting-budget',
      tokenBudget: 1,
      tokensUsed: 4,
    }));
    expect(() => runner.updateRunLimits('bud', 'r1', 0.5)).toThrow('only be increased');
    expect(runner.updateRunLimits('bud', 'r1', 100).tokenBudget).toBe(100);
    await tick();
    expect(host.dispatchedNames()).toContain('b');
    host.complete('b');
    await tick();
    expect(runner.getRunState('bud', 'r1')!.status).toBe('completed');
  });

  it('v2 map expands instances in order and unblocks dependents', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'mp',
        title: 'Mp',
        goal: 'g',
        params: [{ name: 'items', default: '["one","two"]' }],
        nodes: [
          { id: 'fan', kind: 'map', for_each: '${params.items}', prompt: 'do ${item}' },
          { id: 'after', depends_on: ['fan'], prompt: 'got ${nodes.fan.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('mp', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0', 'fan#1']);
    expect(host.promptFor('fan#0')).toContain('do one');
    host.complete('fan#0', { finalText: 'A' });
    host.complete('fan#1', { finalText: 'B' });
    await tick();
    expect(host.promptFor('after')).toContain('A');
    expect(host.promptFor('after')).toContain('B');
    host.complete('after');
    await tick();
    expect(runner.getRunState('mp', 'r1')!.status).toBe('completed');
  });

  it('v2 replicas run with bounded concurrency and aggregate in source order', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'rep',
        title: 'Rep',
        goal: 'g',
        max_parallel: 2,
        nodes: [
          { id: 'fan', prompt: 'replica ${index}', replicas: 3, aggregate: 'concat' },
          { id: 'after', depends_on: ['fan'], prompt: 'joined ${nodes.fan.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('rep', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0', 'fan#1']);
    expect(host.promptFor('fan#0')).toContain('replica 0');

    // Completion order does not affect aggregate order.
    host.complete('fan#1', { finalText: 'B' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0', 'fan#1', 'fan#2']);
    host.complete('fan#2', { finalText: 'C' });
    host.complete('fan#0', { finalText: 'A' });
    await tick();
    expect(host.promptFor('after')).toContain('A\nB\nC');
    host.complete('after');
    await tick();
    expect(runner.getRunState('rep', 'r1')!.status).toBe('completed');
  });

  it('v2 retries the failed replica instance with the prior failure reason', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'rep-retry',
        title: 'Rep retry',
        goal: 'g',
        max_parallel: 1,
        nodes: [{ id: 'fan', prompt: 'replica ${index}', replicas: 2, aggregate: 'concat', retry: { limit: 1, when: 'error' } }],
      }),
    );
    const runner = makeRunner();
    runner.run('rep-retry', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('fan#0', { reason: 'error' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0', 'fan#0']);
    expect(host.sent.at(-1)?.message).toContain('Previous attempt failed: error');
    host.complete('fan#0', { finalText: 'A' });
    await tick();
    host.complete('fan#1', { finalText: 'B' });
    await tick();
    expect(runner.getRunState('rep-retry', 'r1')!.status).toBe('completed');
  });

  it('v2 continues interrupted replica instances from the frozen run graph', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'rep-resume',
        title: 'Rep resume',
        goal: 'g',
        max_parallel: 1,
        nodes: [{ id: 'fan', prompt: 'replica ${index}', replicas: 2, aggregate: 'concat' }],
      }),
    );
    const first = makeRunner();
    first.run('rep-resume', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['fan#0']);

    const resumedHost = new MockHost();
    const resumed = new TaskRunner({ host: resumedHost, workspaceId: 'ws', workspaceRoot: root });
    expect(resumed.scanUnfinished()[0]?.status).toBe('interrupted');
    resumed.continue('rep-resume', 'r1');
    await tick();
    expect(resumedHost.dispatchedNames()).toEqual(['fan#0']);
    resumedHost.complete('fan#0', { finalText: 'A' });
    await tick();
    resumedHost.complete('fan#1', { finalText: 'B' });
    await tick();
    expect(resumed.getRunState('rep-resume', 'r1')!.status).toBe('completed');
  });

  it('v2 map instance accepts submit_task_output against the definition node', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'mpo',
        title: 'Mpo',
        goal: 'g',
        params: [{ name: 'items', default: '["one"]' }],
        nodes: [
          {
            id: 'fan',
            kind: 'map',
            for_each: '${params.items}',
            prompt: 'do ${item}',
            outputs: [{ name: 'item', required: true }],
          },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('mpo', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(runner.submitNodeOutput(host.sessionIdFor('fan#0'), { values: { item: 'one' } })).toEqual({ ok: true });
  });

  it('v2 map over 256 instances fails the run', async () => {
    const items = JSON.stringify(Array.from({ length: 300 }, (_, i) => i));
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'big',
        title: 'Big',
        goal: 'g',
        params: [{ name: 'items', default: items }],
        nodes: [{ id: 'fan', kind: 'map', for_each: '${params.items}', prompt: 'do ${item}' }],
      }),
    );
    const runner = makeRunner();
    runner.run('big', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(runner.getRunState('big', 'r1')!.status).toBe('failed');
    expect(host.dispatchedNames()).toEqual([]);
  });

  it('v2 loop iterates until the condition and fails when max is exhausted', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'lp',
        title: 'Lp',
        goal: 'g',
        nodes: [
          {
            id: 'iter',
            kind: 'loop',
            loop: { until: { ref: 'nodes.iter.output', op: 'contains', value: 'STOP' }, max: 5 },
            prompt: 'n=${index}',
          },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('lp', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['iter#0']);
    host.complete('iter#0', { finalText: 'go' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['iter#0', 'iter#1']);
    host.complete('iter#1', { finalText: 'STOP' });
    await tick();
    expect(runner.getRunState('lp', 'r1')!.status).toBe('completed');

    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'lp2',
        title: 'Lp2',
        goal: 'g',
        nodes: [
          {
            id: 'iter',
            kind: 'loop',
            loop: { until: { ref: 'nodes.iter.output', op: 'eq', value: 'never' }, max: 2 },
            prompt: 'n=${index}',
          },
        ],
      }),
    );
    const runner2 = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    runner2.run('lp2', { runId: 'r2', verifyOnComplete: false });
    await tick();
    host.complete('iter#0', { finalText: 'a' });
    await tick();
    host.complete('iter#1', { finalText: 'b' });
    await tick();
    expect(runner2.getRunState('lp2', 'r2')!.status).toBe('failed');

    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'lp3',
        title: 'Lp3',
        goal: 'g',
        nodes: [
          {
            id: 'iter',
            kind: 'loop',
            loop: { until: { ref: 'nodes.iter.output', op: 'eq', value: 'never' }, max: 1, else: 'fallback' },
            prompt: 'n=${index}',
          },
          { id: 'fallback', depends_on: ['iter'], prompt: 'fb' },
          { id: 'okpath', depends_on: ['iter'], prompt: 'ok' },
        ],
      }),
    );
    const runner3 = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    runner3.run('lp3', { runId: 'r3', verifyOnComplete: false });
    await tick();
    host.complete('iter#0', { finalText: 'still-going' });
    await tick();
    expect(runner3.getRunState('lp3', 'r3')!.nodes.find((n) => n.id === 'okpath')!.state).toBe('skipped');
    expect(host.dispatchedNames()).toContain('fallback');
    host.complete('fallback');
    await tick();
    expect(runner3.getRunState('lp3', 'r3')!.status).toBe('completed');
  });

  it('v2 loop carries item, index, and previous output into each iteration', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'loop-carry',
      title: 'Loop carry',
      goal: 'g',
      params: [{ name: 'seed', default: 'initial' }],
      nodes: [{
        id: 'iter',
        kind: 'loop',
        loop: { until: { ref: 'nodes.iter.output', op: 'contains', value: 'STOP' }, max: 2, carry: '${params.seed}' },
        prompt: '${item}|${index}|${prev}',
      }],
    }));
    const runner = makeRunner();
    runner.run('loop-carry', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.promptFor('iter#0')).toBe('initial|0|');
    host.complete('iter#0', { finalText: 'next' });
    await tick();
    expect(host.promptFor('iter#1')).toBe('next|1|next');
    host.complete('iter#1', { finalText: 'STOP' });
    await tick();
    expect(runner.getRunState('loop-carry', 'r1')?.status).toBe('completed');
  });

  it('v2 session timeout fails and cancels a node instead of being silently ignored', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'node-timeout',
      title: 'Node timeout',
      goal: 'g',
      nodes: [{ id: 'slow', prompt: 'slow', timeout: 0.01 }],
    }));
    const runner = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root });
    runner.run('node-timeout', { runId: 'r1', verifyOnComplete: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.getRunState('node-timeout', 'r1')).toMatchObject({ status: 'failed' });
    expect(runner.getRunState('node-timeout', 'r1')?.nodes[0]).toMatchObject({ state: 'failed', blocker: 'node-timeout' });
    expect(host.cancelled).toContain('sess-slow');
  });

  it('v2 filter and aggregate transform without sessions', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'xf',
        title: 'Xf',
        goal: 'g',
        params: [{ name: 'items', default: '["keep-a","drop","keep-b"]' }],
        nodes: [
          { id: 'flt', kind: 'filter', for_each: '${params.items}', when: { ref: 'item', op: 'contains', value: 'keep' } },
          { id: 'left', prompt: 'L' },
          { id: 'right', prompt: 'R' },
          { id: 'agg', kind: 'aggregate', depends_on: ['left', 'right'], aggregate: 'concat' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('xf', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(JSON.parse(readNodeOutput(root, 'xf', 'r1', 'flt')!.text)).toEqual(['keep-a', 'keep-b']);
    host.complete('left', { finalText: 'L' });
    host.complete('right', { finalText: 'R' });
    await tick();
    expect(readNodeOutput(root, 'xf', 'r1', 'agg')!.text).toContain('L');
    expect(runner.getRunState('xf', 'r1')!.status).toBe('completed');
  });

  it('v2 continue after restart requires re-entering sensitive params', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'sec',
        title: 'Sec',
        goal: 'g',
        params: [{ name: 'token', sensitive: true }],
        nodes: [{ id: 'a', prompt: 'use ${params.token}' }],
      }),
    );
    const runner = makeRunner();
    runner.run('sec', { runId: 'r1', params: { token: 's3cret' }, verifyOnComplete: false });
    await tick();
    expect(host.promptFor('a')).toContain('s3cret');
    const runner2 = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    expect(runner2.scanUnfinished()[0]?.status).toBe('interrupted');
    expect(() => runner2.continue('sec', 'r1')).toThrow(/Sensitive params/);
    runner2.updateRunLimits('sec', 'r1', undefined, { token: 's3cret' });
    runner2.continue('sec', 'r1');
    await tick();
    expect(host.dispatchedNames().filter((n) => n === 'a').length).toBeGreaterThanOrEqual(1);
  });

  it('orchestrate patch adds a pending node and rejects edits to done nodes', async () => {
    const prev = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
    process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
    try {
      saveTaskSpec(
        root,
        specOf({
          schema_version: 2,
          id: 'orchp',
          title: 'Orchp',
          goal: 'g',
          runner: 'orchestrate',
          nodes: [{ id: 'a', prompt: 'a' }],
        }),
      );
      const runner = makeRunner();
      expect(() => runner.run('orchp', { runId: 'denied', verifyOnComplete: false })).toThrow(/Swarm mode/);
      runner.run('orchp', { runId: 'r1', verifyOnComplete: false, orchestrateAllowed: true });
      await tick();
      host.complete('a', { finalText: 'A' });
      await tick();
      expect(() =>
        runner.applyOrchestrationPatch('orchp', 'r1', {
          runId: 'r1',
          decisionId: 'd1',
          baseRevision: 0,
          rationale: 'cannot touch done',
          update: [{ id: 'a', kind: 'session', prompt: 'nope' }],
        }),
      ).toThrow(/completed/);
      saveTaskSpec(
        root,
        specOf({
          schema_version: 2,
          id: 'orchp2',
          title: 'Orchp2',
          goal: 'g',
          runner: 'orchestrate',
          nodes: [{ id: 'a', prompt: 'a' }],
        }),
      );
      const r2 = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
      r2.run('orchp2', { runId: 'r2', verifyOnComplete: false, orchestrateAllowed: true });
      await tick();
      const snap = r2.applyOrchestrationPatch('orchp2', 'r2', {
        runId: 'r2',
        decisionId: 'add-b',
        baseRevision: 0,
        rationale: 'append pending work',
        add: [{ id: 'b', kind: 'session', prompt: 'b', depends_on: ['a'] }],
      });
      expect(snap.revision).toBe(1);
      expect(snap.nodes.some((n) => n.id === 'b')).toBe(true);
      host.complete('a', { finalText: 'A' });
      await tick();
      expect(host.dispatchedNames()).toContain('b');
      const restarted = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
      restarted.scanUnfinished();
      expect(restarted.getRunState('orchp2', 'r2')!.revision).toBe(1);
      expect(restarted.getRunState('orchp2', 'r2')!.nodes.some((n) => n.id === 'b')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
      else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = prev;
    }
  });

  it('executes a verification-time orchestrate patch before accepting the final verdict', async () => {
    const prev = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
    process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
    try {
      saveTaskSpec(root, specOf({
        schema_version: 2,
        id: 'verify-patch',
        title: 'Verify patch',
        goal: 'g',
        runner: 'orchestrate',
        nodes: [{ id: 'a', prompt: 'a' }],
      }));
      const runner = makeRunner();
      runner.run('verify-patch', {
        runId: 'r1',
        orchestratorSessionId: 'orch',
        orchestrateAllowed: true,
      });
      await tick();
      host.complete('a', { finalText: 'A' });
      await tick();
      expect(runner.getRunState('verify-patch', 'r1')?.status).toBe('verifying');

      const patched = runner.applyOrchestrationPatch('verify-patch', 'r1', {
        runId: 'r1',
        decisionId: 'repair-b',
        baseRevision: 0,
        rationale: 'add verification repair',
        add: [{ id: 'b', kind: 'session', prompt: 'repair ${nodes.a.output}', depends_on: ['a'] }],
      });
      expect(patched.status).toBe('running');
      await tick();
      expect(host.dispatchedNames()).toContain('b');
      expect(() => runner.submitVerdict('orch', { runId: 'r1', result: 'pass' })).toThrow(/not waiting for a verdict/);

      host.complete('b', { finalText: 'B' });
      await tick();
      expect(runner.getRunState('verify-patch', 'r1')?.status).toBe('verifying');
      expect(runner.submitVerdict('orch', { runId: 'r1', result: 'pass' }).status).toBe('completed');
    } finally {
      if (prev === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
      else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = prev;
    }
  });

  it('prunes descendants exclusive to an unselected route branch but keeps the shared join', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'route-tree', title: 'Route tree', goal: 'g',
      nodes: [
        { id: 'route', kind: 'route', route: { cases: [{ when: { ref: 'params.env', op: 'eq', value: 'prod' }, goto: 'prod' }], default: 'dev' } },
        { id: 'prod', depends_on: ['route'], prompt: 'prod' },
        { id: 'prod-child', depends_on: ['prod'], prompt: 'prod child' },
        { id: 'dev', depends_on: ['route'], prompt: 'dev' },
        { id: 'dev-child', depends_on: ['dev'], prompt: 'dev child' },
        { id: 'join', depends_on: ['prod-child', 'dev-child'], prompt: 'join' },
      ],
      params: [{ name: 'env', default: 'dev' }],
    }));
    const runner = makeRunner();
    runner.run('route-tree', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['dev']);
    expect(runner.getRunState('route-tree', 'r1')?.nodes.find((n) => n.id === 'prod-child')?.state).toBe('skipped');
    host.complete('dev'); await tick();
    host.complete('dev-child'); await tick();
    expect(host.dispatchedNames()).toContain('join');
  });

  it('schedules synchronous control dependencies to a fixed point regardless of YAML order', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'reverse-control', title: 'Reverse', goal: 'g',
      nodes: [
        { id: 'work', depends_on: ['fork'], prompt: 'work' },
        { id: 'fork', kind: 'parallel' },
      ],
    }));
    const runner = makeRunner();
    runner.run('reverse-control', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.dispatchedNames()).toEqual(['work']);
  });

  it('keeps a one_success join alive when one branch fails and another can still succeed', async () => {
    saveTaskSpec(
      root,
      specOf({
        schema_version: 2,
        id: 'one-success',
        title: 'One success',
        goal: 'continue after the first successful branch',
        nodes: [
          { id: 'left', prompt: 'left' },
          { id: 'right', prompt: 'right' },
          { id: 'join', trigger: 'one_success', depends_on: ['left', 'right'], prompt: 'join' },
        ],
      }),
    );

    const runner = makeRunner();
    runner.run('one-success', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('left', { reason: 'error', finalText: 'left failed' });
    await tick();

    expect(runner.getRunState('one-success', 'r1')?.nodes.find((node) => node.id === 'join')?.state).toBe('pending');

    host.complete('right', { finalText: 'right succeeded' });
    await tick();
    expect(host.dispatchedNames()).toContain('join');

    host.complete('join', { finalText: 'joined' });
    await tick();
    expect(runner.getRunState('one-success', 'r1')).toMatchObject({ status: 'failed' });
    expect(runner.getRunState('one-success', 'r1')?.nodes.find((node) => node.id === 'join')?.state).toBe('done');
  });

  it('cancels pending descendants on stop and runs implicit finally before stopped', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'stop-chain', title: 'Stop chain', goal: 'g',
      nodes: [
        { id: 'a', prompt: 'a' },
        { id: 'b', depends_on: ['a'], prompt: 'b' },
        { id: 'cleanup', kind: 'finally', prompt: 'cleanup' },
      ],
    }));
    const runner = makeRunner();
    runner.run('stop-chain', { runId: 'r1', verifyOnComplete: false });
    await tick();
    const stopping = runner.stop('stop-chain', 'r1');
    await stopping;
    await tick();
    expect(host.dispatchedNames()).toEqual(['a', 'cleanup']);
    expect(runner.getRunState('stop-chain', 'r1')?.nodes.find((n) => n.id === 'b')?.state).toBe('cancelled');
    host.complete('cleanup'); await tick();
    expect(runner.getRunState('stop-chain', 'r1')?.status).toBe('stopped');
  });

  it('holds the final completed batch at waiting-budget until the user raises the ceiling', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'final-budget', title: 'Final budget', goal: 'g', token_budget: 1,
      nodes: [{ id: 'a', prompt: 'a' }],
    }));
    const runner = makeRunner();
    runner.run('final-budget', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('a', { finalText: 'done', tokenUsage: tu(2, 2) });
    await tick();
    expect(runner.getRunState('final-budget', 'r1')?.status).toBe('waiting-budget');
    expect(runner.updateRunLimits('final-budget', 'r1', 10).status).toBe('completed');
  });

  it('restores completed map instance outputs before continuing the remaining instances', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'map-restore', title: 'Map restore', goal: 'g', max_parallel: 1,
      params: [{ name: 'items', default: '["a","b"]' }],
      nodes: [{ id: 'fan', kind: 'map', for_each: '${params.items}', prompt: '${item}' }],
    }));
    const first = makeRunner();
    first.run('map-restore', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('fan#0', { finalText: 'A' });
    await tick();

    const resumedHost = new MockHost();
    const resumed = new TaskRunner({ host: resumedHost, workspaceId: 'ws', workspaceRoot: root });
    resumed.scanUnfinished();
    resumed.continue('map-restore', 'r1');
    await tick();
    resumedHost.complete('fan#1', { finalText: 'B' });
    await tick();
    expect(readNodeOutput(root, 'map-restore', 'r1', 'fan')?.text).toBe('A\nB');
  });

  it('does not reuse a structured output submitted by a failed attempt', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'stale-output', title: 'Stale output', goal: 'g',
      nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'value', required: true }], retry: { limit: 1, when: 'error' } }],
    }));
    const runner = makeRunner();
    runner.run('stale-output', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(runner.submitNodeOutput('sess-a', { values: { value: 'old' } })).toEqual({ ok: true });
    host.complete('a', { reason: 'error' }); await tick();
    host.complete('a', { finalText: 'new text only' }); await tick();
    expect(runner.getRunState('stale-output', 'r1')?.nodes[0]?.state).toBe('invalid');
  });

  it('allows only the parent coordinator to submit the structured verdict', async () => {
    saveTaskSpec(root, specOf({ schema_version: 2, id: 'verdict-owner', title: 'Verdict', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('verdict-owner', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick(); host.complete('a', { finalText: 'A' }); await tick();
    expect(() => runner.submitVerdict('sess-a', { runId: 'r1', result: 'pass' })).toThrow(/No verifying run/);
    expect(runner.submitVerdict('orch', { runId: 'r1', result: 'pass' }).status).toBe('completed');
  });

  it('persists non-sensitive params across restart and rejects unsafe or duplicate run ids', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'param-restore', title: 'Params', goal: 'g',
      params: [{ name: 'query', type: 'string' }], nodes: [{ id: 'a', prompt: '${params.query}' }],
    }));
    const first = makeRunner();
    expect(() => first.run('param-restore', { runId: '../escape', params: { query: 'kept' }, verifyOnComplete: false })).toThrow(/Invalid run id/);
    first.run('param-restore', { runId: 'r1', params: { query: 'kept' }, verifyOnComplete: false });
    await tick();
    expect(() => first.run('param-restore', { runId: 'r1', params: { query: 'other' }, verifyOnComplete: false })).toThrow(/already exists/);
    saveTaskSpec(root, specOf({
      schema_version: 2, id: 'other-task', title: 'Other', goal: 'g',
      nodes: [{ id: 'b', prompt: 'b' }],
    }));
    expect(() => first.run('other-task', { runId: 'r1', verifyOnComplete: false })).toThrow(/workspace/);
    const resumedHost = new MockHost();
    const resumed = new TaskRunner({ host: resumedHost, workspaceId: 'ws', workspaceRoot: root });
    resumed.scanUnfinished(); resumed.continue('param-restore', 'r1'); await tick();
    expect(resumedHost.promptFor('a')).toContain('kept');
  });
});
