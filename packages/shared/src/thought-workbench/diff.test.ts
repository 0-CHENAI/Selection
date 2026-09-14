import { expect, it } from 'bun:test';
import { diffWorkbenchDefinitions } from './diff.ts';

it('reports exact advanced-field changes using stable node identities', () => {
  const before = { id: 'task', defaults: { model: 'old' }, nodes: [{ id: 'a', retry: { attempts: 1 }, prompt: 'keep' }, { id: 'b', depends_on: ['a'] }] };
  const after = { ...before, defaults: { model: 'new' }, nodes: [{ ...before.nodes[0], retry: { attempts: 2 } }, { ...before.nodes[1], depends_on: [] }] };
  expect(diffWorkbenchDefinitions(before, after)).toEqual([
    { path: '/defaults/model', before: 'old', after: 'new', nodeId: undefined },
    { path: '/nodes/a/retry/attempts', before: 1, after: 2, nodeId: 'a' },
    { path: '/nodes/b/depends_on', before: ['a'], after: [], nodeId: 'b' },
  ]);
});
it('does not confuse reordered nodes with rewritten configurations', () => {
  const a = { id: 'a', prompt: 'first' }, b = { id: 'b', prompt: 'second' };
  expect(diffWorkbenchDefinitions({ nodes: [a, b] }, { nodes: [b, a] })).toEqual([{ path: '/nodes/order', before: ['a', 'b'], after: ['b', 'a'] }]);
});
it('includes node additions and removals without dropping unknown fields', () => {
  const removed = { id: 'old', futureField: { keep: true } };
  const added = { id: 'new', inputs: { x: 1 } };
  expect(diffWorkbenchDefinitions({ nodes: [removed] }, { nodes: [added] })).toEqual([
    { path: '/nodes/old', before: removed, after: undefined, nodeId: 'old' },
    { path: '/nodes/new', before: undefined, after: added, nodeId: 'new' },
  ]);
});
