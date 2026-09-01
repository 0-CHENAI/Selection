import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTaskSpec, computeVerifyReserve } from './schema.ts';
import { parseTaskDocument, saveTaskDocument, previewV3Migration } from './document.ts';
import { validateOrchestrationDecision } from './orchestration-decision.ts';
import { validateTaskNodeVerdict } from './node-verdict.ts';
import { criticalPathRemaining, sortReadyByCriticalPath } from './critical-path.ts';
import {
  fingerprintWorkspaceCache,
  readWorkspaceCache,
  writeWorkspaceCache,
  workspaceCacheBypassReason,
} from './workspace-cache.ts';
import { taskDir, taskYamlPath } from './storage.ts';
import { writeFileSync, mkdirSync } from 'fs';

const V3 = {
  schema_version: 3 as const,
  id: 'demo',
  title: 'Demo',
  goal: 'g',
  acceptance_criteria: 'Must cite both branches',
  runner: 'orchestrate' as const,
  execution: {
    coordinator_gate: { mode: 'required' as const, timeout_seconds: 120 as const },
    verification: { required: true, reserve_ratio: 0.2 as const },
  },
  nodes: [
    { id: 'a', prompt: 'A', cache: 'run-pure' as const },
    { id: 'b', prompt: 'B', depends_on: ['a'] },
  ],
};

describe('v3 schema and migration', () => {
  it('parses schema_version 3 with execution and v3 cache', () => {
    const parsed = parseTaskSpec(V3);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.schema_version).toBe(3);
    expect(parsed.data.execution?.coordinator_gate?.mode).toBe('required');
    expect(parsed.data.nodes[0]?.cache).toBe('run-pure');
  });

  it('keeps cache:pure parseable on v3 so a confirmed save can convert it, and rejects v3 cache on v2', () => {
    expect(parseTaskSpec({ ...V3, nodes: [{ id: 'a', prompt: 'A', cache: 'pure' }] }).success).toBe(true);
    expect(parseTaskSpec({
      schema_version: 2,
      id: 'demo',
      title: 'Demo',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'A', cache: 'workspace-pure' }],
    }).success).toBe(false);
  });

  it('does not accept execution on v2', () => {
    expect(parseTaskSpec({
      schema_version: 2,
      id: 'demo',
      title: 'Demo',
      goal: 'g',
      execution: { coordinator_gate: { mode: 'required' } },
      nodes: [{ id: 'a', prompt: 'A' }],
    }).success).toBe(false);
  });

  it('clamps verification reserve between 4k and 32k', () => {
    expect(computeVerifyReserve(10_000)).toBe(4_096);
    expect(computeVerifyReserve(100_000)).toBe(20_000);
    expect(computeVerifyReserve(1_000_000)).toBe(32_768);
    expect(computeVerifyReserve(undefined)).toBe(0);
  });

  it('requires confirmation before converting cache: pure', () => {
    const root = mkdtempSync(join(tmpdir(), 'v3-doc-'));
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), `schema_version: 2
id: demo
title: Demo
goal: g
nodes:
  - id: a
    prompt: hello
    cache: pure
`);
    const existing = parseTaskDocument(readYaml(root));
    const v3Yaml = `schema_version: 3
id: demo
title: Demo
goal: g
acceptance_criteria: done
nodes:
  - id: a
    prompt: hello
    cache: pure
`;
    expect(() => saveTaskDocument(root, v3Yaml, existing.etag)).toThrow(/confirmation/);
    const saved = saveTaskDocument(root, v3Yaml, existing.etag, { confirmV3Migration: true });
    expect(saved.sourceVersion).toBe(3);
    expect(saved.spec?.nodes[0]?.cache).toBe('run-pure');
    rmSync(root, { recursive: true, force: true });
  });

  it('requires confirmation for the first v3 save over a v2 task', () => {
    const root = mkdtempSync(join(tmpdir(), 'v3-doc-'));
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), `schema_version: 2
id: demo
title: Demo
goal: g
nodes:
  - id: a
    prompt: hello
`);
    const existing = parseTaskDocument(readYaml(root));
    const v3Yaml = `schema_version: 3
id: demo
title: Demo
goal: g
acceptance_criteria: done
nodes:
  - id: a
    prompt: hello
`;
    expect(() => saveTaskDocument(root, v3Yaml, existing.etag)).toThrow(/confirmation/);
    const saved = saveTaskDocument(root, v3Yaml, existing.etag, { confirmV3Migration: true });
    expect(saved.sourceVersion).toBe(3);
    rmSync(root, { recursive: true, force: true });
  });

  it('preview lists cache:pure nodes', () => {
    const parsed = parseTaskSpec({
      schema_version: 2,
      id: 'demo',
      title: 'Demo',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'A', cache: 'pure' }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(previewV3Migration(parsed.data).cachePureNodeIds).toEqual(['a']);
  });
});

function readYaml(root: string): string {
  return require('fs').readFileSync(taskYamlPath(root, 'demo'), 'utf-8');
}

describe('orchestration decision', () => {
  const gate = { checkpointId: 'cp-1', reason: 'first-schedule' as const, revision: 0, deadline: '2026-01-01T00:02:00.000Z' };

  it('accepts continue and rejects stale or replayed decisions', () => {
    const ok = validateOrchestrationDecision(
      { runId: 'r1', checkpointId: 'cp-1', decisionId: 'd1', baseRevision: 0, action: 'continue' },
      { runId: 'r1', revision: 0, gate, seenDecisionIds: new Set(), completedCheckpointIds: new Set() },
    );
    expect(ok.ok).toBe(true);
    expect(validateOrchestrationDecision(
      { runId: 'r1', checkpointId: 'cp-1', decisionId: 'd1', baseRevision: 1, action: 'continue' },
      { runId: 'r1', revision: 0, gate, seenDecisionIds: new Set(), completedCheckpointIds: new Set() },
    ).ok).toBe(false);
    expect(validateOrchestrationDecision(
      { runId: 'r1', checkpointId: 'cp-1', decisionId: 'd1', baseRevision: 0, action: 'continue' },
      { runId: 'r1', revision: 0, gate, seenDecisionIds: new Set(['d1']), completedCheckpointIds: new Set() },
    ).ok).toBe(false);
  });
});

describe('node verdict', () => {
  it('requires reason, evidence, and nodes on fail', () => {
    expect(validateTaskNodeVerdict({ result: 'pass' }).ok).toBe(true);
    expect(validateTaskNodeVerdict({ result: 'fail', reason: 'bad' }).ok).toBe(false);
    expect(validateTaskNodeVerdict({ result: 'fail', reason: 'bad', evidence: 'x', nodes: ['a'] }).ok).toBe(true);
  });
});

describe('critical path', () => {
  it('ranks unfinished downstream work first and keeps definition order on ties', () => {
    const spec = parseTaskSpec({
      id: 'p',
      title: 'P',
      goal: 'g',
      nodes: [
        { id: 'a', prompt: 'a' },
        { id: 'b', prompt: 'b' },
        { id: 'c', prompt: 'c', depends_on: ['a'] },
      ],
    });
    expect(spec.success).toBe(true);
    if (!spec.success) return;
    const states = new Map([['a', { state: 'pending' }], ['b', { state: 'pending' }], ['c', { state: 'pending' }]]);
    const ranks = criticalPathRemaining(spec.data, states);
    expect(ranks.get('a')).toBe(2);
    expect(ranks.get('b')).toBe(1);
    const ordered = sortReadyByCriticalPath(spec.data.nodes, spec.data, ranks).map((n) => n.id);
    expect(ordered[0]).toBe('a');
  });
});

describe('workspace cache', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ws-cache-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('hits identical fingerprints and misses changed inputs', () => {
    const fingerprint = fingerprintWorkspaceCache({
      prompt: 'p',
      inputs: {},
      dependencyOutputs: { a: { text: 'A' } },
      artifactHashes: ['h1'],
      model: 'm',
      connection: 'conn',
      skillContents: { s: 'skill' },
    });
    writeWorkspaceCache(root, {
      fingerprint,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceRunId: 'run-a',
      sourceNodeId: 'n',
      connection: 'conn',
      output: { text: 'cached' },
    });
    const hit = readWorkspaceCache(root, 'conn', fingerprint, Date.parse('2026-01-02T00:00:00.000Z'));
    expect(hit.status).toBe('hit');
    expect(hit.record?.output.text).toBe('cached');
    const other = fingerprintWorkspaceCache({
      prompt: 'p2',
      inputs: {},
      dependencyOutputs: { a: { text: 'A' } },
      artifactHashes: ['h1'],
      model: 'm',
      connection: 'conn',
      skillContents: { s: 'skill' },
    });
    expect(readWorkspaceCache(root, 'conn', other, Date.parse('2026-01-02T00:00:00.000Z')).status).toBe('miss');
  });

  it('expires after 7 days and bypasses forbidden kinds', () => {
    const fingerprint = fingerprintWorkspaceCache({
      prompt: 'p',
      inputs: {},
      dependencyOutputs: {},
      artifactHashes: [],
      connection: 'conn',
      skillContents: {},
    });
    writeWorkspaceCache(root, {
      fingerprint,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceRunId: 'run-a',
      sourceNodeId: 'n',
      connection: 'conn',
      output: { text: 'old' },
    });
    expect(readWorkspaceCache(root, 'conn', fingerprint, Date.parse('2026-01-09T00:00:00.000Z')).status).toBe('miss');
    expect(workspaceCacheBypassReason({
      node: { id: 'v', kind: 'verify', prompt: 'v', cache: 'workspace-pure' },
      spec: parseTaskSpec(V3).data as never,
      usedTools: false,
    })).toBe('uncacheable-kind');
  });
});
