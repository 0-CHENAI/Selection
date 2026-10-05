import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTaskSpec, saveTaskSpec, loadTaskResults } from '@craft-agent/shared/tasks';
import { TaskRunner, type ConductorSessionHost } from './TaskRunner';
import type { SessionCompletionEvent } from '../sessions/SessionManager';

let root: string, runner: TaskRunner, listeners: Set<(event: SessionCompletionEvent) => void>, sent: Array<{ id: string; text: string }>;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function host(): ConductorSessionHost {
  return { async createSession(_ws, options) { return { id: `session-${options.taskNodeId}` }; },
    async sendMessage(id, text) { sent.push({ id, text }); }, async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
    getSessionFinalText() { return undefined; }, getSessionWorkingDirectory() { return root; },
    async bindTaskSession() { return { generation: 0 }; },
    onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'task-help-')); listeners = new Set(); sent = [];
  const spec = parseTaskSpec({ schema_version: 3, id: 'help', goal: 'Independent read-only work', title: 'Help', max_parallel: 1,
    execution: { coordinator_gate: { mode: 'off' }, verification: { required: false } },
    nodes: [{ id: 'a', prompt: 'Read A' }, { id: 'b', prompt: 'Read B' }] });
  if (!spec.success) throw new Error(JSON.stringify(spec.error));
  saveTaskSpec(root, spec.data); runner = new TaskRunner({ host: host(), workspaceId: 'ws', workspaceRoot: root });
  runner.run('help', { runId: 'r', orchestratorSessionId: 'root', verifyOnComplete: false }); await tick();
});
afterEach(async () => { await runner.stop('help', 'r'); rmSync(root, { recursive: true, force: true }); });
const request = { action: 'request' as const, requestId: 'missing-scope', problem: 'A scope is absent', tried: ['Read original A'], needed: 'Clarify the existing scope' };
const answer = (action: 'answer' | 'needs-user' = 'answer') => ({ action, requestId: 'a@1@0:missing-scope', runId: 'r', baseRevision: 0, responseId: action, response: 'Retain the stated two-year scope; do not expand permissions' });
async function complete(id: string) {
  for (const listener of listeners) listener({ workspaceId: 'ws', sessionId: `session-${id}`, generation: 0, reason: 'complete', finalText: `${id} confirmed` });
  await tick();
}

test('B9 only the affected node yields a slot, prioritizes its coordinator and resumes retained tools once', async () => {
  const waiting = runner.taskHelp('session-a', 0, request) as Promise<unknown>; await tick();
  const snapshot = runner.getRunState('help', 'r')!;
  expect(snapshot.status).toBe('running');
  expect(snapshot.nodes.map(node => node.state)).toEqual(['waiting-help', 'running']);
  expect(sent.some(message => message.id === 'root' && message.text.includes('only node'))).toBe(true);
  expect(runner.taskHelp('session-a', 0, request)).toBe(waiting);
  runner.taskHelp('root', 1, answer('needs-user'));
  expect(loadTaskResults(root, 'help', 'r').help![0]!.state).toBe('waiting-user');
  runner.taskHelp('root', 1, answer());
  expect(() => runner.taskHelp('root', 1, { ...answer(), response: 'Conflicting replacement' })).toThrow('different disposition');
  expect(runner.getRunState('help', 'r')!.nodes[0]!.state).toBe('waiting-help'); // B still owns the one execution slot.
  await complete('b');
  expect(await waiting).toMatchObject({ state: 'answered', permissionGranted: false });
  expect(runner.getRunState('help', 'r')!.nodes[0]!.attempt).toBe(1);
  expect(sent.filter(message => message.id === 'session-a')).toHaveLength(1); // Continue the pending tool, never replay the task prompt.
  expect(runner.taskHelp('root', 1, answer())).toMatchObject({ state: 'answered' });
  await complete('a');
  expect(runner.getRunState('help', 'r')!.status).toBe('completed');
  expect(loadTaskResults(root, 'help', 'r').help![0]!.responses).toHaveLength(2);
});

test('B9 rejects forged identity/references, conflicting retries and late replies after Stop', async () => {
  expect(() => runner.taskHelp('session-a', 1, request)).toThrow('current bound');
  expect(() => runner.taskHelp('foreign', 0, request)).toThrow('No active canonical');
  expect(() => runner.taskHelp('session-a', 0, { ...request, claimRefs: [{ id: 'forged', version: 1 }] })).toThrow('unknown or stale');
  const waiting = runner.taskHelp('session-a', 0, request) as Promise<unknown>;
  const rejected = waiting.catch(error => error.message);
  expect(() => runner.taskHelp('session-a', 0, { ...request, needed: 'Different request' })).toThrow('different content');
  expect(() => runner.taskHelp('foreign', 0, answer())).toThrow('No active canonical');
  expect(() => runner.taskHelp('root', 0, { ...answer(), baseRevision: 1 })).toThrow('Stale');
  await runner.stop('help', 'r');
  expect(await rejected).toContain('stopped');
  expect(() => runner.taskHelp('root', 0, answer())).toThrow('active run');
  expect(loadTaskResults(root, 'help', 'r').help![0]!.state).toBe('cancelled');
});

test('B9 restart retires an answered request still queued behind another execution', async () => {
  const waiting = runner.taskHelp('session-a', 0, request) as Promise<unknown>;
  const stopped = waiting.catch(error => error.message);
  await tick(); runner.taskHelp('root', 0, answer());
  expect(loadTaskResults(root, 'help', 'r').help![0]!.state).toBe('answered');
  listeners.clear();
  const recovered = new TaskRunner({ host: host(), workspaceId: 'ws', workspaceRoot: root }); recovered.scanUnfinished();
  expect(loadTaskResults(root, 'help', 'r').help![0]!).toMatchObject({ state: 'cancelled', responses: [{ action: 'answer' }] });
  expect(() => recovered.taskHelp('root', 0, answer())).toThrow('retired attempt');
  await runner.stop('help', 'r'); await stopped;
});

test('B9 repeated help excludes waiting time and restores the remaining active timeout', async () => {
  await runner.stop('help', 'r');
  const spec = parseTaskSpec({ schema_version: 3, id: 'help', title: 'Help', goal: 'Read only', max_parallel: 1,
    execution: { coordinator_gate: { mode: 'off' }, verification: { required: false } },
    nodes: [{ id: 'a', prompt: 'A', timeout: 10 }, { id: 'b', prompt: 'B' }] });
  if (!spec.success) throw new Error(JSON.stringify(spec.error));
  saveTaskSpec(root, spec.data);
  let now = Date.now();
  const timers = spyOn(globalThis, 'setTimeout');
  try {
    runner = new TaskRunner({ host: host(), workspaceId: 'ws', workspaceRoot: root, now: () => new Date(now).toISOString() });
    runner.run('help', { runId: 'timed', orchestratorSessionId: 'root', verifyOnComplete: false }); await tick();
    now += 2_000;
    const first = runner.taskHelp('session-a', 0, request) as Promise<unknown>;
    now += 100_000; await tick();
    runner.taskHelp('root', 0, { ...answer(), runId: 'timed' }); await complete('b'); await first;
    expect(timers.mock.calls.some(call => call[1] === 8_000)).toBe(true);
    now += 500;
    const second = runner.taskHelp('session-a', 0, { ...request, requestId: 'followup' }) as Promise<unknown>;
    now += 100_000;
    runner.taskHelp('root', 0, { ...answer(), runId: 'timed', requestId: 'a@1@0:followup' }); await second;
    expect(timers.mock.calls.some(call => call[1] === 7_500)).toBe(true);
    await complete('a');
    expect(runner.getRunState('help', 'timed')!.status).toBe('completed');
  } finally { await runner.stop('help', 'timed'); timers.mockRestore(); }
});

test('B9 restart preserves the question history and fences replies to lost contexts', async () => {
  const waiting = runner.taskHelp('session-a', 0, request) as Promise<unknown>;
  const stopped = waiting.catch(error => error.message);
  // End this test's live runtime before simulating a fresh process.
  listeners.clear();
  const recovered = new TaskRunner({ host: host(), workspaceId: 'ws', workspaceRoot: root }); recovered.scanUnfinished();
  expect(recovered.getRunState('help', 'r')!.status).toBe('interrupted');
  expect(loadTaskResults(root, 'help', 'r').help![0]!).toMatchObject({ state: 'cancelled', attempt: 1, revision: 0, generation: 0 });
  expect(() => recovered.taskHelp('root', 0, answer())).toThrow('retired attempt');
  await runner.stop('help', 'r'); await stopped;
});
