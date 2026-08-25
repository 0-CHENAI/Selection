import { describe, expect, it } from 'bun:test';
import { parseTaskSpec, type TaskSpec } from './schema.ts';
import { parseTaskYaml, serializeTaskYaml } from './storage.ts';
import { cloneTaskDefinition } from './clone.ts';

function specOf(raw: unknown): TaskSpec {
  const parsed = parseTaskSpec(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe('cloneTaskDefinition', () => {
  it('assigns a new id/title and stamps schema v2', () => {
    const cloned = cloneTaskDefinition(
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'review the change',
        nodes: [{ id: 'read', prompt: 'read it' }],
      }),
      { id: 'review-copy', title: 'Review (copy)' },
    );
    expect(cloned.id).toBe('review-copy');
    expect(cloned.title).toBe('Review (copy)');
    expect(cloned.schema_version).toBe(2);
    expect(cloned.nodes).toEqual([expect.objectContaining({ id: 'read', prompt: 'read it' })]);
  });

  it('drops qa- route targets and loop.else', () => {
    const cloned = cloneTaskDefinition(
      specOf({
        id: 'routed',
        title: 'Routed',
        goal: 'g',
        nodes: [
          {
            id: 'branch',
            kind: 'route',
            route: {
              cases: [
                { when: 'A', goto: 'keep' },
                { when: 'B', goto: 'qa-gone' },
              ],
              default: 'keep',
            },
          },
          { id: 'keep', prompt: 'keep' },
          { id: 'qa-gone', prompt: 'typed' },
          { id: 'retry', kind: 'loop', prompt: 'retry', loop: { until: 'DONE', max: 2, else: 'qa-gone' } },
        ],
      }),
      { id: 'routed-2', title: 'Routed (copy)' },
    );
    expect(cloned.nodes.map((n) => n.id)).toEqual(['branch', 'keep', 'retry']);
    expect(cloned.nodes[0]?.route).toEqual({
      cases: [{ when: 'A', goto: 'keep' }],
      default: 'keep',
    });
    expect(cloned.nodes[2]?.loop).toEqual({ until: 'DONE', max: 2 });
  });

  it('drops qa- nodes, their edges, and their layout', () => {
    const cloned = cloneTaskDefinition(
      specOf({
        id: 'mixed',
        title: 'Mixed',
        goal: 'g',
        nodes: [
          { id: 'plan', prompt: 'plan' },
          { id: 'qa-sess-1', prompt: 'typed title', depends_on: ['plan'] },
          { id: 'write', prompt: 'write', depends_on: ['plan', 'qa-sess-1'] },
        ],
        ui: { layout: { nodes: { plan: { x: 1, y: 2 }, 'qa-sess-1': { x: 3, y: 4 } } } },
      }),
      { id: 'mixed-2', title: 'Mixed (copy)' },
    );
    expect(cloned.nodes.map((n) => n.id)).toEqual(['plan', 'write']);
    expect(cloned.nodes[1]?.depends_on).toEqual(['plan']);
    expect(cloned.ui?.layout?.nodes).toEqual({ plan: { x: 1, y: 2 } });
  });

  it('strips sensitive param defaults and keeps loop extras', () => {
    const cloned = cloneTaskDefinition(
      specOf({
        id: 'looped',
        title: 'Looped',
        goal: 'g',
        params: [
          { name: 'topic', default: 'ok' },
          { name: 'token', sensitive: true, default: 'secret' },
        ],
        nodes: [
          { id: 'retry', kind: 'loop', prompt: 'retry', loop: { until: 'DONE', max: 3 } },
        ],
      }),
      { id: 'looped-2', title: 'Looped (copy)' },
    );
    expect(cloned.params).toEqual([
      expect.objectContaining({ name: 'topic', default: 'ok' }),
      { name: 'token', sensitive: true },
    ]);
    expect(cloned.nodes[0]).toEqual(expect.objectContaining({
      id: 'retry',
      kind: 'loop',
      loop: { until: 'DONE', max: 3 },
    }));
  });

  it('round-trips through YAML', () => {
    const cloned = cloneTaskDefinition(
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'review the change',
        nodes: [
          { id: 'read', prompt: 'read it' },
          { id: 'qa-old', prompt: 'typed' },
        ],
      }),
      { id: 'review-copy', title: 'Review (copy)' },
    );
    const parsed = parseTaskYaml(serializeTaskYaml(cloned));
    expect(parsed.valid).toBe(true);
    expect(parsed.spec?.id).toBe('review-copy');
    expect(parsed.spec?.nodes.map((n) => n.id)).toEqual(['read']);
  });

  it('rejects a spec that is only quick-add nodes', () => {
    expect(() =>
      cloneTaskDefinition(
        specOf({
          id: 'only-qa',
          title: 'Only QA',
          goal: 'g',
          nodes: [{ id: 'qa-abc', prompt: 'typed' }],
        }),
        { id: 'only-qa-2', title: 'Only QA (copy)' },
      ),
    ).toThrow(/no reusable nodes/);
  });
});
