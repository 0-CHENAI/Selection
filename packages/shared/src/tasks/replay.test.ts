import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskSpecSchema } from './schema';
import { appendRunLog, writeRunState, type RunLogEntry } from './storage';
import { writeSpecRevision, specRevisionPath } from './revisions';
import { inspectTaskRun } from './replay';
import { projectTaskView, revisionImpact, explainPreflight } from './explain';
const bytes = (directory: string): Record<string, string> => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? Object.entries(bytes(join(directory, item.name))).map(([path, text]) => [`${item.name}/${path}`, text]) : [[item.name, readFileSync(join(directory, item.name)).toString('base64')]]));

test('G6 views/preflight/impact share canonical plan; read-only replay retains exact cursor/revision after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-replay-'));
  try {
    const spec = TaskSpecSchema.parse({ schema_version: 3, id: 'inspect', title: 'Inspect', goal: '核对', runner: 'orchestrate', defaults: { permissionMode: 'safe' }, nodes: [
      { id: 'read', prompt: '读取', actor: { id: 'author' }, outputs: [{ name: 'cost', type: 'string' }] },
      { id: 'review', kind: 'verify', prompt: '${nodes.read.output.cost}', actor: { id: 'reviewer' } },
      { id: 'report', prompt: '汇总', depends_on: ['review'], actor: { id: 'author' } },
      { id: 'unrelated', prompt: '独立' },
    ] });
    const revised = { ...spec, nodes: spec.nodes.map(node => node.id === 'unrelated' ? { ...node, prompt: '独立修订' } : node) };
    writeSpecRevision(root, 'inspect', 'run', 0, spec); writeSpecRevision(root, 'inspect', 'run', 1, revised);
    const log: RunLogEntry[] = [
      { t: '2026-10-07T01:00:00Z', kind: 'run-started', taskId: 'inspect', runId: 'run' },
      { t: '2026-10-07T01:00:01Z', kind: 'node-scheduled', nodeId: 'read' },
      { t: '2026-10-07T01:00:02Z', kind: 'node-spawned', nodeId: 'read', sessionId: 'author' },
      { t: '2026-10-07T01:00:03Z', kind: 'node-finished', nodeId: 'read', sessionId: 'author', state: 'done' },
      { t: '2026-10-07T01:00:04Z', kind: 'orchestration-patch', revision: 1, baseRevision: 0, decisionId: 'revise', rationale: 'pending revision', updated: ['unrelated'] },
      { t: '2026-10-07T01:00:05Z', kind: 'run-completed', revision: 1 },
    ];
    log.forEach((event, i) => appendRunLog(root, 'inspect', 'run', { revision: 0, ...event, seq: i + 1 }));
    writeRunState(root, 'inspect', 'run', { seq: 6, revision: 1, tokensUsed: 0, invalidPatchCount: 0, seenDecisionIds: ['revise'], decisionEventSeqs: [5] });
    expect(projectTaskView(spec, 'task').edges).toContainEqual({ source: 'read', target: 'review', label: undefined });
    expect(projectTaskView(spec, 'data').edges).toContainEqual({ source: 'read', target: 'review', label: 'cost' });
    expect(projectTaskView(spec, 'actor').edges).toContainEqual({ source: 'read', target: 'report', label: 'author' });
    expect(explainPreflight(spec).frontier.map(node => node.id)).toEqual(['read', 'unrelated']);
    expect(revisionImpact(spec, { ...spec, nodes: spec.nodes.map(node => node.id === 'read' ? { ...node, prompt: 'changed' } : node) })).toMatchObject({ affected: ['read', 'review', 'report'], unaffected: ['unrelated'] });
    expect(revisionImpact(spec, { ...spec, nodes: spec.nodes.filter(node => node.id !== 'read') })).toMatchObject({ affected: ['read', 'review', 'report'] });
    const before = bytes(root), frame = inspectTaskRun(root, 'inspect', 'run', 3);
    expect(frame).toMatchObject({ readOnly: true, cursor: 3, snapshot: { revision: 0 } });
    expect(frame.snapshot.nodes).toContainEqual(expect.objectContaining({ id: 'read', state: 'running', sessionId: 'author' }));
    expect(frame.spec!.nodes.find(node => node.id === 'unrelated')!.prompt).toBe('独立');
    const latest = inspectTaskRun(root, 'inspect', 'run');
    expect(latest.snapshot.status).toBe('completed');
    expect(latest.changes[0]!.impact).toMatchObject({ affected: ['unrelated'], unaffected: ['read', 'review', 'report'] });
    expect(inspectTaskRun(root, 'inspect', 'run', 3)).toEqual(frame);
    expect(bytes(root)).toEqual(before);
    expect(() => inspectTaskRun(root, 'inspect', 'run', NaN)).toThrow('cursor');
    // A newer, uncommitted revision never replaces the selected historical frame.
    writeSpecRevision(root, 'inspect', 'run', 2, { ...spec, title: 'uncommitted' });
    expect(inspectTaskRun(root, 'inspect', 'run').spec?.title).not.toBe('uncommitted');
    unlinkSync(specRevisionPath(root, 'inspect', 'run', 1));
    expect(inspectTaskRun(root, 'inspect', 'run')).toMatchObject({ spec: null, limitations: [expect.stringContaining('Exact revision')] });
    const empty = join(root, 'no-run');
    expect(inspectTaskRun(root, 'inspect', 'absent').total).toBe(0); expect(existsSync(empty)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
