import { afterEach, describe, expect, it } from 'bun:test';
import { definitionDiff, validateOrchestrationPatch, type OrchestrationPatch, type PatchContext } from './orchestration-patch.ts';
import type { TaskSpec } from './schema.ts';

const ORIGINAL = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
  else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = ORIGINAL;
});

function spec(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'orch',
    title: 'Orch',
    goal: 'g',
    runner: 'orchestrate',
    nodes: [
      { id: 'a', kind: 'session', prompt: 'a' },
      { id: 'b', kind: 'session', prompt: 'b', depends_on: ['a'] },
    ],
    ...over,
  };
}

function ctx(over: Partial<PatchContext> = {}): PatchContext {
  const s = over.spec ?? spec();
  return {
    spec: s,
    revision: 0,
    runId: 'r1',
    seenDecisionIds: new Set(),
    nodeStates: { a: 'pending', b: 'pending' },
    ...over,
  };
}

function patch(over: Partial<OrchestrationPatch> = {}): OrchestrationPatch {
  return {
    runId: 'r1',
    decisionId: 'd1',
    baseRevision: 0,
    rationale: 'add pending work',
    ...over,
  };
}

describe('orchestration patch', () => {
  it('rejects when the feature flag is off', () => {
    delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
    const res = validateOrchestrationPatch(patch({ add: [{ id: 'c', kind: 'session', prompt: 'c' }] }), ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/disabled/);
  });

  it('adds pending nodes and rejects cycles, privilege, stale revision, replay', () => {
    process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
    const added = validateOrchestrationPatch(
      patch({ add: [{ id: 'c', kind: 'session', prompt: 'c', depends_on: ['b'] }] }),
      ctx(),
    );
    expect(added.ok).toBe(true);

    const cycle = validateOrchestrationPatch(
      patch({ add: [{ id: 'c', kind: 'session', prompt: 'c', depends_on: ['b'] }], update: [{ id: 'a', kind: 'session', prompt: 'a', depends_on: ['c'] }] }),
      ctx(),
    );
    expect(cycle.ok).toBe(false);

    const priv = validateOrchestrationPatch(
      patch({ add: [{ id: 'c', kind: 'session', prompt: 'c', permissionMode: 'allow-all' }] }),
      ctx({ spec: spec({ defaults: { permissionMode: 'safe' } }) }),
    );
    expect(priv.ok).toBe(false);
    if (!priv.ok) expect(priv.error).toMatch(/ceiling/);

    const stale = validateOrchestrationPatch(patch({ baseRevision: 1 }), ctx());
    expect(stale.ok).toBe(false);

    const replay = validateOrchestrationPatch(patch(), ctx({ seenDecisionIds: new Set(['d1']) }));
    expect(replay.ok).toBe(false);

    const done = validateOrchestrationPatch(
      patch({ update: [{ id: 'a', kind: 'session', prompt: 'changed' }] }),
      ctx({ nodeStates: { a: 'done', b: 'pending' } }),
    );
    expect(done.ok).toBe(false);

    const wrongRun = validateOrchestrationPatch(patch({ runId: 'other' }), ctx());
    expect(wrongRun.ok).toBe(false);
  });

  it('pauses for review after two invalid patches', () => {
    process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1';
    const first = validateOrchestrationPatch(patch({ runId: 'nope' }), ctx({ invalidPatchCount: 0 }));
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.pauseForReview).toBe(false);
    const second = validateOrchestrationPatch(patch({ runId: 'nope' }), ctx({ invalidPatchCount: 1 }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.pauseForReview).toBe(true);
  });

  it('definitionDiff is definition-level', () => {
    const from = spec();
    const to = spec({
      nodes: [
        { id: 'a', kind: 'session', prompt: 'changed' },
        { id: 'c', kind: 'session', prompt: 'c' },
      ],
    });
    expect(definitionDiff(from, to)).toEqual({ added: ['c'], removed: ['b'], changed: ['a'] });
  });
});
