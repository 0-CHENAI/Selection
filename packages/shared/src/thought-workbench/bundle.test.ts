import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newThoughtDocument } from './types.ts';
import { saveThoughtDocument, loadThoughtDocument, listThoughtDocuments, saveThoughtGeneration, loadThoughtGeneration, writeWorkbenchRecord, readWorkbenchRecord } from './storage.ts';
import { listWorkbenchProposals } from './proposals.ts';
import { importWorkbenchMaterial, readWorkbenchMaterial } from './materials.ts';
import { exportWorkbenchBundle, importWorkbenchBundle } from './bundle.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thought-bundle-')); roots.push(root);
  const saved = saveThoughtDocument(root, { ...newThoughtDocument('draft'), taskSlug: 'task', taskEtag: 'etag' }, 0);
  const document = importWorkbenchMaterial(root, saved.id, saved.revision, { name: 'original.txt', mimeType: 'text/plain', text: 'original', base64: Buffer.from('original').toString('base64') });
  return { root, document };
}
it('round-trips original material bytes into a detached copy without changing the source', () => {
  const { root, document } = fixture();
  const copy = importWorkbenchBundle(root, exportWorkbenchBundle(root, document.id));
  expect(copy.id).not.toBe(document.id);
  expect(copy.taskSlug).toBeUndefined();
  expect(copy.nodes).toEqual(document.nodes);
  expect(readWorkbenchMaterial(root, copy.id, copy.nodes[0]!.materials[0]!.id).base64).toBe(Buffer.from('original').toString('base64'));
  expect(loadThoughtDocument(root, document.id)).toEqual(document);
});
it('rejects corrupt, missing, duplicate and path-traversing entries before publishing any document', () => {
  const { root, document } = fixture();
  const bundle = exportWorkbenchBundle(root, document.id);
  expect(() => importWorkbenchBundle(root, { ...bundle, files: bundle.files.map(file => ({ ...file, base64: 'AA==' })) })).toThrow('checksum');
  expect(() => importWorkbenchBundle(root, { ...bundle, files: bundle.files.filter(file => !file.name.startsWith('blob-')) })).toThrow('Missing material');
  expect(() => importWorkbenchBundle(root, { ...bundle, files: [...bundle.files, bundle.files[0]] })).toThrow('Duplicate');
  expect(() => importWorkbenchBundle(root, { ...bundle, files: [{ ...bundle.files[0], name: '../document.json' }] })).toThrow();
  expect(listThoughtDocuments(root)).toHaveLength(1);
});
it('imports running generation snapshots as interrupted without scheduling work', () => {
  const { root, document } = fixture();
  saveThoughtGeneration(root, { id: 'generation', mode: 'agent', processText: 'progress', preview: 'unconfirmed', createdAt: '2026-09-13T09:00:00.000Z', documentId: document.id, nodeId: document.nodes[0]!.id, sessionId: 'session', contextHash: 'hash', status: 'running' });
  const bundle = exportWorkbenchBundle(root, document.id);
  const other = mkdtempSync(join(tmpdir(), 'thought-bundle-')); roots.push(other);
  const copy = importWorkbenchBundle(other, bundle);
  const record = exportWorkbenchBundle(other, copy.id).files.find(file => file.name.startsWith('generation-'))!;
  const importedId = record.name.slice(11, -5);
  expect(importedId).not.toBe('generation');
  expect(loadThoughtGeneration(other, importedId)).toMatchObject({ documentId: copy.id, status: 'interrupted', detached: true, mode: 'agent', sessionId: 'session', processText: 'progress', preview: 'unconfirmed', createdAt: '2026-09-13T09:00:00.000Z' });
  expect(copy.nodes.every(node => node.versions.length === 0)).toBe(true);
  expect(loadThoughtGeneration(root, 'generation')?.detached).toBeUndefined();
});
it('retains proposal dialogue and disconnected source receipts, without actionable old proposals', () => {
  const { root, document } = fixture();
  writeWorkbenchRecord(root, document.id, 'proposal', 'proposal', {
    id: 'proposal', baseline: { documentId: document.id, documentRevision: document.revision, executionHash: 'a'.repeat(64), nodeIds: [] },
    goal: 'preserve my author dialogue', context: 'context', currentYaml: '', createdAt: 'now', status: 'ready', yaml: 'draft',
  });
  const source = { ...document.nodes[0]!, id: 'source', kind: 'result' as const, answer: 'completed result', source: { sessionId: 'session', messageId: 'message' } };
  writeWorkbenchRecord(root, document.id, 'source', source.id, source);
  const copy = importWorkbenchBundle(root, exportWorkbenchBundle(root, document.id));
  expect(listWorkbenchProposals(root, copy.id)[0]).toMatchObject({ goal: 'preserve my author dialogue', status: 'discarded', baseline: { documentId: copy.id } });
  expect(readWorkbenchRecord(root, copy.id, 'source', source.id)).toEqual(source);
});
