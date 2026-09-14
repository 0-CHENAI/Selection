import { describe, expect, it } from 'bun:test';
import { compileThoughtContext, isThoughtStale, validateThoughtGraph, thoughtReplayOrder } from './context.ts';
import { newThoughtDocument, newThoughtNode } from './types.ts';

function fixture() {
  const document = newThoughtDocument('graph');
  document.nodes = ['a', 'b', 'c'].map(id => ({ ...newThoughtNode(id), question: id, answer: `answer-${id}` }));
  document.edges = [ { id: 'ac', source: 'a', target: 'c', kind: 'context' as const, order: 0, depth: 'full' as const },
    { id: 'bc', source: 'b', target: 'c', kind: 'context' as const, order: 1, depth: 'full' as const } ];
  return document;
}

describe('compiled context is the model input', () => {
  it('deduplicates material content while retaining distinct extraction revisions, pages and blobs', async () => {
    const doc = fixture();
    const material = { id: 'first', name: 'Material', mimeType: 'text/plain', digest: 'blob-a', text: 'quoted "text"\n' };
    doc.nodes[0]!.materials = [material, { ...material, id: 'duplicate' }, { ...material, id: 'revision', text: 'changed extraction' },
      { ...material, id: 'page', page: 1 }, { ...material, id: 'blob', digest: 'blob-b' }];
    const compiled = await compileThoughtContext(doc, 'c');
    expect(compiled.materials.map(item => item.id)).toEqual(['first', 'revision', 'page', 'blob']);
    doc.nodes[0]!.materials.splice(1, 1);
    expect((await compileThoughtContext(doc, 'c')).hash).toBe(compiled.hash);
  });

  it.each(['question', 'agent'] as const)('binds project identity to the %s generation snapshot', async mode => {
    const doc = fixture();
    doc.nodes[2]!.mode = mode;
    doc.projectId = 'project-a';
    const original = await compileThoughtContext(doc, 'c');
    expect(original.projectId).toBe('project-a');
    doc.projectId = 'project-b';
    expect((await compileThoughtContext(doc, 'c')).hash).not.toBe(original.hash);
    doc.projectId = 'project-a';
    expect((await compileThoughtContext(doc, 'c')).hash).toBe(original.hash);
  });
  it('applies highlight modes to descendants and hashes the exact filtered answer', async () => {
    const doc = fixture();
    const node = doc.nodes[0]!;
    node.answer = 'keep this. omit that.';
    node.highlights = ['keep this.'];
    const full = await compileThoughtContext(doc, 'c');
    node.highlightMode = 'filter';
    const filtered = await compileThoughtContext(doc, 'c');
    expect(filtered.messages.find(message => message.nodeId === 'a' && message.role === 'assistant')?.content).toBe('keep this.');
    expect(filtered.hash).not.toBe(full.hash);
    node.highlightMode = 'tag';
    expect((await compileThoughtContext(doc, 'c')).messages.find(message => message.nodeId === 'a' && message.role === 'assistant')?.content).toContain('[Highlighted passages]');
    node.highlightMode = 'off';
    expect((await compileThoughtContext(doc, 'c')).hash).toBe(full.hash);
  });
  it('does not let a shallow reference hide a later full reference or duplicate shared ancestors', async () => {
    const doc = fixture();
    doc.nodes.push({ ...newThoughtNode('root'), question: 'root', answer: 'root answer' });
    doc.edges = [
      { id: 'ra', source: 'root', target: 'a', kind: 'context', depth: 'full', order: 0 },
      { id: 'ab', source: 'a', target: 'b', kind: 'reference', depth: 'quote', order: 0 },
      { id: 'bc', source: 'b', target: 'c', kind: 'context', depth: 'full', order: 0 },
      { id: 'ac', source: 'a', target: 'c', kind: 'reference', depth: 'full', order: 1 },
      { id: 'rc', source: 'root', target: 'c', kind: 'reference', depth: 'full', order: 2 },
    ];
    const refs = (await compileThoughtContext(doc, 'c')).messages.filter(message => message.content.startsWith('[Reference]'));
    expect(refs.map(message => message.nodeId)).toEqual(['root', 'a']);
  });
  it('orders explicit replay targets across references without automatically rerunning ancestors', () => {
    const doc = fixture();
    doc.nodes[0]!.mode = 'agent';
    doc.edges[0]!.kind = 'reference';
    expect(thoughtReplayOrder(doc, ['c', 'a', 'c'])).toEqual(['a', 'c']);
    expect(thoughtReplayOrder(doc, ['c'])).toEqual(['c']);
    doc.nodes[0]!.archived = true;
    doc.nodes[1]!.kind = 'note';
    expect(thoughtReplayOrder(doc, ['c', 'b', 'a'])).toEqual(['c']);
    expect(() => thoughtReplayOrder(doc, ['missing'])).toThrow('Unknown replay target');
  });
  it('prunes an excluded branch and never includes the target previous answer', async () => {
    const doc = fixture();
    doc.nodes[0]!.question = 'UNIQUE_NOISE';
    expect(JSON.stringify(await compileThoughtContext(doc, 'c'))).toContain('UNIQUE_NOISE');
    doc.edges = doc.edges.filter(e => e.source !== 'a');
    const compiled = await compileThoughtContext(doc, 'c');
    expect(JSON.stringify(compiled)).not.toContain('UNIQUE_NOISE');
    expect(compiled.messages.map(m => m.content)).toEqual(['b', 'answer-b', 'c']);
  });
  it('hashes merge order, roles and same-size material replacements, not layout', async () => {
    const doc = fixture();
    const original = await compileThoughtContext(doc, 'c');
    doc.nodes[0]!.position.x = 999;
    doc.revision++;
    expect((await compileThoughtContext(doc, 'c')).hash).toBe(original.hash);
    doc.edges[0]!.order = 3;
    expect((await compileThoughtContext(doc, 'c')).hash).not.toBe(original.hash);
    doc.nodes[2]!.materials.push({ id: 'image', name: 'x.png', mimeType: 'image/png', digest: 'a'.repeat(64), text: '' });
    const imageA = await compileThoughtContext(doc, 'c');
    doc.nodes[2]!.materials[0]!.digest = 'b'.repeat(64);
    expect((await compileThoughtContext(doc, 'c')).hash).not.toBe(imageA.hash);
    const beforeRole = await compileThoughtContext(doc, 'c');
    doc.nodes[2]!.role = 'New role';
    expect((await compileThoughtContext(doc, 'c')).hash).not.toBe(beforeRole.hash);
  });
  it('tracks stale versions and ignores target answer updates', async () => {
    const doc = fixture(); const node = doc.nodes[2]!;
    node.versions = [{ id: 'v', question: node.question, answer: 'new', contextHash: (await compileThoughtContext(doc, 'c')).hash, model: 'm', createdAt: '', status: 'completed' }];
    node.activeVersionId = 'v'; node.answer = 'new';
    expect(await isThoughtStale(doc, 'c')).toBe(false);
    doc.nodes[0]!.answer = 'changed';
    expect(await isThoughtStale(doc, 'c')).toBe(true);
  });
  it('rejects invalid, duplicate and cyclic edges including references', () => {
    const doc = fixture(); doc.edges.push({ id: 'ca', source: 'c', target: 'a', kind: 'reference', order: 0, depth: 'quote' });
    expect(() => validateThoughtGraph(doc)).toThrow('Cyclic');
    doc.edges.pop(); doc.edges.push({ ...doc.edges[0]!, id: 'duplicate' });
    expect(() => validateThoughtGraph(doc)).toThrow('Duplicate');
    doc.edges.pop(); doc.edges[0]!.target = 'missing';
    expect(() => validateThoughtGraph(doc)).toThrow('Unknown');
  });
  it('compiles a thousand-node history without recursive stack growth', async () => {
    const doc = newThoughtDocument('large');
    for (let i = 0; i < 1000; i++) {
      doc.nodes.push({ ...newThoughtNode(`n${i}`), question: `q${i}` });
      if (i) doc.edges.push({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}`, kind: 'context', depth: 'full', order: 0 });
    }
    expect((await compileThoughtContext(doc, 'n999')).messages).toHaveLength(1000);
  });
});
