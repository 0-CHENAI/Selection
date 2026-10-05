import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTaskSpec, saveTaskSpec, readRunState, readRunLog, appendRunLog, writeRunState, loadTaskResults, runDir, type OrchestrationDecision } from '@craft-agent/shared/tasks';
import { TaskRunner, type ConductorSessionHost } from './TaskRunner';
import type { SessionCompletionEvent } from '../sessions/SessionManager';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
let root: string, runner: TaskRunner, host: ReturnType<typeof makeHost>;
const previousFlag = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
function makeHost() {
  const listeners = new Set<(event: SessionCompletionEvent) => void>();
  const created: string[] = [], sent: { id: string; message: string }[] = [];
  return { created, sent, async createSession(_ws: string, options: { name?: string }) { const id = `session-${options.name}`; created.push(id); return { id }; },
    async sendMessage(id: string, message: string) { sent.push({ id, message }); },
    async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
    getSessionFinalText() { return undefined; }, getSessionWorkingDirectory() { return undefined; },
    onSessionComplete(listener: (event: SessionCompletionEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    complete(id: string, text: string, generation = 0) { for (const listener of [...listeners]) listener({ workspaceId: 'ws', sessionId: `session-${id}`, generation, reason: 'complete', finalText: text }); },
  } satisfies ConductorSessionHost & { created: string[]; sent: { id: string; message: string }[]; complete(id: string, text: string, generation?: number): void };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dynamic-plan-')); process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1'; host = makeHost();
  const parsed = parseTaskSpec({ schema_version: 3, id: 'dynamic', title: 'F4', goal: 'compare', runner: 'orchestrate', acceptance_criteria: 'use both results', nodes: [
    { id: 'a', prompt: 'A' }, { id: 'b', prompt: 'B' }, { id: 'c', prompt: 'C ${nodes.b.output}', depends_on: ['a'] },
  ] });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); saveTaskSpec(root, parsed.data);
  runner = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE; else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = previousFlag; });
function decide(extra: Partial<OrchestrationDecision> = {}) {
  const state = readRunState(root, 'dynamic', 'r')!;
  return runner.applyOrchestrationDecisionByRunId('orch', { runId: 'r', checkpointId: state.coordinatorGate!.checkpointId, baseRevision: state.revision, decisionId: `decision-${state.seq}`, action: 'continue', ...extra });
}
async function start() { runner.run('dynamic', { runId: 'r', orchestratorSessionId: 'orch', orchestrateAllowed: true }); decide(); await tick(); }

it('F4-a consumes A and adds D atomically while B is live, without duplicate work', async () => {
  await start(); expect(host.created).toEqual(['session-a', 'session-b']);
  host.complete('a', 'A cost 1000000'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.nodes.find(node => node.id === 'b')!.state).toBe('running');
  const event = runner.getRunState('dynamic', 'r')!.planner!.pendingResults[0]!;
  expect(event.output!.text).toBe('A cost 1000000');
  const state = readRunState(root, 'dynamic', 'r')!;
  const patch: OrchestrationDecision = { runId: 'r', checkpointId: state.coordinatorGate!.checkpointId, decisionId: 'new-evidence-A', baseRevision: 0, action: 'patch', rationale: 'A needs tax research', consumedResults: [event.id],
    add: [{ id: 'd', kind: 'session', prompt: 'D ${nodes.a.output}' }], update: [{ id: 'c', depends_on: ['a', 'd'], prompt: 'C ${nodes.b.output} ${nodes.d.output}' }] };
  expect(runner.applyOrchestrationDecisionByRunId('orch', patch).revision).toBe(1); await tick();
  expect(runner.getRunState('dynamic', 'r')!.planChanges![0]).toMatchObject({ revision: 1, added: ['d'], updated: ['c'], reason: 'A needs tax research' });
  expect(host.created).toEqual(['session-a', 'session-b', 'session-d']);
  expect(() => runner.applyOrchestrationDecisionByRunId('orch', patch)).toThrow();
  expect(readRunLog(root, 'dynamic', 'r').filter(event => event.kind === 'orchestration-patch')).toHaveLength(1);
  host.complete('b', 'B basis unknown'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.planner!.pendingResults[0]!.revision).toBe(0);
  decide(); await tick(); expect(host.created).not.toContain('session-c');
  host.complete('d', 'D tax unknown'); await tick(); decide(); await tick(); expect(host.created.filter(id => id === 'session-d')).toHaveLength(1);
  expect(host.sent.find(item => item.id === 'session-c')!.message).toContain('B basis unknown D tax unknown');
  host.complete('c', 'report'); await tick(); expect(runner.getRunState('dynamic', 'r')!.planner!.phase).toBe('active');
  decide(); expect(runner.getRunState('dynamic', 'r')!.planner!.phase).toBe('exhausted'); expect(runner.getRunState('dynamic', 'r')!.status).toBe('verifying');
  runner.submitVerdict('orch', { runId: 'r', result: 'pass' }); expect(runner.getRunState('dynamic', 'r')!.status).toBe('completed');
});

it('concurrent results expose the next canonical checkpoint after accepting the previous one',async()=>{
  await start();host.complete('a','A');await tick();
  const first=readRunState(root,'dynamic','r')!.coordinatorGate!;
  host.complete('b','B');await tick();
  const next=decide({consumedResults:first.resultEventIds});
  expect(next.status).toBe('waiting-coordinator');
  expect(next.coordinatorGate!.checkpointId).not.toBe(first.checkpointId);
  expect(next.coordinatorGate!.resultEventIds).toEqual(['r:b:1:0:done']);
  expect(loadTaskResults(root,'dynamic','r').coordinatorGate).toEqual(next.coordinatorGate);
  expect(host.sent.at(-1)!.message).toContain('end this assistant turn immediately');
  expect(()=>runner.applyOrchestrationDecisionByRunId('orch',{runId:'r',checkpointId:first.checkpointId,decisionId:'stale-followup',baseRevision:0,action:'continue'})).toThrow('checkpointId does not match');
  for(let i=0;i<3;i++) {
    try {runner.applyOrchestrationDecisionByRunId('orch',{runId:'r',checkpointId:first.checkpointId,decisionId:`concurrent-stale-${i}`,baseRevision:0,action:'patch',rationale:'same logical task',add:[]});throw new Error('Expected conflict');}
    catch(error) {expect((error as {currentRun?:unknown}).currentRun).toMatchObject({coordinatorGate:next.coordinatorGate});}
  }
  expect(runner.getRunState('dynamic','r')!.status).toBe('waiting-coordinator');
  expect(loadTaskResults(root,'dynamic','r').coordinatorGate).toEqual(next.coordinatorGate);
});

it('a stale or failed durable plan decision never swallows the result; recovery keeps the exact pending event', async () => {
  await start(); host.complete('a', 'frozen A'); await tick();
  const before = runner.getRunState('dynamic', 'r')!.planner!.pendingResults;
  expect(() => decide({ baseRevision: 99, consumedResults: [before[0]!.id] })).toThrow('stale');
  expect(runner.getRunState('dynamic', 'r')!.planner!.pendingResults).toEqual(before);
  const path = join(runDir(root, 'dynamic', 'r'), 'run-state.json'), old = readFileSync(path, 'utf8');
  const checkpoint = readRunState(root, 'dynamic', 'r')!;
  const log = JSON.stringify(readRunLog(root, 'dynamic', 'r'));
  unlinkSync(path); mkdirSync(path);
  expect(() => runner.applyOrchestrationDecisionByRunId('orch', { runId: 'r', checkpointId: checkpoint.coordinatorGate!.checkpointId, decisionId: 'failed-commit', baseRevision: checkpoint.revision, action: 'continue' })).toThrow();
  rmSync(path, { recursive: true }); writeFileSync(path, old);
  expect(JSON.stringify(readRunLog(root, 'dynamic', 'r'))).toBe(log);
  const restored = new TaskRunner({ host: makeHost(), workspaceId: 'ws', workspaceRoot: root });
  expect(restored.getLatestRun('dynamic')!.planner!.pendingResults).toEqual(before);
  expect(restored.getLatestRun('dynamic')!.nodes.find(node => node.id === 'a')!.state).toBe('done');
});

it('human pause keeps results unconsumed and neither a coordinator decision nor manual patch restarts workers', async () => {
  await start(); host.complete('a', 'A'); await tick();
  const gate = readRunState(root, 'dynamic', 'r')!.coordinatorGate!;
  runner.pause('dynamic', 'r');
  expect(() => runner.applyOrchestrationDecisionByRunId('orch', { runId: 'r', checkpointId: gate.checkpointId, decisionId: 'bypass-pause', baseRevision: 0, action: 'continue' })).toThrow('resume a human pause');
  runner.applyManualPlanPatch('dynamic', 'r', { runId: 'r', decisionId: 'manual-paused', baseRevision: 0, rationale: 'reviewed C', update: [{ id: 'c', prompt: 'new C' }] });
  expect(runner.getRunState('dynamic', 'r')!.status).toBe('pausing');
  expect(runner.getRunState('dynamic', 'r')!.planner!.pendingResults).toHaveLength(1);
  expect(host.created).toEqual(['session-a', 'session-b']);
  host.complete('b', 'B'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.status).toBe('paused');
  runner.resume('dynamic', 'r'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.status).toBe('waiting-coordinator');
  expect(readRunState(root, 'dynamic', 'r')!.coordinatorGate!.checkpointId).not.toBe(gate.checkpointId);
});

it('F4-d ignores a decision appended before its checkpoint, including a later retry with the same decision id', async () => {
  await start(); host.complete('a', 'durable A'); await tick();
  const checkpoint = readRunState(root, 'dynamic', 'r')!, result = runner.getRunState('dynamic', 'r')!.planner!.pendingResults[0]!;
  appendRunLog(root, 'dynamic', 'r', { t: new Date().toISOString(), seq: checkpoint.seq + 1, revision: 0, kind: 'coordinator-decision', checkpointId: checkpoint.coordinatorGate!.checkpointId,
    decisionId: 'retry-crashed', baseRevision: 0, action: 'pause', consumedResults: [result.id], plannerPhase: 'draining' });
  const restored = new TaskRunner({ host: makeHost(), workspaceId: 'ws', workspaceRoot: root });
  restored.scanUnfinished();
  expect(restored.getRunState('dynamic', 'r')!.planner!.pendingResults).toEqual([result]);
  expect(restored.getRunState('dynamic', 'r')!.status).toBe('waiting-coordinator');
  restored.applyOrchestrationDecisionByRunId('orch', { runId: 'r', checkpointId: checkpoint.coordinatorGate!.checkpointId, decisionId: 'retry-crashed', baseRevision: 0, action: 'continue' });
  const again = new TaskRunner({ host: makeHost(), workspaceId: 'ws', workspaceRoot: root });
  expect(again.getLatestRun('dynamic')!.planner!.pendingResults).toEqual([]);
  expect(again.getLatestRun('dynamic')!.status).toBe('waiting-coordinator');
  expect(loadTaskResults(root, 'dynamic', 'r').runStatus).toBe('waiting-coordinator');
});

it('F4-d restores the committed graph when interrupted before a newly added worker starts', async () => {
  await start(); host.complete('a', 'A'); await tick();
  const state = readRunState(root, 'dynamic', 'r')!, result = runner.getRunState('dynamic', 'r')!.planner!.pendingResults[0]!;
  decide({ action: 'patch', rationale: 'D needed', add: [{ id: 'd', kind: 'session', prompt: 'D ${nodes.a.output}' }], consumedResults: [result.id] });
  const log = readRunLog(root, 'dynamic', 'r'), commit = log.find(event => event.kind === 'orchestration-patch')!;
  writeFileSync(join(runDir(root, 'dynamic', 'r'), 'run-log.jsonl'), log.filter(event => event.seq! <= commit.seq!).map(event => JSON.stringify(event)).join('\n') + '\n');
  writeRunState(root, 'dynamic', 'r', { ...readRunState(root, 'dynamic', 'r')!, seq: commit.seq! });
  const recoveryHost = makeHost(), restored = new TaskRunner({ host: recoveryHost, workspaceId: 'ws', workspaceRoot: root });
  restored.scanUnfinished();
  expect(restored.getRunState('dynamic', 'r')!.status).toBe('interrupted');
  expect(restored.getRunState('dynamic', 'r')!.revision).toBe(1);
  expect(restored.getRunState('dynamic', 'r')!.planner!.pendingResults).toEqual([]);
  restored.continue('dynamic', 'r'); await tick();
  expect(recoveryHost.created.filter(id => id === 'session-d')).toHaveLength(1);
  expect(recoveryHost.created).not.toContain('session-a');
  expect(() => restored.applyOrchestrationDecisionByRunId('orch', { runId: 'r', checkpointId: state.coordinatorGate!.checkpointId, decisionId: 'late', baseRevision: 0, action: 'continue' })).toThrow();
});

it.each([{ changePersona: false, contextCurrent: true, permission: 'safe' as const }, { changePersona: true, contextCurrent: true, permission: 'safe' as const }, { changePersona: false, contextCurrent: false, permission: 'safe' as const }, { changePersona: false, contextCurrent: true, permission: 'ask' as const }, { changePersona: false, contextCurrent: true, permission: 'allow-all' as const }])('F4-c reuses only a compatible actor with current context (%j)', async ({ changePersona, contextCurrent, permission }) => {
  const freshContext = changePersona || !contextCurrent;
  const parsed = parseTaskSpec({ schema_version: 3, id: 'actor', title: 'F4-c', goal: 'actor continuity', runner: 'conduct',
    execution: { verification: { required: false } }, defaults: { model: 'm', llmConnection: 'connection', permissionMode: permission },
    nodes: [{ id: 'a1', prompt: 'Remember cost 1000000', actor: { id: 'analyst', persona: 'careful' } },
      { id: 'a2', prompt: 'Report from your prior task', actor: { id: 'analyst', persona: changePersona ? 'skeptical' : 'careful' } },
      { id: 'b', prompt: 'Independent B', actor: { id: 'other' } }] });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); saveTaskSpec(root, parsed.data);
  const bindings: import('@craft-agent/shared/tasks').TaskSessionBinding[] = [], generations = new Map<string, number>();
  const actorHost = { ...makeHost(), prepareTaskWorkspace: async () => ({ directory: root }), finalizeTaskWorkspace: async () => ({}), canReuseTaskSession: () => contextCurrent, getSessionModel: () => 'm', getSessionLlmConnection: () => 'connection',
    async bindTaskSession(id: string, binding: import('@craft-agent/shared/tasks').TaskSessionBinding) {
      bindings.push(structuredClone(binding)); const generation = (generations.get(id) ?? 0) + 1; generations.set(id, generation); return { generation };
    } };
  const actorRunner = new TaskRunner({ host: actorHost, workspaceId: 'ws', workspaceRoot: root });
  actorRunner.run('actor', { runId: 'r', orchestratorSessionId: 'orch', verifyOnComplete: false }); await tick();
  expect(actorHost.created).toEqual(['session-a1', 'session-b']);
  actorHost.complete('a1', 'cost 1000000', 1); await tick();
  expect(bindings.map(binding => binding.taskNodeId)).toEqual(['a1', 'b', 'a2']);
  expect(actorRunner.getRunState('actor', 'r')!.nodes.find(node => node.id === 'a2')!.state).toBe('running');
  const secondId = freshContext ? 'a2' : 'a1';
  expect(actorHost.created).toEqual(freshContext ? ['session-a1','session-b','session-a2'] : ['session-a1','session-b']);
  if (freshContext) expect(actorHost.sent.find(message => message.id === 'session-a2')!.message).toContain('cost 1000000');
  else {
    actorHost.complete('a1', 'late old A1', 1); await tick();
    expect(actorRunner.getRunState('actor', 'r')!.nodes.find(node => node.id === 'a2')!.state).toBe('running');
  }
  actorHost.complete(secondId, 'A2 checked cost 1000000', freshContext ? 1 : 2); actorHost.complete('b', 'B', 1); await tick();
  const results = loadTaskResults(root, 'actor', 'r');
  expect(results.runStatus).toBe('completed');
  expect(results.nodes.find(node => node.id === 'a1')!.output).toBe('cost 1000000');
  expect(results.nodes.find(node => node.id === 'a2')!.output).toBe('A2 checked cost 1000000');
  expect(results.nodes.find(node => node.id === 'a1')!.attempt).toBe(1); expect(results.nodes.find(node => node.id === 'a2')!.attempt).toBe(1);
});

it('managed workers bind durable node/attempt facts before dispatch and prevent early node completion', async () => {
  await start();
  const binding = runner.reserveTaskWorker('orch', { runId: 'r', nodeId: 'a' }, 'worker-a', 'reviewer');
  expect(binding).toMatchObject({ taskSlug: 'dynamic', taskRunId: 'r', taskNodeId: 'a', taskAttempt: 1, taskRevision: 0, permissionMode: 'safe' });
  expect(() => runner.reserveTaskWorker('other-root', { runId: 'r', nodeId: 'a' }, 'foreign', 'worker')).toThrow();
  expect(() => runner.reserveTaskWorker('orch', { runId: 'r', nodeId: 'c' }, 'pending', 'worker')).toThrow();
  runner.bindTaskWorker(binding, 'worker-a', 'worker-session');
  host.complete('a', 'primary A'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.nodes.find(node => node.id === 'a')!.state).toBe('running');
  expect(runner.getRunState('dynamic', 'r')!.planner!.pendingResults).toHaveLength(0);
  runner.completeTaskWorker('dynamic', 'r', 'worker-a', 'foreign-session', 'done', { text: 'wrong' });
  expect(runner.getRunState('dynamic', 'r')!.workers![0]!.state).toBe('running');
  runner.completeTaskWorker('dynamic', 'r', 'worker-a', 'worker-session', 'done', { text: 'independent evidence' }); await tick();
  expect(runner.getRunState('dynamic', 'r')!.nodes.find(node => node.id === 'a')!.state).toBe('done');
  expect(runner.getRunState('dynamic', 'r')!.workers![0]).toMatchObject({ workerId: 'worker-a', rootSessionId: 'orch', nodeId: 'a', attempt: 1, revision: 0, state: 'done', output: { text: 'independent evidence' } });
  const facts = readRunLog(root, 'dynamic', 'r').filter(event => event.kind === 'task-worker');
  expect(facts.map(event => event.worker.state)).toEqual(['reserved','running','done']);
  expect(new TaskRunner({ host: makeHost(), workspaceId: 'ws', workspaceRoot: root }).getLatestRun('dynamic')!.workers).toEqual(runner.getRunState('dynamic', 'r')!.workers);
});

it('failed delegated work cannot be hidden by a successful primary response', async () => {
  await start(); const binding = runner.reserveTaskWorker('orch', { runId: 'r', nodeId: 'a' }, 'bad-worker', 'worker');
  runner.bindTaskWorker(binding, 'bad-worker', 'failed-session');
  host.complete('a', 'success claim'); await tick();
  runner.completeTaskWorker('dynamic', 'r', 'bad-worker', 'failed-session', 'failed', undefined, 'source missing'); await tick();
  expect(runner.getRunState('dynamic', 'r')!.nodes.find(node => node.id === 'a')!.state).toBe('failed');
  expect(runner.getRunState('dynamic', 'r')!.workers![0]!.reason).toBe('source missing');
});

it('F4-b preserves the old report, links a successor and reuses only the independent pure branch', async () => {
  const parsed = parseTaskSpec({ schema_version: 3, id: 'successor', title: 'F4-b', goal: 'Compare budgets', runner: 'conduct', execution: { verification: { required: false } },
    params: [{ name: 'budget', type: 'number', default: 1000000 }], nodes: [
      { id: 'a', prompt: 'A ${inputs.budget}', inputs: { budget: '${params.budget}' }, actor: { id: 'a' } },
      { id: 'b', prompt: 'Independent fixed basis', cache: 'workspace-pure' },
      { id: 'c', prompt: 'C ${nodes.a.output} ${nodes.b.output}', depends_on: ['a','b'] },
    ] }); if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); saveTaskSpec(root, parsed.data);
  const pureHost = { ...makeHost(), sessionUsedTools: () => false };
  const execution = new TaskRunner({ host: pureHost, workspaceId: 'ws', workspaceRoot: root });
  execution.run('successor', { runId: 's1', orchestratorSessionId: 'orch', verifyOnComplete: false }); await tick();
  pureHost.complete('a','1000000'); pureHost.complete('b','basis unknown'); await tick(); pureHost.complete('c','Report budget 1000000; basis unknown'); await tick();
  const original = loadTaskResults(root,'successor','s1').nodes;
  const next = execution.run('successor', { runId: 's2', orchestratorSessionId: 'orch', verifyOnComplete: false, params: { budget: 1100000 } }); await tick();
  expect(next.resumedFrom).toBe('s1'); expect(execution.getRunState('successor','s1')!.supersededBy).toBe('s2');
  expect(pureHost.created.filter(id => id === 'session-b')).toHaveLength(1);
  expect(execution.getRunState('successor','s2')!.nodes.find(node => node.id === 'b')).toMatchObject({ state: 'done', cacheStatus: 'hit', cacheSourceRunId: 's1' });
  expect(pureHost.sent.filter(message => message.id === 'session-a').at(-1)!.message).toContain('1100000');
  pureHost.complete('a','1100000'); await tick(); pureHost.complete('c','Report budget 1100000; basis unknown'); await tick();
  expect(loadTaskResults(root,'successor','s1').nodes).toEqual(original);
  expect(loadTaskResults(root,'successor','s1').supersededBy).toBe('s2');
  expect(loadTaskResults(root,'successor','s2').resumedFrom).toBe('s1');
  expect(loadTaskResults(root,'successor','s2').nodes.find(node => node.id === 'c')!.output).toContain('1100000');
});

it('F4-e prevents overlapping effects until shutdown is confirmed and blocks unknown outcomes', async () => {
  let releaseStop!: () => void, stopped = false, unknown = false, effects = 0;
  const barrier = new Promise<void>(resolve => { releaseStop = resolve });
  const effectHost = { ...makeHost(), async settleTaskSessionStop() { await barrier; stopped = true; }, assertTaskSafePoint() { if (!stopped) throw new Error('not confirmed stopped'); if (unknown) throw new Error('unknown side effects'); },
    async sendMessage(id: string, message: string) { if (id !== 'orch') effects++; effectHost.sent.push({ id, message }); } };
  const execution = new TaskRunner({ host: effectHost, workspaceId: 'ws', workspaceRoot: root });
  execution.run('dynamic', { runId: 'e1', orchestratorSessionId: 'orch', orchestrateAllowed: true });
  const checkpoint = readRunState(root,'dynamic','e1')!;
  execution.applyOrchestrationDecisionByRunId('orch', { runId: 'e1', checkpointId: checkpoint.coordinatorGate!.checkpointId, baseRevision: 0, decisionId: 'start-effects', action: 'continue' }); await tick();
  expect(effects).toBe(2);
  const stopping = execution.stop('dynamic','e1'); await tick();
  expect(() => execution.run('dynamic', { runId: 'e2', orchestratorSessionId: 'orch', orchestrateAllowed: true })).toThrow(); expect(effects).toBe(2);
  releaseStop(); await stopping; unknown = true;
  effectHost.complete('a','late committed effect'); await tick();
  expect(loadTaskResults(root,'dynamic','e1').nodes.find(node => node.id === 'a')!.output).toBeUndefined();
  expect(() => execution.run('dynamic', { runId: 'e2', orchestratorSessionId: 'orch', orchestrateAllowed: true })).toThrow('unknown side effects'); expect(effects).toBe(2);
  unknown = false;
  const next = execution.run('dynamic', { runId: 'e2', orchestratorSessionId: 'orch', orchestrateAllowed: true }); expect(next.resumedFrom).toBe('e1'); expect(effects).toBe(2);
});

for (const paused of [false, true]) it(`F4-d replays a persisted primary receipt without another primary call (paused=${paused})`, async () => {
  await start();
  const binding = runner.reserveTaskWorker('orch', { runId: 'r', nodeId: 'a' }, 'crash-worker', 'reviewer'); runner.bindTaskWorker(binding, 'crash-worker', 'worker-session');
  host.complete('a','primary durable result'); await tick();
  expect(readRunLog(root,'dynamic','r').some(event => event.kind === 'node-awaiting-workers' && event.finalText === 'primary durable result')).toBe(true);
  if (paused) runner.pause('dynamic','r');
  const recoveredHost = { ...makeHost(), inspectTaskWorker: () => ({ state: 'done' as const, output: { text: 'persisted reviewer result' } }) };
  const recovered = new TaskRunner({ host: recoveredHost, workspaceId: 'ws', workspaceRoot: root }); recovered.scanUnfinished();
  if (paused) recovered.resume('dynamic','r'); else recovered.continue('dynamic','r'); await tick();
  expect(recoveredHost.created).not.toContain('session-a');
  expect(loadTaskResults(root,'dynamic','r').nodes.find(node => node.id === 'a')!.output).toBe('primary durable result');
  expect(recovered.getRunState('dynamic','r')!.planner!.pendingResults.some(event => event.nodeId === 'a')).toBe(true);
  expect(recovered.getRunState('dynamic','r')!.workers![0]!.output!.text).toBe('persisted reviewer result');
});

it('a feature toggle cannot silently drop pending planner results on recovery', async () => {
  await start(); host.complete('a','A not yet consumed'); await tick();
  process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '0';
  const recovered = new TaskRunner({ host: makeHost(), workspaceId: 'ws', workspaceRoot: root }); recovered.scanUnfinished();
  expect(recovered.getRunState('dynamic','r')!.planner!.pendingResults).toHaveLength(1);
  expect(recovered.getRunState('dynamic','r')!.status).toBe('waiting-coordinator');
});

it('an unconfirmed stop remains blocked across restart and must be retried rather than resumed', async () => {
  let shutdownFails = true;
  const stopHost = { ...makeHost(), async settleTaskSessionStop() { if (shutdownFails) throw new Error('backend did not stop'); } };
  const execution = new TaskRunner({ host: stopHost, workspaceId: 'ws', workspaceRoot: root }); execution.run('dynamic',{runId:'r',orchestratorSessionId:'orch',orchestrateAllowed:true});
  const checkpoint = readRunState(root,'dynamic','r')!;
  execution.applyOrchestrationDecisionByRunId('orch',{runId:'r',checkpointId:checkpoint.coordinatorGate!.checkpointId,baseRevision:0,decisionId:'start',action:'continue'}); await tick();
  await expect(execution.stop('dynamic','r')).rejects.toThrow('unconfirmed');
  expect(execution.getRunState('dynamic','r')!.status).toBe('paused');
  expect(() => execution.resume('dynamic','r')).toThrow('unconfirmed');
  const recovered = new TaskRunner({host:stopHost,workspaceId:'ws',workspaceRoot:root}); recovered.scanUnfinished();
  expect(recovered.getRunState('dynamic','r')!.blockers!.some(reason => reason.startsWith('shutdown-unconfirmed:'))).toBe(true);
  expect(() => recovered.resume('dynamic','r')).toThrow('unconfirmed');
  shutdownFails = false; expect((await recovered.stop('dynamic','r')).status).toBe('stopped');
});


it('a late-created delegated session retains its stopped original ownership and cannot dispatch', async () => {
  await start();
  const binding = runner.reserveTaskWorker('orch', { runId: 'r', nodeId: 'a' }, 'late-created-worker', 'worker');
  await runner.stop('dynamic','r');
  expect(() => runner.bindTaskWorker(binding,'late-created-worker','late-session')).toThrow('no longer active');
  const record = loadTaskResults(root,'dynamic','r').workers![0]!;
  expect(record).toMatchObject({ sessionId: 'late-session', rootSessionId: 'orch', nodeId: 'a', attempt: 1, state: 'stopped' });
  expect(host.sent.some(message => message.id === 'late-session')).toBe(false);
});

it('keeps same-actor verify contexts independent even when reuse is otherwise proven', async () => {
  const parsed = parseTaskSpec({ schema_version: 3, id: 'independent-actor', title: 'Independent', goal: 'Review', runner: 'conduct', execution: { verification: { required: false } },
    nodes: [{ id: 'work', prompt: 'Produce', actor: { id: 'analyst' } }, { id: 'review', kind: 'verify', prompt: 'Review', actor: { id: 'analyst' } }] });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); saveTaskSpec(root, parsed.data);
  const host = { ...makeHost(), canReuseTaskSession: () => true, bindTaskSession: async () => ({ generation: 1 }) };
  const runner = new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root });
  runner.run('independent-actor', { runId: 'independent', orchestratorSessionId: 'orch', verifyOnComplete: false }); await tick();
  host.complete('work', 'Produced', 1); await tick();
  expect(host.created).toEqual(['session-work', 'session-review']);
});

 it('every v3 worker receives canonical identities, the original goal and acceptance criteria', async () => {
  await start();
  const prompt = host.sent.find(item => item.id === 'session-a')!.message;
  expect(prompt).toContain('slug="dynamic", runId="r", nodeId="a", attempt=1, revision=0');
  expect(prompt).toContain('Original user goal: compare');
  expect(prompt).toContain('Acceptance criteria: use both results');
 });
