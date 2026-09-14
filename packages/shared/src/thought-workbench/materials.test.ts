import { afterEach, expect, it, spyOn } from 'bun:test';
import * as storage from './storage.ts';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newThoughtDocument, newThoughtNode } from './types.ts';
import { saveThoughtDocument, workbenchBlobPath } from './storage.ts';
import { importWorkbenchMaterial, readWorkbenchMaterial, quoteWorkbenchMaterial } from './materials.ts';
import { compileThoughtContext } from './context.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thought-materials-')); roots.push(root);
  return { root, document: saveThoughtDocument(root, newThoughtDocument('draft'), 0) };
}
const file = { name: '材料.txt', mimeType: 'text/plain', base64: Buffer.from('original bytes').toString('base64'), text: 'extracted text' };

it('rejects invalid targets before creating any original material files', () => {
  const f = fixture();
  for (const nodeId of ['missing', '']) expect(() => importWorkbenchMaterial(f.root, f.document.id, f.document.revision, { ...file, nodeId })).toThrow('editable material target');
  expect(readdirSync(join(f.root, 'thought-workbenches', f.document.id))).toEqual(['document.json']);
});

it('removes only a newly written blob when document commit fails', () => {
  const f = fixture();
  const first = importWorkbenchMaterial(f.root, f.document.id, f.document.revision, file);
  const directory = join(f.root, 'thought-workbenches', first.id);
  const before = readdirSync(directory).sort();
  const mock = spyOn(storage, 'saveThoughtDocument').mockImplementation(() => { throw new Error('disk full'); });
  try {
    expect(() => importWorkbenchMaterial(f.root, first.id, first.revision, { ...file, base64: Buffer.from('different bytes').toString('base64') })).toThrow('disk full');
    expect(readdirSync(directory).sort()).toEqual(before);
    expect(() => importWorkbenchMaterial(f.root, first.id, first.revision, file)).toThrow('disk full');
    expect(readdirSync(directory).sort()).toEqual(before);
    expect(readWorkbenchMaterial(f.root, first.id, first.nodes[0]!.materials[0]!.id).base64).toBe(file.base64);
  } finally { mock.mockRestore(); }
});

it('stores exact original bytes once and validates the digest on read', () => {
  const f = fixture();
  const first = importWorkbenchMaterial(f.root, f.document.id, f.document.revision, file);
  const material = first.nodes[0]!.materials[0]!;
  expect(readWorkbenchMaterial(f.root, first.id, material.id).base64).toBe(file.base64);
  importWorkbenchMaterial(f.root, first.id, first.revision, { ...file, name: 'same-content.txt' });
  expect(readdirSync(join(f.root, 'thought-workbenches', first.id)).filter(name => name.startsWith('blob-'))).toHaveLength(1);
  writeFileSync(workbenchBlobPath(f.root, first.id, material.digest), 'corrupt');
  expect(() => readWorkbenchMaterial(f.root, first.id, material.id)).toThrow('digest mismatch');
});

it('preserves page and selection provenance without bringing excluded full text into context', async () => {
  const f = fixture();
  const imported = importWorkbenchMaterial(f.root, f.document.id, f.document.revision, { ...file, text: 'SECRET keep this', pages: [{ page: 1, text: 'SECRET' }, { page: 2, text: 'keep this' }] });
  const material = imported.nodes[0]!.materials[0]!;
  const quoted = quoteWorkbenchMaterial(f.root, imported.id, imported.revision, material.id, { page: 2, start: 0, end: 4 });
  const quote = quoted.nodes.at(-1)!;
  expect(quote.materials[0]?.selection).toEqual({ materialId: material.id, page: 2, start: 0, end: 4 });
  const question = { ...newThoughtNode('question'), question: 'Summarize' };
  const context = await compileThoughtContext({ ...quoted, nodes: [...quoted.nodes, question], edges: [{ id: 'quote-edge', source: quote.id, target: question.id, kind: 'context', depth: 'full', order: 0 }] }, question.id);
  expect(JSON.stringify(context.messages)).toContain('keep');
  expect(JSON.stringify(context.messages)).not.toContain('SECRET');
  expect(() => quoteWorkbenchMaterial(f.root, quoted.id, quoted.revision, material.id, { page: 2, start: 0, end: 999 })).toThrow('selection');
});

it('rejects stale writes, malformed encoding and reading unrelated material identities', () => {
  const f = fixture();
  expect(() => importWorkbenchMaterial(f.root, f.document.id, 0, file)).toThrow('revision conflict');
  expect(() => importWorkbenchMaterial(f.root, f.document.id, 1, { ...file, base64: 'not base64' })).toThrow('encoding');
  expect(() => readWorkbenchMaterial(f.root, f.document.id, 'unknown')).toThrow('Unknown material');
});

it('never reads material bytes through a symlink', () => {
  const f = fixture();
  const imported = importWorkbenchMaterial(f.root, f.document.id, 1, file);
  const material = imported.nodes[0]!.materials[0]!;
  const path = workbenchBlobPath(f.root, imported.id, material.digest);
  rmSync(path); symlinkSync(join(f.root, 'outside'), path);
  expect(() => readWorkbenchMaterial(f.root, imported.id, material.id)).toThrow('Invalid material blob path');
});
