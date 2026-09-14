import { describe, expect, it } from 'bun:test';
import { restoreThoughtEdit, layoutThoughtGraph, thoughtUpstreamPath, groupThoughtNodes, thoughtGroupBounds, addThoughtSummary } from './editing.ts';
import { compileThoughtContext } from './context.ts';
import { newThoughtDocument, newThoughtNode, type ThoughtVersion } from './types.ts';

const version: ThoughtVersion = { id: 'v1', question: 'edited question', answer: 'delivered', contextHash: 'hash', model: 'model', createdAt: 'now', status: 'completed', sessionId: 'agent-session' };

it('adds a no-tool summary with ordered full references without replacing the original answers', async () => {
  const original = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a'), kind: 'result' as const, answer: 'source answer', source: { taskSlug: 'task', runId: 'run', nodeId: 'task-node' } }] };
  const document = addThoughtSummary(original, ['a'], 'summary', 'Summary', 'Summarize the selected context');
  expect(original.nodes).toHaveLength(1);
  expect(document.nodes[0]!.answer).toBe('source answer');
  expect(document.nodes[1]!.mode).toBe('question');
  expect(document.nodes[1]!.versions).toEqual([]);
  const context = await compileThoughtContext(document, 'summary');
  expect(context.messages.some(message => message.content.includes('source answer'))).toBe(true);
  expect(context.messages.some(message => message.content.includes('task-node'))).toBe(true);
});

it('treats grouping and collapse as visual state and transfers members without duplicates', async () => {
  const original = { ...newThoughtDocument('doc'), nodes: ['a', 'b'].map(id => ({ ...newThoughtNode(id), question: id })) };
  const grouped = groupThoughtNodes(original, ['a', 'b'], 'group', 'Title');
  grouped.groups![0]!.collapsed = true;
  expect((await compileThoughtContext(grouped, 'a')).hash).toBe((await compileThoughtContext(original, 'a')).hash);
  const regrouped = groupThoughtNodes(grouped, ['a'], 'second', 'Second');
  expect(regrouped.groups!.map(group => group.nodeIds)).toEqual([['b'], ['a']]);
  expect(thoughtGroupBounds(grouped, ['a', 'b'])).toEqual({ x: -24, y: -44, width: 288, height: 168 });
  expect(restoreThoughtEdit(grouped, original).groups).toBeUndefined();
});

it('lays out merge dependencies without changing compiled context, and locates all upstream branches', async () => {
  const document = { ...newThoughtDocument('doc'), nodes: ['a', 'b', 'c', 'other'].map(id => ({ ...newThoughtNode(id), question: id })),
    edges: ['a', 'b'].map((source, order) => ({ id: source, source, target: 'c', kind: 'context' as const, depth: 'full' as const, order })) };
  const arranged = layoutThoughtGraph(document);
  expect(arranged.nodes[2]!.position.x).toBeGreaterThan(arranged.nodes[0]!.position.x);
  expect(arranged.nodes[0]!.position).not.toEqual(arranged.nodes[1]!.position);
  expect((await compileThoughtContext(arranged, 'c')).hash).toBe((await compileThoughtContext(document, 'c')).hash);
  expect([...thoughtUpstreamPath(document, ['c'])].sort()).toEqual(['a', 'b', 'c']);
  expect(document.nodes.every(node => node.position.x === 0)).toBe(true);
});

describe('graph undo retains execution receipts', () => {
  it('restores authoring fields without rolling back newly delivered answers or task linkage', () => {
    const before = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('a')] };
    const current = { ...before, revision: 5, taskSlug: 'saved-task', taskEtag: 'etag', executionYaml: 'new definition', lastAppliedProposalId: 'proposal',
      nodes: [{ ...before.nodes[0]!, question: version.question, answer: version.answer, versions: [version], activeVersionId: version.id }] };
    const restored = restoreThoughtEdit(current, before);
    expect(restored.nodes[0]!.question).toBe('');
    expect(restored.nodes[0]!.answer).toBe('delivered');
    expect(restored.nodes[0]!.versions).toEqual([version]);
    expect(restored.revision).toBe(5);
    expect(restored.taskSlug).toBe('saved-task');
    expect(restored.executionYaml).toBe('new definition');
    expect(restored.lastAppliedProposalId).toBe('proposal');
    expect(before.nodes[0]!.versions).toEqual([]);
  });
  it('archives executed nodes instead of erasing their history when undoing creation', () => {
    const before = newThoughtDocument('doc');
    const current = { ...before, nodes: [{ ...newThoughtNode('executed'), versions: [version] }, newThoughtNode('unexecuted')] };
    const restored = restoreThoughtEdit(current, before);
    expect(restored.nodes.map(node => node.id)).toEqual(['executed']);
    expect(restored.nodes[0]!.archived).toBe(true);
    expect(restored.nodes[0]!.versions[0]!.sessionId).toBe('agent-session');
    expect(restored.edges).toEqual([]);
  });
  it('allows undoing a version selection, and refuses cross-document snapshots', () => {
    const before = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a'), versions: [version], answer: version.answer, activeVersionId: version.id }] };
    const current = { ...before, nodes: [{ ...before.nodes[0]!, answer: '', activeVersionId: undefined }] };
    expect(restoreThoughtEdit(current, before).nodes[0]!.activeVersionId).toBe(version.id);
    expect(() => restoreThoughtEdit(current, newThoughtDocument('other'))).toThrow('another workbench');
  });
});
