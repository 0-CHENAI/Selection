import { expect, it } from 'bun:test';
import { mergeThoughtDocuments } from './merge.ts';
import { compileThoughtContext } from './context.ts';
import { newThoughtDocument, newThoughtNode } from './types.ts';

it('preserves local input edits and remote answer history without activating stale output', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a'), question: 'before' }] };
  const version = { id: 'answer', question: 'before', answer: 'generated', contextHash: (await compileThoughtContext(base, 'a')).hash, model: '', createdAt: 'now', status: 'completed' as const };
  const remote = { ...base, revision: 2, nodes: [{ ...base.nodes[0]!, versions: [version], answer: version.answer, activeVersionId: version.id }] };
  const local = { ...base, title: 'local title', nodes: [{ ...base.nodes[0]!, question: 'after' }] };
  const result = await mergeThoughtDocuments(base, local, remote);
  expect(result.title).toBe('local title');
  expect(result.revision).toBe(2);
  expect(result.nodes[0]!.question).toBe('after');
  expect(result.nodes[0]!.answer).toBe('');
  expect(result.nodes[0]!.versions).toEqual([version]);
  const layoutOnly = await mergeThoughtDocuments(base, { ...base, nodes: [{ ...base.nodes[0]!, position: { x: 100, y: 20 } }] }, remote);
  expect(layoutOnly.nodes[0]!.activeVersionId).toBe(version.id);
});

it('rejects competing same-field edits and deletion racing with a delivered answer', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a')] };
  await expect(mergeThoughtDocuments(base, { ...base, title: 'local' }, { ...base, title: 'remote', revision: 2 })).rejects.toThrow('conflict: /title');
  await expect(mergeThoughtDocuments(base, { ...base, nodes: [] }, { ...base, revision: 2, nodes: [{ ...base.nodes[0]!, answer: 'remote' }] })).rejects.toThrow('conflict: /nodes/a');
});

it('merges independent node additions and retains intentional deletions', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a')] };
  const result = await mergeThoughtDocuments(base, { ...base, nodes: [newThoughtNode('b')] }, { ...base, revision: 2, nodes: [...base.nodes, newThoughtNode('c')] });
  expect(result.nodes.map(node => node.id)).toEqual(['b', 'c']);
});

it('rechecks descendants after rejecting a newly delivered upstream answer', async () => {
  // Deliberately reverse storage order: reconciliation must follow dependencies.
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('child'), { ...newThoughtNode('parent'), question: 'old question' }],
    edges: [{ id: 'edge', source: 'parent', target: 'child', kind: 'context' as const, depth: 'full' as const, order: 0 }] };
  const parentVersion = { id: 'parent-answer', question: 'old question', answer: 'parent generated', contextHash: (await compileThoughtContext(base, 'parent')).hash, model: '', createdAt: 'now', status: 'completed' as const };
  const remote = { ...base, revision: 3, nodes: base.nodes.map(node => node.id === 'parent' ? { ...node, answer: parentVersion.answer, activeVersionId: parentVersion.id, versions: [parentVersion] } : node) };
  const childVersion = { ...parentVersion, id: 'child-answer', question: '', answer: 'child generated', contextHash: (await compileThoughtContext(remote, 'child')).hash };
  remote.nodes = remote.nodes.map(node => node.id === 'child' ? { ...node, answer: childVersion.answer, activeVersionId: childVersion.id, versions: [childVersion] } : node);
  const local = { ...base, nodes: base.nodes.map(node => node.id === 'parent' ? { ...node, question: 'new question' } : node) };
  const merged = await mergeThoughtDocuments(base, local, remote);
  expect(merged.nodes.map(node => node.answer)).toEqual(['', '']);
  expect(merged.nodes.map(node => node.versions.length)).toEqual([1, 1]);
  expect(merged.nodes.find(node => node.id === 'parent')!.question).toBe('new question');
});

it('rejects independently valid edits whose combined edges form a cycle', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a'), newThoughtNode('b')] };
  const edge = { id: 'local', source: 'a', target: 'b', kind: 'context' as const, depth: 'full' as const, order: 0 };
  await expect(mergeThoughtDocuments(base, { ...base, edges: [edge] }, { ...base, revision: 2, edges: [{ ...edge, id: 'remote', source: 'b', target: 'a' }] })).rejects.toThrow();
});

it('does not mutate any input snapshots while reconciling a remote update', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a')] };
  const local = { ...base, title: 'local title' };
  const remote = { ...base, revision: 2, nodes: [{ ...base.nodes[0]!, position: { x: 50, y: 80 } }] };
  const snapshots = JSON.stringify([base, local, remote]);
  await mergeThoughtDocuments(base, local, remote);
  expect(JSON.stringify([base, local, remote])).toBe(snapshots);
});

it('retains task linkage while preserving edits made during its acknowledgement', async () => {
  const base = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a')] };
  const merged = await mergeThoughtDocuments(base,
    { ...base, nodes: [{ ...base.nodes[0]!, question: 'typed while linking' }] },
    { ...base, revision: 2, taskSlug: 'saved-task', taskEtag: 'etag', executionYaml: 'saved definition' });
  expect(merged).toMatchObject({ taskSlug: 'saved-task', taskEtag: 'etag', executionYaml: 'saved definition', revision: 2 });
  expect(merged.nodes[0]!.question).toBe('typed while linking');
});
