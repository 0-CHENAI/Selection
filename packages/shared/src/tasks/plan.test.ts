import { expect, it } from 'bun:test';
import { effectiveNodeDeps, planDependencies, planProtectionErrors } from './plan.ts';
import { parseTaskSpec } from './schema.ts';
import { parseTaskDocument } from './document.ts';
import { validateTaskSpec, materializeDeps } from './validate.ts';
import { definitionToPatch, validateOrchestrationPatch } from './orchestration-patch.ts';
import { specToGraph, specTopologyKey } from '../../../../apps/electron/src/renderer/components/app-shell/kanban/conductor-graph.ts';

const spec = () => parseTaskSpec({ schema_version: 3, id: 'f3', title: 'F3', goal: 'compare', runner: 'orchestrate', constraints: ['read only'], decisions: ['keep unknown risk'], locked_fields: ['constraints', 'decisions'], nodes: [
  { id: 'a', prompt: 'A', outputs: [{ name: 'cost', kind: 'param', type: 'number' }] },
  { id: 'b', prompt: 'B', locked: true, model: 'gpt-6-sol' },
  { id: 'c', prompt: 'C', depends_on: ['a'], inputs: { second: '${nodes.b.output}' } },
] });
function plan() { const parsed = spec(); if (!parsed.success) throw new Error(JSON.stringify(parsed.error)); return parsed.data; }

it('F4-c uses the same actor sequence for validation, graph and scheduling and detects a conflicting authored edge', () => {
  const p = plan(); p.nodes[0]!.actor = { id: 'analyst' }; p.nodes[1]!.actor = { id: 'other' }; p.nodes[2]!.actor = { id: 'analyst' };
  p.nodes[2]!.depends_on = []; p.nodes[2]!.inputs = {};
  expect(materializeDeps(p).get('c')).toEqual(new Set(['a']));
  expect(specToGraph(p).edges).toEqual([{ source: 'a', target: 'c' }]);
  expect(parseTaskDocument(JSON.stringify(p)).spec).toEqual(p);
  p.nodes[0]!.depends_on = ['c'];
  expect(validateTaskSpec(p).errors.some(issue => /[Cc]ycle/.test(issue.message))).toBe(true);
});

it('F3 renders exactly the dependency graph validated and scheduled, without rewriting authored edges', () => {
  const p = plan(), before = JSON.stringify(p);
  expect(effectiveNodeDeps(p.nodes[2]!)).toEqual(['a', 'b']);
  expect(materializeDeps(p)).toEqual(planDependencies(p));
  expect(specToGraph(p).edges).toEqual([{ source: 'a', target: 'c' }, { source: 'b', target: 'c' }]);
  expect(validateTaskSpec(p).valid).toBe(true);
  expect(JSON.stringify(p)).toBe(before);
  const next = structuredClone(p); next.nodes[2]!.inputs = {};
  expect(specTopologyKey(next)).not.toBe(specTopologyKey(p));
});

it('preserves manual models/kinds/config and rejects locked removals, unlocks, constraints and decisions', () => {
  const p = plan(), next = structuredClone(p); next.nodes[2]!.prompt = '中文报告';
  expect(planProtectionErrors(p, next)).toEqual([]);
  const form = structuredClone(p); delete (form.nodes[1] as { kind?: string }).kind;
  expect(planProtectionErrors(form, next)).toEqual([]);
  const model = structuredClone(p); model.nodes[1]!.model = 'replacement';
  expect(planProtectionErrors(p, model).join()).toContain('Locked node "b"');
  model.nodes[1]!.locked = false;
  expect(planProtectionErrors(p, model).join()).toContain('Locked node');
  for (const field of ['constraints', 'decisions'] as const) {
    const changed = structuredClone(p); changed[field] = ['changed'];
    expect(planProtectionErrors(p, changed).join()).toContain(`Locked field "${field}"`);
  }
  const removed = structuredClone(p); removed.nodes.splice(1, 1);
  expect(planProtectionErrors(p, removed).join()).toContain('removed');
  const unlocked = structuredClone(p); unlocked.locked_fields = [];
  expect(planProtectionErrors(p, unlocked).join()).toContain('locks cannot');
  expect(parseTaskDocument(JSON.stringify(p)).spec).toEqual(p);
});

it('canonical runtime conversion preserves untouched values, removes optional fields, and rejects scope changes atomically', () => {
  const previous = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE; process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
  try {
    const p = plan(); p.nodes[2]!.model = 'old';
    const next = structuredClone(p); delete next.nodes[2]!.model; next.nodes[2]!.prompt = 'changed C';
    const identity = { runId: 'r', decisionId: 'd', baseRevision: 0, rationale: 'manual review' };
    const patch = definitionToPatch(p, next, identity);
    const context = { spec: p, revision: 0, runId: 'r', seenDecisionIds: new Set<string>(), nodeStates: { a: 'done' as const, b: 'running' as const, c: 'pending' as const } };
    const accepted = validateOrchestrationPatch(patch, context);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) { expect(accepted.spec.nodes[1]).toEqual(p.nodes[1]); expect(accepted.spec.nodes[2]!.model).toBeUndefined(); }
    for (const bad of [structuredClone(next), structuredClone(next)]) {
      bad.nodes[2]!.inputs = { second: '${nodes.missing.output}' };
      expect(validateOrchestrationPatch(definitionToPatch(p, bad, identity), context).ok).toBe(false);
    }
    const cycle = structuredClone(next); cycle.nodes[0]!.depends_on = ['c'];
    expect(validateOrchestrationPatch(definitionToPatch(p, cycle, identity), { ...context, nodeStates: {} }).ok).toBe(false);
    const lock = structuredClone(next); lock.nodes[1]!.prompt = 'overwrite';
    expect(validateOrchestrationPatch(definitionToPatch(p, lock, identity), { ...context, nodeStates: {} }).ok).toBe(false);
    expect(validateOrchestrationPatch({ ...patch, constraints: ['write files'] }, context).ok).toBe(false);
    expect(validateOrchestrationPatch(patch, { ...context, revision: 1 }).ok).toBe(false);
    expect(validateOrchestrationPatch(patch, { ...context, nodeStates: { c: 'running' } }).ok).toBe(false);
    const scope = structuredClone(next); scope.goal = 'new goal';
    expect(() => definitionToPatch(p, scope, identity)).toThrow('later run');
    expect(p.nodes[2]!.model).toBe('old');
  } finally { if (previous === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE; else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = previous; }
});
