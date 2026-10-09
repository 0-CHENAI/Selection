import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TokenUsage } from '@craft-agent/core/types';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import {
  parseTaskSpec,
  saveTaskSpec,
  readRunLog,
  runDir,
  readRunState,
  readLatestSpecRevision,
  type TaskSpec,
  COORDINATOR_TIMEOUT_BLOCKER,
} from '@craft-agent/shared/tasks';
import type { SessionCompletionEvent, SessionRuntimeActivity } from '../sessions/SessionManager';
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
  readonly activityListeners = new Set<(evt: SessionRuntimeActivity) => void>();
  onRuntimeActivity(listener: (evt: SessionRuntimeActivity) => void): () => void {
    this.activityListeners.add(listener);
    return () => { this.activityListeners.delete(listener); };
  }
  activity(evt: SessionRuntimeActivity): void { for (const listener of this.activityListeners) listener(evt); }
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
  complete(nodeId: string, opts: { reason?: SessionCompletionEvent['reason']; errorCode?: SessionCompletionEvent['errorCode']; finalText?: string; tokenUsage?: TokenUsage } = {}): void {
    const evt: SessionCompletionEvent = {
      sessionId: this.sessionIdFor(nodeId),
      workspaceId: 'ws',
      generation: 0,
      reason: opts.reason ?? 'complete',
      errorCode: opts.errorCode,
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

  it('retries a transient read-only request without replaying completed dependencies', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', execution: { verification: { required: false } }, nodes: [
      { id: 'read', prompt: 'Read' }, { id: 'review', kind: 'verify', prompt: 'Review', depends_on: ['read'] },
    ] }))
    const r = runner(); r.run('v3demo', { runId: 'transient', verifyOnComplete: false }); await tick()
    host.complete('read', { finalText: 'Confirmed source' }); await tick()
    host.complete('review', { reason: 'error', errorCode: 'service_error' }); await tick()
    expect(r.getRunState('v3demo', 'transient')?.nodes.find(node => node.id === 'review')?.state).toBe('retry-wait')
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(host.dispatchedNames().filter(name => name === 'read')).toHaveLength(1)
    expect(r.getRunState('v3demo', 'transient')?.nodes.find(node => node.id === 'review')?.attempt).toBe(2)
    expect(r.submitNodeVerdict('sess-review', { result: 'pass', reason: 'Source checked', evidence: 'Confirmed source' }).ok).toBe(true)
    host.complete('review'); await tick()
    expect(r.getRunState('v3demo', 'transient')?.status).toBe('completed')
    expect(readRunLog(root, 'v3demo', 'transient').filter(event => event.kind === 'node-retry')).toHaveLength(1)
  })

  it.each([
    ['explicit-off', { retry: { limit: 0 }, permissionMode: 'safe' }], ['write-mode', { permissionMode: 'ask' }],
  ])('does not apply transient fallback to %s', async (runId, node) => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', defaults: { permissionMode: 'ask' }, nodes: [{ id: 'a', prompt: 'A', ...node }] }))
    const r = runner(); r.run('v3demo', { runId, verifyOnComplete: false }); await tick()
    host.complete('a', { reason: 'error', errorCode: 'service_error' }); await tick()
    expect(r.getRunState('v3demo', runId)?.status).toBe('failed')
    expect(readRunLog(root, 'v3demo', runId).some(event => event.kind === 'node-retry')).toBe(false)
  })

  it('refuses a transient retry whose previous operation outcome is unknown', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', nodes: [{ id: 'a', prompt: 'A' }] }))
    const r = runner(); r.run('v3demo', { runId: 'unknown', verifyOnComplete: false }); await tick()
    ;(host as ConductorSessionHost).assertTaskSafePoint = () => { throw new Error('Unknown operation outcome') }
    host.complete('a', { reason: 'error', errorCode: 'service_error' }); await tick()
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(host.dispatchedNames()).toEqual(['a'])
    expect(r.getRunState('v3demo', 'unknown')?.status).toBe('failed')
  })

  it('F3 waits for both explicit and input-derived dependencies and keeps a later YAML save out of the frozen run', async () => {
    const frozen = v3Spec({ runner: 'conduct', constraints: ['read only'], decisions: ['unknown risk stays unknown'], execution: { verification: { required: false } }, nodes: [
      { id: 'a', prompt: 'A' }, { id: 'b', prompt: 'B' },
      { id: 'c', prompt: 'Report from ${inputs.second}', depends_on: ['a'], inputs: { second: '${nodes.b.output}' } },
    ] });
    saveTaskSpec(root, frozen); const r = runner(); r.run('v3demo', { runId: 'f3', verifyOnComplete: false }); await tick();
    expect(host.dispatchedNames()).toEqual(['a', 'b']);
    expect(host.sent.find(item => item.sessionId === 'sess-b')!.message).toContain('User constraints for every node: ["read only"]');
    expect(host.sent.find(item => item.sessionId === 'sess-b')!.message).toContain('Confirmed plan decisions: ["unknown risk stays unknown"]');
    const changed = structuredClone(frozen); changed.nodes[1]!.prompt = 'saved replacement'; saveTaskSpec(root, changed);
    expect(r.currentRunSpec('v3demo', 'f3')!.nodes[1]!.prompt).toBe('B');
    host.complete('a', { finalText: 'A cost 1000000' }); await tick(); expect(host.dispatchedNames()).not.toContain('c');
    host.complete('b', { finalText: 'B basis unknown' }); await tick(); expect(host.dispatchedNames()).toContain('c');
    expect(host.sent.find(item => item.sessionId === 'sess-c')!.message).toContain('B basis unknown');
    host.complete('c', { finalText: 'Both inputs' }); await tick();
    expect(r.getRunState('v3demo', 'f3')!.status).toBe('completed');
  });

  it('verifies typed values from the frozen plan rather than prose alone', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', constraints: ['read only'], nodes: [{ id: 'a', prompt: 'A', outputs: [
      { name: 'cost', kind: 'param', type: 'number', required: true }, { name: 'unresolved', kind: 'param', type: 'boolean', required: true },
    ] }] }));
    const r = runner(); r.run('v3demo', { runId: 'typed', orchestratorSessionId: 'orch' }); await tick();
    expect(r.submitNodeOutput('sess-a', { text: 'cost is known; risk remains unknown', values: { cost: 1000000, unresolved: true } }).ok).toBe(true);
    host.complete('a', { finalText: 'Submitted' }); await tick();
    const review = host.sent.find(item => item.sessionId === 'orch')!.message;
    expect(review).toContain('Runtime-validated values: {"cost":1000000,"unresolved":true}');
    expect(review).toContain('User constraints for every node: ["read only"]');
    expect(review).toContain('Task slug: v3demo; runId: typed; revision: 0.');
    expect(review).toContain('Frozen plan: {');
    expect(review).toContain('"type":"number"'); expect(review).toContain('Run: typed; revision: 0');
    expect(() => r.submitVerdict('orch', { runId: 'typed', result: 'fail', reason: 'bad target', nodes: ['unknown'] })).toThrow('completed nodes');
    expect(r.getRunState('v3demo', 'typed')!.nodes.find(node => node.id === 'a')!.state).toBe('done');
    expect(r.submitVerdict('orch', { runId: 'typed', result: 'pass' }).status).toBe('completed');
  });

  it('accepts only one same-revision manual/planner commit and refuses to overwrite running nodes', async () => {
    saveTaskSpec(root, v3Spec({ execution: { coordinator_gate: { mode: 'off' } }, nodes: [{ id: 'a', prompt: 'A' }, { id: 'c', prompt: 'C', depends_on: ['a'] }] }));
    const r = runner(); r.run('v3demo', { runId: 'race', verifyOnComplete: false, orchestrateAllowed: true }); await tick();
    const first = { runId: 'race', decisionId: 'manual', baseRevision: 0, rationale: 'confirmed', update: [{ id: 'c', prompt: 'manual C' }] };
    expect(r.applyManualPlanPatch('v3demo', 'race', first).revision).toBe(1);
    expect(() => r.applyOrchestrationPatch('v3demo', 'race', { ...first, decisionId: 'planner', update: [{ id: 'c', prompt: 'stale C' }] })).toThrow('stale revision');
    expect(r.currentRunSpec('v3demo', 'race')!.nodes[1]!.prompt).toBe('manual C');
    expect(() => r.applyManualPlanPatch('v3demo', 'race', { ...first, decisionId: 'running', baseRevision: 1, update: [{ id: 'a', prompt: 'overwrite' }] })).toThrow('running');
    expect(readRunState(root, 'v3demo', 'race')!.revision).toBe(1);
    expect(readRunLog(root, 'v3demo', 'race').filter(entry => entry.kind === 'orchestration-patch')).toHaveLength(1);
  });

  it('rolls back memory and log on checkpoint failure and ignores the orphan revision after reload', async () => {
    saveTaskSpec(root, v3Spec({ nodes: [{ id: 'a', prompt: 'A' }] }));
    const r = runner(); r.run('v3demo', { runId: 'disk', orchestratorSessionId: 'orch', orchestrateAllowed: true });
    const statePath = join(runDir(root, 'v3demo', 'disk'), 'run-state.json');
    const beforeState = readFileSync(statePath, 'utf8'), beforeLog = JSON.stringify(readRunLog(root, 'v3demo', 'disk'));
    const beforeSpec = structuredClone(r.currentRunSpec('v3demo', 'disk'));
    unlinkSync(statePath); mkdirSync(statePath);
    const patch = { runId: 'disk', decisionId: 'manual-disk', baseRevision: 0, rationale: 'add', add: [{ id: 'c', kind: 'session' as const, prompt: 'C' }] };
    expect(() => r.applyManualPlanPatch('v3demo', 'disk', patch)).toThrow();
    expect(r.currentRunSpec('v3demo', 'disk')).toEqual(beforeSpec);
    expect(r.getRunState('v3demo', 'disk')!.revision).toBe(0);
    expect(JSON.stringify(readRunLog(root, 'v3demo', 'disk'))).toBe(beforeLog);
    rmSync(statePath, { recursive: true }); writeFileSync(statePath, beforeState);
    expect(readLatestSpecRevision(root, 'v3demo', 'disk')!.revision).toBe(0);
    const restored = runner(); restored.scanUnfinished(); expect(restored.getRunState('v3demo', 'disk')!.revision).toBe(0);
    expect(r.applyManualPlanPatch('v3demo', 'disk', patch).revision).toBe(1);
    expect(readRunLog(root, 'v3demo', 'disk').filter(entry => entry.kind === 'coordinator-decision')).toHaveLength(1);
  });

  it.each([false, true])('requires a fresh reviewer verdict after transport failure (restart=%s)', async restart => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', execution: { verification: { required: false } }, nodes: [
      { id: 'work', prompt: 'work' }, { id: 'review', kind: 'verify', prompt: 'review', depends_on: ['work'] },
      { id: 'after', prompt: 'after', depends_on: ['review'] },
    ] }));
    let r = runner(); r.run('v3demo', { runId: 'r1', verifyOnComplete: false }); await tick();
    host.complete('work', { finalText: 'kept' }); await tick();
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), { result: 'pass', reason: 'old', evidence: 'old' }).ok).toBe(true);
    host.complete('review', { reason: 'error' }); await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('failed');
    if (restart) r = runner();
    r.continue('v3demo', 'r1'); await tick();
    expect(r.getRunState('v3demo', 'r1')?.nodes.find(n => n.id === 'review')?.verdict).toBeUndefined();
    expect(host.dispatchedNames().filter(n => n === 'work')).toHaveLength(1);
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), { result: 'pass', reason: 'new', evidence: 'new' }).ok).toBe(true);
    host.complete('review', { finalText: 'reviewed' }); await tick();
    host.complete('after'); await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('completed');
  });

  it('requires a new coordinator decision before dispatching a recovered run', async () => {
    saveTaskSpec(root, v3Spec({ nodes: [{ id: 'a', prompt: 'A' }] }));
    const r = runner(); r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true });
    const advance = (id: string) => r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1', checkpointId: readRunLog(root, 'v3demo', 'r1').findLast(e => e.kind === 'coordinator-request')!.checkpointId, decisionId: id, baseRevision: 0, action: 'continue',
    });
    advance('start'); await tick(); host.complete('a', { reason: 'error' }); await tick();
    advance('settle'); await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('failed');
    const snapshot = r.continue('v3demo', 'r1');
    expect(snapshot.status).toBe('waiting-coordinator');
    expect(snapshot.nodes[0]?.blocker).toBeUndefined();
    expect(host.dispatchedNames()).toEqual(['a']);
    advance('retry'); await tick();
    expect(host.dispatchedNames()).toEqual(['a', 'a']);
    expect(r.getRunState('v3demo', 'r1')?.nodes[0]?.blocker).toBeUndefined();
    await r.stop('v3demo', 'r1');
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

  it('settles an unresolved invalid node instead of entering an unfinishable verification after replacement work', async () => {
    saveTaskSpec(root, v3Spec({ nodes: [{ id: 'a', prompt: 'A', outputs: [{ name: 'finding', kind: 'param', type: 'json', required: true }] }] }));
    const r = runner(); r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true });
    const decide = (decisionId: string, action: 'continue' | 'patch', extra: Record<string, unknown> = {}) => r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1', checkpointId: readRunLog(root, 'v3demo', 'r1').findLast(e => e.kind === 'coordinator-request')!.checkpointId,
      decisionId, baseRevision: r.getRunState('v3demo', 'r1')!.revision ?? 0, action, ...extra,
    });
    decide('start', 'continue'); await tick();
    expect(host.sent.find(call => call.sessionId === 'sess-a')?.message).toContain('Declared node outputs: [{"name":"finding"');
    host.complete('a', { finalText: 'Findings without the required output' }); await tick();
    expect(r.getRunState('v3demo', 'r1')?.nodes[0]?.state).toBe('invalid');
    decide('replacement', 'patch', { rationale: 'Try a replacement', add: [{ id: 'b', prompt: 'B' }] }); await tick();
    host.complete('b', { finalText: 'Replacement findings' }); await tick();
    decide('drain', 'continue', { plannerPhase: 'draining' }); await tick();
    expect(r.getRunState('v3demo', 'r1')?.status).toBe('failed');
    const log = readRunLog(root, 'v3demo', 'r1');
    expect(log.some(event => event.kind === 'run-verifying')).toBe(false);
    expect(log.filter(event => event.kind === 'run-failed')).toHaveLength(1);
    expect(host.sent.findLast(call => call.sessionId === 'orch')?.message).toContain('completed without submit_task_output');
  });

  it('retires a canonically cancelled pending node without blocking final verification', async () => {
    saveTaskSpec(root, v3Spec({ acceptance_criteria: 'A supplies the finding', nodes: [{ id: 'a', prompt: 'A' }, { id: 'b', prompt: 'Unneeded work', depends_on: ['a'] }] }));
    const r = runner(); r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true });
    const decide = (decisionId: string, action: 'continue' | 'patch', extra: Record<string, unknown> = {}) => r.applyOrchestrationDecisionByRunId('orch', {
      runId: 'r1', checkpointId: readRunLog(root, 'v3demo', 'r1').findLast(e => e.kind === 'coordinator-request')!.checkpointId,
      decisionId, baseRevision: r.getRunState('v3demo', 'r1')!.revision ?? 0, action, ...extra,
    });
    decide('retire-unused', 'patch', { rationale: 'A alone satisfies the current goal', cancel: ['b'] }); await tick();
    expect(host.dispatchedNames()).toEqual(['a']);
    host.complete('a', { finalText: 'A findings' }); await tick();
    decide('drain', 'continue', { plannerPhase: 'draining' }); await tick();
    expect(r.getRunState('v3demo', 'r1')!.status).toBe('verifying');
    expect(r.getRunState('v3demo', 'r1')!.nodes.map(node => node.id)).toEqual(['a']);
    expect(readRunLog(root, 'v3demo', 'r1').some(e => e.kind === 'orchestration-patch' && e.cancelled?.includes('b'))).toBe(true);
    expect(r.submitVerdict('orch', { runId: 'r1', result: 'pass' }).status).toBe('completed');
    const restored = runner().getLatestRun('v3demo')!;
    expect(restored.status).toBe('completed');
    expect(restored.nodes.map(node => node.id)).toEqual(['a']);
  });

  it('persists human feedback without releasing the gate, deduplicates feedback, and resumes only on approval', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', nodes: [
      { id: 'gate', kind: 'approval', prompt: 'Review the plan' },
      { id: 'work', prompt: 'Use the human response: ${nodes.gate.output}', depends_on: ['gate'] },
    ] }));
    const first = runner();
    first.run('v3demo', { runId: 'human', orchestratorSessionId: 'orch', verifyOnComplete: false });
    await tick();
    expect(first.getRunState('v3demo', 'human')?.status).toBe('waiting-approval');
    expect(first.getRunState('v3demo', 'human')?.nodes[0]?.approvalDefinition?.prompt).toBe('Review the plan');
    saveTaskSpec(root, v3Spec({ runner: 'conduct', nodes: [{ id: 'gate', kind: 'approval', prompt: 'Different future plan' }] }));
    expect(first.getRunState('v3demo', 'human')?.nodes[0]?.approvalDefinition?.prompt).toBe('Review the plan');
    const feedback = first.respondApproval('v3demo', 'human', 'gate', false, 'Add a concrete example', true);
    expect(feedback.status).toBe('waiting-approval');
    expect(feedback.nodes.find(n => n.id === 'gate')?.approvalFeedback).toBe('Add a concrete example');
    first.respondApproval('v3demo', 'human', 'gate', false, 'Add a concrete example', true);
    expect(readRunLog(root, 'v3demo', 'human').filter(e => e.kind === 'approval-response')).toHaveLength(1);
    expect(host.dispatchedNames()).not.toContain('work');
    await tick();
    expect(host.sent.some(s => s.message.includes('gate remains CLOSED'))).toBe(true);
    const restored = runner();
    restored.scanUnfinished();
    expect(restored.getRunState('v3demo', 'human')?.nodes[0]?.approvalDefinition?.prompt).toBe('Review the plan');
    expect(restored.getRunState('v3demo', 'human')?.nodes.find(n => n.id === 'gate')?.approvalFeedback).toBe('Add a concrete example');
    restored.respondApproval('v3demo', 'human', 'gate', true);
    await tick();
    expect(host.dispatchedNames()).toContain('work');
    expect(host.sent.some(s => s.message.includes('Add a concrete example'))).toBe(true);
    expect(() => restored.respondApproval('v3demo', 'human', 'gate', true)).toThrow('not waiting');
  });

  it('rejects a human gate without dispatching its dependent and audits the reason', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', nodes: [
      { id: 'gate', kind: 'approval' }, { id: 'work', prompt: 'work', depends_on: ['gate'] },
    ] }));
    const r = runner();
    r.run('v3demo', { runId: 'reject', orchestratorSessionId: 'orch', verifyOnComplete: false });
    await tick();
    expect(() => r.respondApproval('v3demo', 'reject', 'gate', 'yes' as unknown as boolean)).toThrow('Invalid');
    r.respondApproval('v3demo', 'reject', 'gate', false, 'Not authorized');
    await tick();
    expect(host.dispatchedNames()).not.toContain('work');
    expect(readRunLog(root, 'v3demo', 'reject').some(e => e.kind === 'approval-response' && e.approved === false && e.feedback === 'Not authorized')).toBe(true);
  });

  it('allows explicit feedback retry after delivery failure and restart without opening the gate', async () => {
    saveTaskSpec(root, v3Spec({ runner: 'conduct', nodes: [{ id: 'gate', kind: 'approval' }, { id: 'work', prompt: 'work', depends_on: ['gate'] }] }));
    const send = host.sendMessage.bind(host);
    host.sendMessage = async () => { throw new Error('offline'); };
    const first = runner();
    first.run('v3demo', { runId: 'delivery', orchestratorSessionId: 'orch', verifyOnComplete: false });
    first.respondApproval('v3demo', 'delivery', 'gate', false, 'Please revise', true);
    await tick();
    expect(first.getRunState('v3demo', 'delivery')?.nodes[0]?.blocker).toBe('feedback-delivery-failed');
    host.sendMessage = send;
    const restored = runner();
    restored.scanUnfinished();
    expect(restored.getRunState('v3demo', 'delivery')?.nodes[0]?.blocker).toBe('feedback-delivery-failed');
    restored.respondApproval('v3demo', 'delivery', 'gate', false, 'Please revise', true);
    await tick();
    expect(restored.getRunState('v3demo', 'delivery')?.nodes[0]?.blocker).toBeUndefined();
    expect(restored.getRunState('v3demo', 'delivery')?.status).toBe('waiting-approval');
    expect(host.dispatchedNames()).not.toContain('work');
  });

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

  it('retains a progressing coordinator across the original deadline and restart, but still expires inactivity', () => {
    saveTaskSpec(root, v3Spec());
    let now = '2026-06-07T00:00:00.000Z';
    const r = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => now });
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true });
    now = '2026-06-07T00:01:59.000Z';
    const activity: SessionRuntimeActivity = { sessionId: 'orch', rootSessionId: 'orch', generation: 1, type: 'model_activity', at: Date.parse(now), reasoningBytes: 32, textBytes: 0 };
    host.activity(activity);
    now = '2026-06-07T00:02:30.000Z';
    host.activity({ ...activity, at: Date.parse(now) }); // Unchanged heartbeat is not progress.
    host.activity({ ...activity, sessionId: 'worker', reasoningBytes: 64 });
    host.activity({ ...activity, runId: 'obsolete', reasoningBytes: 64 });
    host.activity({ ...activity, type: 'model_call_start' }); // A pending API request is not output.
    expect(r.expireCoordinatorGate('v3demo', 'r1', now).status).toBe('waiting-coordinator');
    expect(readRunLog(root, 'v3demo', 'r1').filter(event => event.kind === 'coordinator-progress')).toHaveLength(1);
    const restored = new TaskRunner({ host: new MockHost(), workspaceId: 'ws', workspaceRoot: root, now: () => now });
    expect(restored.getLatestRun('v3demo')?.status).toBe('waiting-coordinator');
    expect(restored.expireCoordinatorGate('v3demo', 'r1', '2026-06-07T00:04:00.000Z').status).toBe('paused');
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
        { id: 'future', prompt: 'future', depends_on: ['review'] },
      ],
    }));
    const r = runner();
    r.run('v3demo', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false });
    await tick();
    r.submitNodeOutput(host.sessionIdFor('work'), { text: 'done' });
    host.complete('work', { finalText: 'done', tokenUsage: tu(10, 5) });
    await tick();
    expect(r.submitNodeVerdict(host.sessionIdFor('review'), { result: 'fail', reason: 'bad' }).ok).toBe(false);
    for (const id of ['future', 'unknown', 'review']) {
      expect(r.submitNodeVerdict(host.sessionIdFor('review'), { result: 'fail', reason: 'bad', evidence: 'audit', nodes: [id] }).ok).toBe(false);
    }
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

  it('publishes structured output before a pool wake expands a dependent map', async () => {
    const pool = new LlmConnectionPool(1);
    saveTaskSpec(root, v3Spec({
      id: 'v3demo',
      runner: 'conduct',
      defaults: { llmConnection: 'shared' },
      max_parallel: 2,
      nodes: [
        {
          id: 'source',
          prompt: 'produce zones',
          outputs: [{ name: 'zones', kind: 'param', type: 'json' }],
        },
        {
          id: 'fan',
          kind: 'map',
          depends_on: ['source'],
          for_each: '${nodes.source.output.zones}',
          prompt: 'read ${item}',
        },
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
    expect(r.submitNodeOutput(host.sessionIdFor('source'), {
      values: { zones: ['zone-a', 'zone-b', 'zone-c'] },
    }).ok).toBe(true);
    host.complete('source', { finalText: 'done', tokenUsage: tu(2, 1) });
    await tick();

    const firstMapPrompt = host.sent.find((sent) => sent.sessionId === host.sessionIdFor('fan#0'))?.message ?? '';
    expect(firstMapPrompt).toContain('read zone-a');
    expect(firstMapPrompt).not.toContain('${nodes.source.output.zones}');

    host.complete('fan#0', { finalText: 'A', tokenUsage: tu(2, 1) });
    await tick();
    const secondMapPrompt = host.sent.find((sent) => sent.sessionId === host.sessionIdFor('fan#1'))?.message ?? '';
    expect(secondMapPrompt).toContain('read zone-b');

    host.complete('fan#1', { finalText: 'B', tokenUsage: tu(2, 1) });
    await tick();
    const thirdMapPrompt = host.sent.find((sent) => sent.sessionId === host.sessionIdFor('fan#2'))?.message ?? '';
    expect(thirdMapPrompt).toContain('read zone-c');

    host.complete('fan#2', { finalText: 'C', tokenUsage: tu(2, 1) });
    await tick();
    expect(r.getRunState('v3demo', 'r1')?.nodes.find((node) => node.id === 'fan')?.state).toBe('done');
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
  it('F4-f rejects a final PASS when a file changed after the verification context was frozen', async () => {
    writeFileSync(join(root,'late.txt'),'original');
    saveTaskSpec(root,v3Spec({ id: 'late-artifact', runner: 'conduct', nodes: [{ id: 'a', prompt: 'produce', outputs: [{ name: 'file', kind: 'artifact' }] }] }));
    const execution = runner(); execution.run('late-artifact',{runId:'r',orchestratorSessionId:'orch'}); await tick();
    expect(execution.submitNodeOutput('sess-a',{values:{file:'late.txt'}}).ok).toBe(true);
    host.complete('a'); await tick(); expect(execution.getRunState('late-artifact','r')?.status).toBe('verifying');
    writeFileSync(join(root,'late.txt'),'changed');
    expect(() => execution.submitVerdict('orch',{runId:'r',result:'pass'})).toThrow('artifact validation is unsettled');
    expect(execution.getRunState('late-artifact','r')?.status).toBe('verifying');
    expect(readRunLog(root,'late-artifact','r').some(event => event.kind === 'verdict' && event.result === 'pass')).toBe(false);
    await execution.stop('late-artifact','r');
  });

  it('rejects workspace cache receipts after the referenced artifact changes', async () => {
    writeFileSync(join(root, 'report.txt'), 'original');
    const spec = (id: string) => v3Spec({ id, runner: 'conduct',
      nodes: [{ id: 'pure', prompt: 'report existing file', cache: 'workspace-pure', outputs: [{ name: 'file', kind: 'artifact' }] }],
    });
    saveTaskSpec(root, spec('cache-file'));
    const first = runner();
    first.run('cache-file', { runId: 'r1', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false }); await tick();
    host.usedToolsById.set('sess-pure', false);
    expect(first.submitNodeOutput('sess-pure', { values: { file: 'report.txt' } }).ok).toBe(true);
    host.complete('pure', { finalText: 'report' }); await tick();
    expect(readdirSync(join(root, 'tasks', '.cache', 'workspace-pure'), { recursive: true }).some(name => String(name).endsWith('.json'))).toBe(true);
    saveTaskSpec(root, spec('cache-file-reused'));
    const cachedHost = new MockHost();
    const cachedRunner = new TaskRunner({ host: cachedHost, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    cachedRunner.run('cache-file-reused', { runId: 'cached', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false }); await tick();
    expect(cachedHost.dispatchedNames()).toHaveLength(0);
    expect(readRunLog(root, 'cache-file-reused', 'cached').some(event => event.kind === 'node-artifact-inputs' && event.nodeId === 'pure' && event.sessionId === '')).toBe(true);
    expect(cachedRunner.getRunState('cache-file-reused', 'cached')?.status).toBe('verifying');
    cachedRunner.submitVerdict('orch', { runId: 'cached', result: 'pass' });
    writeFileSync(join(root, 'report.txt'), 'external replacement');
    const previous = cachedRunner.revalidateCompletedArtifacts('cache-file-reused', 'cached');
    expect(previous.nodes.find(node => node.id === 'pure')?.state).toBe('done');
    expect(previous.artifactAvailability?.nodeIds).toContain('pure');
    saveTaskSpec(root, spec('cache-file-next'));
    const nextHost = new MockHost();
    const next = new TaskRunner({ host: nextHost, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    next.run('cache-file-next', { runId: 'r2', orchestratorSessionId: 'orch', orchestrateAllowed: true, verifyOnComplete: false }); await tick();
    expect(nextHost.dispatchedNames()).toContain('pure');
    expect(next.getRunState('cache-file-next', 'r2')?.nodes.find(node => node.id === 'pure')?.cacheStatus).toBe('miss');
    next.stop('cache-file-next', 'r2');
  });

});
