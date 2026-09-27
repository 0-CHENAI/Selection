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
