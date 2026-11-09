import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import { parseTaskSpec, saveTaskSpec, readRunLog, type TaskSpec } from '@craft-agent/shared/tasks';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import { TaskRunner, type ConductorSessionHost } from './TaskRunner';
import { assessSpawnQualification, FIXED_SWARM_TOKEN_BUDGET } from '../sessions/spawn-session-orchestration.ts';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function specOf(raw: unknown): TaskSpec {
  const parsed = parseTaskSpec(raw);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
}

class MockHost implements ConductorSessionHost {
  private readonly listeners = new Set<(evt: SessionCompletionEvent) => void>();
  readonly created: { id: string; options: CreateSessionOptions }[] = [];
  readonly sent: { sessionId: string; message: string }[] = [];
  async createSession(_workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }> {
    const id = `sess-${options.name}`;
    this.created.push({ id, options });
    return { id };
  }
  async sendMessage(sessionId: string, message: string): Promise<void> {
    this.sent.push({ sessionId, message });
  }
  async setSessionStatus(): Promise<void> {}
  async setKanbanColumn(): Promise<void> {}
  async setTaskNodeCount(): Promise<void> {}
  async cancelProcessing(): Promise<void> {}
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getSessionFinalText(): string | undefined { return undefined; }
  getSessionWorkingDirectory(): string | undefined { return undefined; }
  complete(name: string, text: string): void {
    const evt: SessionCompletionEvent = {
      sessionId: `sess-${name}`,
      workspaceId: 'ws',
      generation: 0,
      reason: 'complete',
      finalText: text,
    };
    for (const listener of [...this.listeners]) listener(evt);
  }
}

describe('fixed quality scenarios', () => {
  it('fixed Swarm split requires two independent tool tracks', () => {
    expect(FIXED_SWARM_TOKEN_BUDGET).toBe(262_144);
    expect(assessSpawnQualification({
      tracks: [
        { name: 'code', input: 'repo', expectedOutput: 'findings', evidence: 'tests', toolKinds: ['shell'] },
        { name: 'docs', input: 'spec', expectedOutput: 'gaps', evidence: 'citations', toolKinds: ['browser'] },
      ],
      parallelBenefit: 'The tracks do not depend on each other.',
      finalAggregation: 'The coordinator merges findings and verifies conflicts.',
    }).eligible).toBe(true);
  });

  it('rejects an invalid Swarm split and keeps work in the parent session', () => {
    expect(assessSpawnQualification(undefined).eligible).toBe(false);
    expect(assessSpawnQualification({
      tracks: [{ name: 'only', input: 'q', expectedOutput: 'a', evidence: 'none', toolKinds: ['read'] }],
      parallelBenefit: 'none',
      finalAggregation: 'none',
    }).eligible).toBe(false);
  });

  let root: string;
  let host: MockHost;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'quality-scenarios-'));
    host = new MockHost();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runner() {
    return new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
  }

  it('DAG parallel honors max_parallel', async () => {
    saveTaskSpec(root, specOf({
      id: 'parallel',
      title: 'P',
      goal: 'g',
      max_parallel: 1,
      nodes: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }],
    }));
    const r = runner();
    r.run('parallel', { runId: 'r1', verifyOnComplete: false });
    await tick();
    expect(host.created).toHaveLength(1);
    host.complete('a', 'A');
    await tick();
    expect(host.created.map((c) => c.options.name)).toEqual(['a', 'b']);
  });

  it('data transforms stay local', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'xf',
      title: 'X',
      goal: 'g',
      nodes: [
        { id: 'src', prompt: 'src' },
        { id: 'flt', kind: 'filter', for_each: '${nodes.src.output}', when: { ref: 'item', op: 'contains', value: 'keep' } },
      ],
    }));
    const r = runner();
    r.run('xf', { runId: 'r1', verifyOnComplete: false });
    await tick();
    host.complete('src', '["keep-a","drop","keep-b"]');
    await tick();
    expect(host.created.map((c) => c.options.name)).toEqual(['src']);
  });

  it('verify + repair re-runs named nodes and dependents', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'repair',
      title: 'R',
      goal: 'g',
      acceptance_criteria: 'must mention both',
      nodes: [
        { id: 'a', prompt: 'a' },
        { id: 'b', prompt: 'b', depends_on: ['a'] },
      ],
    }));
    const r = runner();
    r.run('repair', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: true });
    await tick();
    host.complete('a', 'A');
    await tick();
    host.complete('b', 'B');
    await tick();
    r.submitVerdict('orch', { result: 'fail', reason: 'missing', nodes: ['a'] });
    const after = r.getRunState('repair', 'r1');
    expect(['pending', 'running']).toContain(after?.nodes.find((n) => n.id === 'a')?.state ?? '');
    expect(['pending', 'running']).toContain(after?.nodes.find((n) => n.id === 'b')?.state ?? '');
  });

  it('approval reject fails the node and crash recovery does not auto-schedule', async () => {
    saveTaskSpec(root, specOf({
      schema_version: 2,
      id: 'appr',
      title: 'A',
      goal: 'g',
      nodes: [
        { id: 'gate', kind: 'approval' },
        { id: 'work', prompt: 'w', depends_on: ['gate'] },
      ],
    }));
    const r = runner();
    r.run('appr', { runId: 'r1', verifyOnComplete: false });
    r.respondApproval('appr', 'r1', 'gate', false);
    expect(r.getRunState('appr', 'r1')?.nodes.find((n) => n.id === 'gate')?.state).toBe('failed');

    saveTaskSpec(root, specOf({
      id: 'crash',
      title: 'C',
      goal: 'g',
      nodes: [{ id: 'work', prompt: 'w' }],
    }));
    const running = runner();
    running.run('crash', { runId: 'r2', verifyOnComplete: false });
    await tick();
    const host2 = new MockHost();
    const scanned = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' }).scanUnfinished();
    expect(scanned.some((s) => s.runId === 'r2' && s.status === 'interrupted')).toBe(true);
    expect(host2.created).toHaveLength(0);
    expect(readRunLog(root, 'crash', 'r2').some((e) => e.kind === 'run-interrupted')).toBe(true);
  });
});
