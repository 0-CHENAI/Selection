import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTaskSpec, type TaskSpec } from './schema.ts';
import { appendRunLog, writeNodeOutput, type RunLogEntry } from './storage.ts';
import { writeSpecRevision } from './revisions.ts';
import { loadTaskResults } from './results.ts';

function spec(): TaskSpec {
  const r = parseTaskSpec({
    id: 'demo',
    title: 'Demo',
    goal: 'g',
    nodes: [{ id: 'audit', prompt: 'p', outputs: [{ name: 'report', type: 'string' }] }],
  });
  if (!r.success) throw new Error('fixture');
  return r.data;
}

describe('loadTaskResults', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'task-results-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns typed outputs, artifacts, and the latest revision', () => {
    writeSpecRevision(root, 'demo', 'r1', 0, spec());
    const log: RunLogEntry[] = [
      { t: '2026-06-07T00:00:00.000Z', kind: 'run-started', taskId: 'demo', runId: 'r1' },
      { t: '2026-06-07T00:00:01.000Z', kind: 'node-scheduled', nodeId: 'audit' },
      { t: '2026-06-07T00:00:02.000Z', kind: 'node-finished', nodeId: 'audit', sessionId: 's-audit', state: 'done' },
      { t: '2026-06-07T00:00:03.000Z', kind: 'verdict', result: 'pass' },
    ];
    for (const e of log) appendRunLog(root, 'demo', 'r1', e);
    writeNodeOutput(root, 'demo', 'r1', 'audit', {
      text: 'ok',
      params: {
        report: 'findings',
        file: { path: 'out/a.txt', hash: 'abc', mime: 'text/plain', size: 2 },
      },
    });

    const results = loadTaskResults(root, 'demo', 'r1');
    expect(results.revision).toBe(0);
    expect(results.verdict?.result).toBe('pass');
    expect(results.nodes[0]?.outputs).toEqual({
      report: 'findings',
      file: { path: 'out/a.txt', hash: 'abc', mime: 'text/plain', size: 2 },
    });
    expect(results.nodes[0]?.artifacts).toEqual([
      { path: 'out/a.txt', hash: 'abc', mime: 'text/plain', size: 2 },
    ]);
  });

  it('links output to its root, attempt and dispatch revision, ignoring uncommitted plan files', () => {
    writeSpecRevision(root, 'demo', 'r1', 0, spec());
    const t = '2026-10-04T00:00:00.000Z';
    for (const entry of [
      { t, kind: 'run-started', taskId: 'demo', runId: 'r1', orchestratorSessionId: 'root', revision: 0 },
      { t, kind: 'node-scheduled', nodeId: 'audit', revision: 0 },
      // A different pending node can be patched during async session creation.
      { t, kind: 'node-spawned', nodeId: 'audit', sessionId: 'worker', revision: 1 },
      { t, kind: 'node-finished', nodeId: 'audit', sessionId: 'worker', state: 'done', revision: 1 },
      { t, kind: 'run-completed', revision: 1 },
    ] as RunLogEntry[]) appendRunLog(root, 'demo', 'r1', entry);
    writeSpecRevision(root, 'demo', 'r1', 1, spec());
    writeNodeOutput(root, 'demo', 'r1', 'audit', { text: 'verified output' });
    const result = loadTaskResults(root, 'demo', 'r1');
    writeSpecRevision(root, 'demo', 'r1', 2, { ...spec(), title: 'Uncommitted plan' });
    expect(loadTaskResults(root, 'demo', 'r1')).toEqual(result);
    expect(result).toMatchObject({ taskId: 'demo', orchestratorSessionId: 'root', revision: 1,
      runStatus: 'completed', nodes: [{ sessionId: 'worker', revision: 0, attempt: 1, output: 'verified output' }] });
    expect(loadTaskResults(mkdtempSync(join(root, 'other-workspace-')), 'demo', 'r1').nodes).toEqual([]);
  });
  it('preserves the historical verdict while separately showing artifact version changes', () => {
    writeSpecRevision(root,'demo','r1',0,spec());
    const t = '2026-10-04T00:00:00.000Z';
    for (const entry of [ { t, kind: 'run-started', taskId: 'demo', runId: 'r1' },
      { t, kind: 'node-finished', nodeId: 'audit', sessionId: 'actor', state: 'done' },
      { t, kind: 'verdict', result: 'pass' }, { t, kind: 'run-completed' },
      { t, kind: 'artifact-availability', nodeIds: ['audit'], reason: 'Source bytes changed' } ] as RunLogEntry[]) appendRunLog(root,'demo','r1',entry);
    writeNodeOutput(root,'demo','r1','audit',{ text: 'Original report' });
    expect(loadTaskResults(root,'demo','r1')).toMatchObject({ runStatus: 'completed', verdict: { result: 'pass' },
      artifactAvailability: { nodeIds: ['audit'], reason: 'Source bytes changed' }, nodes: [{ state: 'done', output: 'Original report' }] });
  });

  it('shows durable invalidation without erasing historical output or retaining a stale verdict', () => {
    writeSpecRevision(root, 'demo', 'r1', 0, spec());
    const t = '2026-06-07T00:00:00.000Z';
    for (const entry of [
      { t, kind: 'run-started', taskId: 'demo', runId: 'r1' },
      { t, kind: 'node-finished', nodeId: 'audit', sessionId: 's-audit', state: 'done' },
      { t, kind: 'verdict', result: 'pass' },
      { t, kind: 'run-completed' },
      { t, kind: 'artifact-results-invalidated', nodeIds: ['audit'], reason: 'Input changed', completedRun: true },
    ] as RunLogEntry[]) appendRunLog(root, 'demo', 'r1', entry);
    writeNodeOutput(root, 'demo', 'r1', 'audit', { text: 'Historical result' });
    const invalid = loadTaskResults(root, 'demo', 'r1');
    expect(invalid.runStatus).toBe('failed');
    expect(invalid.nodes[0]?.state).toBe('invalid');
    expect(invalid.nodes[0]?.failureReason).toBe('Input changed');
    expect(invalid.nodes[0]?.output).toBe('Historical result');
    expect(invalid.verdict).toBeUndefined();
    expect(invalid.verdicts).toEqual([{ result: 'pass' }]);
    appendRunLog(root, 'demo', 'r1', { t, kind: 'node-finished', nodeId: 'audit', sessionId: 'new', state: 'done' });
    appendRunLog(root, 'demo', 'r1', { t, kind: 'verdict', result: 'pass' });
    const repaired = loadTaskResults(root, 'demo', 'r1');
    expect(repaired.nodes[0]?.failureReason).toBeUndefined();
    expect(repaired.verdict?.result).toBe('pass');
  });

});
