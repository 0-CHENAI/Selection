import { expect, it } from 'bun:test';
import { compileThoughtContext, thoughtReplayOrder } from './context';
import { layoutThoughtGraph, thoughtUpstreamPath } from './editing';
import { newThoughtDocument, newThoughtNode, type ThoughtDocument } from './types';

for (const size of [100, 500, 1000]) {
  it(`deduplicates large inherited materials at ${size} nodes without copying a key per reference`, async () => {
    const text = 'Material "quoted" text\n'.repeat(50000);
    const document: ThoughtDocument = {
      ...newThoughtDocument('material-scale'),
      nodes: Array.from({ length: size }, (_, index) => ({ ...newThoughtNode(`n${index}`), question: `Question ${index}`,
        materials: [{ id: `material-${index}`, name: 'Shared text', mimeType: 'text/plain', digest: 'shared-digest', text }] })),
      edges: Array.from({ length: size - 1 }, (_, index) => ({ id: `e${index}`, source: `n${index}`, target: `n${index + 1}`, order: index, depth: 'full', kind: 'context' })),
    };
    const before = process.memoryUsage();
    const start = performance.now();
    const compiled = await compileThoughtContext(document, `n${size - 1}`);
    const after = process.memoryUsage();
    expect(compiled.materials).toHaveLength(1);
    expect(compiled.materials[0]?.text).toBe(text);
    expect(compiled.messages.filter(message => message.materialId)).toHaveLength(1);
    console.info(JSON.stringify({ benchmark: 'thought-shared-material', size, materialCharacters: text.length,
      compileMs: +(performance.now() - start).toFixed(2), heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss }));
  });
  for (const shape of ['chain', 'merge'] as const) {
    it(`preserves exact context and replay order at ${size} nodes (${shape})`, async () => {
      const document: ThoughtDocument = {
        ...newThoughtDocument('scale'),
        nodes: Array.from({ length: size }, (_, index) => ({ ...newThoughtNode(`n${index}`), question: `Question ${index}`, answer: `Answer ${index}` })),
        edges: Array.from({ length: size - 1 }, (_, index) => ({ id: `e${index}`, source: `n${index}`, target: `n${shape === 'chain' ? index + 1 : size - 1}`, order: index, depth: 'full', kind: 'context' })),
      };
      const target = `n${size - 1}`;
      const begin = performance.now();
      const original = await compileThoughtContext(document, target);
      const compiled = performance.now();
      const laidOut = layoutThoughtGraph(document);
      const layout = performance.now();
      const after = await compileThoughtContext(laidOut, target);
      expect(after.hash).toBe(original.hash);
      expect(after.messages).toEqual(original.messages);
      expect(new Set(laidOut.nodes.map(node => `${node.position.x}:${node.position.y}`)).size).toBe(size);
      expect(thoughtUpstreamPath(document, [target]).size).toBe(size);
      const replay = thoughtReplayOrder(document, document.nodes.map(node => node.id).reverse());
      const ranks = new Map(replay.map((id, index) => [id, index]));
      expect(document.edges.every(edge => ranks.get(edge.source)! < ranks.get(edge.target)!)).toBe(true);
      expect(new Set(replay).size).toBe(size);
      console.info(JSON.stringify({ benchmark: 'thought-core', size, shape, compileMs: +(compiled - begin).toFixed(2), layoutMs: +(layout - compiled).toFixed(2), contextBytes: new TextEncoder().encode(JSON.stringify(original.messages)).byteLength }));
    });
  }
}
