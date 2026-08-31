import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseTaskSpec, nodeDeps, nodeTitle, type TaskSpec } from './schema.ts';
import { extractRefs, interpolateRefs } from './refs.ts';
import { validateTaskSpec, validateTaskInput, TASK_CAPS } from './validate.ts';
import { buildGeneratorPrompt, buildRepairPrompt } from './generator-prompt.ts';
import {
  parseTaskYaml,
  serializeTaskYaml,
  saveTaskSpec,
  loadTaskSpec,
  appendRunLog,
  readRunLog,
  writeNodeOutput,
  writeNodeAttempt,
  readNodeOutput,
  writeRunState,
  readRunState,
  listTaskSlugs,
  type RunLogEntry,
} from './storage.ts';

/** A valid 3-node chain: audit → design → impl (the V1 acceptance shape). */
const CHAIN = {
  id: 'demo',
  title: 'Demo chain',
  goal: 'audit then design then implement',
  nodes: [
    { id: 'audit', prompt: 'Audit the code' },
    { id: 'design', depends_on: ['audit'], prompt: 'Design using ${nodes.audit.output}' },
    { id: 'impl', depends_on: ['design'], prompt: 'Implement ${nodes.design.output}' },
  ],
  outputs: { result: '${nodes.impl.output}' },
};

function parsed(): TaskSpec {
  const r = parseTaskSpec(CHAIN);
  if (!r.success) throw new Error('fixture should parse');
  return r.data;
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

describe('schema', () => {
  it('parses a valid chain and applies defaults', () => {
    const r = parseTaskSpec(CHAIN);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.runner).toBe('conduct');
    expect(r.data.nodes[0]!.kind).toBe('session');
    expect(nodeDeps(r.data.nodes[1]!)).toEqual(['audit']);
    expect(nodeTitle(r.data.nodes[0]!)).toBe('audit'); // title falls back to id
  });

  it('normalizes the legacy `type` alias onto `kind`', () => {
    const r = parseTaskSpec({
      id: 'x',
      title: 'X',
      goal: 'g',
      nodes: [{ id: 'dyn', type: 'orchestrator', prompt: 'expand' }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.nodes[0]!.kind).toBe('orchestrator');
    expect((r.data.nodes[0] as Record<string, unknown>).type).toBeUndefined();
  });

  it('requires a prompt on session nodes', () => {
    const r = parseTaskSpec({ id: 'x', title: 'X', goal: 'g', nodes: [{ id: 'a' }] });
    expect(r.success).toBe(false);
  });

  it('accepts an optional acceptance_criteria rubric', () => {
    const r = parseTaskSpec({ ...CHAIN, acceptance_criteria: 'The implementation must pass all tests.' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.acceptance_criteria).toBe('The implementation must pass all tests.');
  });

  it('accepts max_iterations at the cap and at zero, rejects above the cap', () => {
    expect(parseTaskSpec({ ...CHAIN, max_iterations: 10 }).success).toBe(true);
    expect(parseTaskSpec({ ...CHAIN, max_iterations: 0 }).success).toBe(true);
    expect(parseTaskSpec({ ...CHAIN, max_iterations: 11 }).success).toBe(false);
  });

  it('accepts optional task-level sources and skills, rejecting empty slugs', () => {
    const r = parseTaskSpec({ ...CHAIN, sources: ['github', 'linear'], skills: ['commit'] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sources).toEqual(['github', 'linear']);
    expect(r.data.skills).toEqual(['commit']);
    expect(parseTaskSpec({ ...CHAIN, sources: [''] }).success).toBe(false);
  });

  it('rejects duplicate node ids', () => {
    const r = parseTaskSpec({
      id: 'x',
      title: 'X',
      goal: 'g',
      nodes: [
        { id: 'a', prompt: 'p' },
        { id: 'a', prompt: 'q' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid slug id', () => {
    const r = parseTaskSpec({ id: 'Bad Id', title: 'X', goal: 'g', nodes: [{ id: 'a', prompt: 'p' }] });
    expect(r.success).toBe(false);
  });

  it('accepts v2 fields: schema_version, sensitive params, output metadata, when AST, retry.when array, ui.layout', () => {
    const r = parseTaskSpec({
      ...CHAIN,
      schema_version: 2,
      params: [{ name: 'token', type: 'string', sensitive: true }],
      nodes: [
        {
          id: 'audit',
          prompt: 'Audit',
          when: { ref: 'params.token', op: 'exists' },
          retry: { limit: 1, when: ['error', 'invalid'] },
          outputs: [{ name: 'summary', required: true, description: 'Audit summary' }],
        },
      ],
      ui: { layout: { direction: 'TB', nodes: { audit: { x: 0, y: 0 } } } },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.schema_version).toBe(2);
    expect(r.data.params?.[0]?.sensitive).toBe(true);
    expect(r.data.nodes[0]!.outputs?.[0]).toMatchObject({ name: 'summary', required: true });
    expect(r.data.nodes[0]!.when).toEqual({ ref: 'params.token', op: 'exists' });
    expect(r.data.nodes[0]!.retry?.when).toEqual(['error', 'invalid']);
    expect(r.data.ui?.layout?.direction).toBe('TB');
  });

  it('fails closed for incomplete or silently unsupported v2 node contracts', () => {
    const base = { schema_version: 2, id: 'strict', title: 'Strict', goal: 'g' } as const;
    expect(parseTaskSpec({ ...base, nodes: [{ id: 'route', kind: 'route' }] }).success).toBe(false);
    expect(parseTaskSpec({ ...base, nodes: [{ id: 'map', kind: 'map', prompt: 'map' }] }).success).toBe(false);
    expect(parseTaskSpec({ ...base, nodes: [{ id: 'judge', kind: 'judge' }] }).success).toBe(false);
    expect(parseTaskSpec({
      ...base,
      nodes: [{ id: 'replica', prompt: 'work', replicas: 2, aggregate: 'synthesize' }],
    }).success).toBe(false);
    expect(parseTaskSpec({
      ...base,
      nodes: [{ id: 'route', kind: 'route', route: { cases: [{ when: 'true', goto: 'end' }], default: 'end' }, timeout: 1 }, { id: 'end', prompt: 'end' }],
    }).success).toBe(false);
  });

  it('rejects mixed condition AST variants instead of stripping a branch', () => {
    const mixed = { ref: 'params.choice', op: 'exists', all: [{ ref: 'params.other', op: 'exists' }] };
    const base = { schema_version: 2, id: 'strict-conditions', title: 'Strict conditions', goal: 'g' } as const;
    expect(parseTaskSpec({ ...base, nodes: [{ id: 'when', prompt: 'work', when: mixed }] }).success).toBe(false);
    expect(parseTaskSpec({
      ...base,
      nodes: [
        { id: 'route', kind: 'route', route: { cases: [{ when: mixed, goto: 'end' }], default: 'end' } },
        { id: 'end', prompt: 'end' },
      ],
    }).success).toBe(false);
    expect(parseTaskSpec({ ...base, nodes: [{ id: 'loop', prompt: 'work', loop: { until: mixed, max: 2 } }] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refs
// ---------------------------------------------------------------------------

describe('refs', () => {
  it('extracts node, field, and param references', () => {
    const refs = extractRefs('use ${nodes.audit.output} and ${nodes.design.output.score} with ${params.env}');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ kind: 'node', nodeId: 'audit' });
    expect(refs[1]).toMatchObject({ kind: 'node', nodeId: 'design', field: 'score' });
    expect(refs[2]).toMatchObject({ kind: 'param', name: 'env' });
  });

  it('interpolates text, fields, and params; leaves unknown refs raw', () => {
    const out = interpolateRefs(
      'A=${nodes.a.output} B=${nodes.a.output.score} P=${params.env} M=${nodes.missing.output}',
      { nodeOutputs: { a: { text: 'hello', params: { score: 7 } } }, params: { env: 'prod' } },
    );
    expect(out).toBe('A=hello B=7 P=prod M=${nodes.missing.output}');
  });

  it('supports an onMissing fallback', () => {
    const out = interpolateRefs('X=${nodes.ghost.output}', { nodeOutputs: {} }, { onMissing: () => '<none>' });
    expect(out).toBe('X=<none>');
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('validate', () => {
  it('accepts a valid chain with no errors or warnings', () => {
    const res = validateTaskSpec(parsed());
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
  });

  it('flags dangling depends_on', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'p', depends_on: ['ghost'] }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.message.includes('unknown node "ghost"'))).toBe(true);
  });

  it('flags an unresolved node reference', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'see ${nodes.ghost.output}' }],
    });
    expect(res.errors.some((e) => e.message.includes('unknown node "ghost"'))).toBe(true);
  });

  it('warns when a referenced node is not listed in depends_on', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [
        { id: 'a', prompt: 'p' },
        { id: 'b', prompt: 'uses ${nodes.a.output}' }, // no depends_on
      ],
    });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.message.includes('does not list it in depends_on'))).toBe(true);
  });

  it('errors on an undeclared param reference but accepts a declared one', () => {
    const bad = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'env is ${params.env}' }],
    });
    expect(bad.errors.some((e) => e.message.includes('undeclared task param "env"'))).toBe(true);

    const ok = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      params: [{ name: 'env' }],
      nodes: [{ id: 'a', prompt: 'env is ${params.env}' }],
    });
    expect(ok.errors).toHaveLength(0);
  });

  it('warns when a reference reads a structured output field (not populated in v1)', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [
        { id: 'a', prompt: 'p' },
        { id: 'b', depends_on: ['a'], prompt: 'uses ${nodes.a.output.score}' },
      ],
    });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.message.includes('structured output field'))).toBe(true);
  });

  it('accepts declared v2 output fields and rejects undeclared ones', () => {
    const base = {
      schema_version: 2,
      id: 'x', title: 'X', goal: 'g',
      nodes: [
        { id: 'a', prompt: 'p', outputs: [{ name: 'score', type: 'number' }] },
        { id: 'b', depends_on: ['a'], prompt: 'uses ${nodes.a.output.score}' },
      ],
    };
    const ok = validateTaskInput(base);
    expect(ok.valid).toBe(true);
    expect(ok.warnings.some((w) => w.message.includes('structured output field'))).toBe(false);

    const bad = validateTaskInput({
      ...base,
      nodes: [
        base.nodes[0],
        { id: 'b', depends_on: ['a'], prompt: 'uses ${nodes.a.output.missing}' },
      ],
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.message.includes('undeclared output field "missing"'))).toBe(true);
  });

  it('detects a dependency cycle', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [
        { id: 'a', prompt: 'p', depends_on: ['b'] },
        { id: 'b', prompt: 'q', depends_on: ['a'] },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.message.includes('cycle'))).toBe(true);
  });

  it('rejects a self-dependency', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'p', depends_on: ['a'] }],
    });
    expect(res.errors.some((e) => e.message.includes('depends on itself'))).toBe(true);
  });

  it('errors when loop.max exceeds the cap', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'p', loop: { until: 'DONE', max: TASK_CAPS.maxLoopIterations + 1 } }],
    });
    expect(res.errors.some((e) => e.message.includes('exceeds the cap'))).toBe(true);
  });

  it('warns on an unknown model', () => {
    const res = validateTaskInput({
      id: 'x', title: 'X', goal: 'g',
      nodes: [{ id: 'a', prompt: 'p', model: 'gpt-imaginary-9' }],
    });
    expect(res.warnings.some((w) => w.message.includes('not a known built-in model'))).toBe(true);
  });

  it('errors when the node count exceeds the cap', () => {
    const nodes = Array.from({ length: TASK_CAPS.maxNodes + 1 }, (_, i) => ({ id: `n${i}`, prompt: 'p' }));
    const res = validateTaskInput({ id: 'x', title: 'X', goal: 'g', nodes });
    expect(res.errors.some((e) => e.message.includes('exceeding the cap'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

describe('storage', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tasks-test-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a spec through task.yaml', () => {
    const spec = parsed();
    saveTaskSpec(root, spec);

    expect(listTaskSlugs(root)).toEqual(['demo']);

    const loaded = loadTaskSpec(root, 'demo');
    expect(loaded?.valid).toBe(true);
    expect(loaded?.spec?.id).toBe('demo');
    expect(loaded?.spec?.nodes.map((n) => n.id)).toEqual(['audit', 'design', 'impl']);
    expect(nodeDeps(loaded!.spec!.nodes[1]!)).toEqual(['audit']);
  });

  it('serializes to parseable yaml', () => {
    const yaml = serializeTaskYaml(parsed());
    const reparsed = parseTaskYaml(yaml);
    expect(reparsed.valid).toBe(true);
    expect(reparsed.spec?.title).toBe('Demo chain');
  });

  it('reports invalid yaml without throwing', () => {
    const res = parseTaskYaml(':\n  - [unbalanced');
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.message).toContain('Invalid YAML');
  });

  it('appends and reads the run log in order', () => {
    const entries: RunLogEntry[] = [
      { t: '2026-06-07T00:00:00.000Z', kind: 'run-started', taskId: 'demo', runId: 'r1' },
      { t: '2026-06-07T00:00:01.000Z', kind: 'node-scheduled', nodeId: 'audit' },
      { t: '2026-06-07T00:00:02.000Z', kind: 'node-spawned', nodeId: 'audit', sessionId: 's-audit' },
      { t: '2026-06-07T00:00:03.000Z', kind: 'node-finished', nodeId: 'audit', sessionId: 's-audit', state: 'done' },
    ];
    for (const e of entries) appendRunLog(root, 'demo', 'r1', e);
    expect(readRunLog(root, 'demo', 'r1')).toEqual(entries);
  });

  it('writes and reads per-node output', () => {
    writeNodeOutput(root, 'demo', 'r1', 'audit', { text: 'findings', params: { count: 3 } });
    expect(readNodeOutput(root, 'demo', 'r1', 'audit')).toEqual({ text: 'findings', params: { count: 3 } });
    expect(readNodeOutput(root, 'demo', 'r1', 'missing')).toBeNull();
  });

  it('reads the latest instance attempt when the v1 file is absent', () => {
    writeNodeAttempt(root, 'demo', 'r1', 'fan#0', 1, { text: 'first' });
    writeNodeAttempt(root, 'demo', 'r1', 'fan#0', 2, { text: 'second' });
    expect(readNodeOutput(root, 'demo', 'r1', 'fan#0')).toEqual({ text: 'second' });
  });

  it('writes and reads a run-state checkpoint', () => {
    writeRunState(root, 'demo', 'r1', {
      seq: 3,
      revision: 1,
      tokensUsed: 12,
      seenDecisionIds: ['d1'],
      invalidPatchCount: 0,
    });
    expect(readRunState(root, 'demo', 'r1')).toEqual({
      seq: 3,
      revision: 1,
      tokensUsed: 12,
      seenDecisionIds: ['d1'],
      invalidPatchCount: 0,
    });
  });
});

describe('generator-prompt', () => {
  it('instructs the model that every reference must resolve to a declared node', () => {
    const prompt = buildGeneratorPrompt('Decompose the goal', 'My task');
    expect(prompt).toContain('${nodes.<id>.output} reference MUST point to an `id` that you actually declare');
    expect(prompt).toContain('MUST call submit_task_definition');
    expect(prompt).toContain('schema_version: 2 definition found only in final text is rejected');
    expect(prompt).not.toContain('unless the tool is unavailable');
    expect(prompt).toContain('Goal: Decompose the goal');
    expect(prompt).toContain('Working title: My task');
  });

  it('repair prompt lists each validation error and re-asserts structured submission', () => {
    const prompt = buildRepairPrompt([
      { path: 'nodes.design.inputs', message: 'Reference ${nodes.audit-completion-signal.output} points to unknown node "audit-completion-signal"' },
      { path: 'root', message: 'second problem' },
    ]);
    expect(prompt).toContain('- nodes.design.inputs: Reference ${nodes.audit-completion-signal.output} points to unknown node "audit-completion-signal"');
    expect(prompt).toContain('- root: second problem');
    expect(prompt).toContain('call submit_task_definition again');
    expect(prompt).toContain('Do not paste YAML or JSON');
  });
});
