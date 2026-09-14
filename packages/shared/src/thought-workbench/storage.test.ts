import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newThoughtDocument } from './types.ts';
import { saveThoughtDocument, loadThoughtDocument, saveThoughtGeneration, loadThoughtGeneration, listThoughtGenerations } from './storage.ts';
import { writeWorkbenchRecord, listWorkbenchRecords } from './storage.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function root() { const path = mkdtempSync(join(tmpdir(), 'thought-store-')); roots.push(path); return path; }
it('rejects mismatched record identities before recovery can overwrite another receipt', () => {
  const path = root(); saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  writeWorkbenchRecord(path, 'draft', 'replay', 'first', { id: 'second', documentId: 'draft', status: 'running' });
  expect(() => listWorkbenchRecords(path, 'draft', 'replay')).toThrow('identity mismatch');
});
it('persists a draft with revision checks and preserves the winning update', () => {
  const path = root(); const doc = newThoughtDocument('draft');
  const saved = saveThoughtDocument(path, doc, 0);
  expect(saved.revision).toBe(1);
  expect(loadThoughtDocument(path, doc.id)).toEqual(saved);
  expect(() => saveThoughtDocument(path, doc, 0)).toThrow('conflict');
  expect(loadThoughtDocument(path, doc.id)).toEqual(saved);
});
it('rejects traversal, symlink roots and unknown fields', () => {
  const path = root();
  expect(() => loadThoughtDocument(path, '../escape')).toThrow();
  expect(() => saveThoughtDocument(path, { ...newThoughtDocument('draft'), unexpected: true }, 0)).toThrow();
  symlinkSync(root(), join(path, 'thought-workbenches'));
  expect(() => saveThoughtDocument(path, newThoughtDocument('draft'), 0)).toThrow('directory');
});
it('persists interrupted generations independently of active node versions', () => {
  const path = root(); saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  const generation = { id: 'gen', documentId: 'draft', nodeId: 'node', sessionId: 'session', contextHash: 'hash', status: 'interrupted' as const };
  saveThoughtGeneration(path, generation);
  expect(loadThoughtGeneration(path, 'gen')).toEqual(generation);
  expect(() => loadThoughtGeneration(path, '../escape')).toThrow();
});
it('rejects dangling document symlinks', () => {
  const path = root(); saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  const documentPath = join(path, 'thought-workbenches', 'draft', 'document.json');
  rmSync(documentPath);
  symlinkSync(join(path, 'missing'), documentPath);
  expect(() => saveThoughtDocument(path, newThoughtDocument('draft'), 0)).toThrow('Invalid workbench document');
});

it('lists only document-owned generations and rejects symlink receipts', () => {
  const path = root();
  saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  saveThoughtDocument(path, newThoughtDocument('other'), 0);
  saveThoughtGeneration(path, { id: 'gen', documentId: 'other', nodeId: 'node', sessionId: 'session', contextHash: 'hash', status: 'interrupted' });
  expect(listThoughtGenerations(path, 'draft')).toEqual([]);
  symlinkSync(join(path, 'thought-workbenches', 'other', 'generation-gen.json'), join(path, 'thought-workbenches', 'draft', 'generation-gen.json'));
  expect(() => listThoughtGenerations(path, 'draft')).toThrow('Invalid generation path');
  expect(() => listThoughtGenerations(path, '../other')).toThrow();
});

it('orders dated receipts by creation time without inventing timestamps for legacy records', () => {
  const path = root(); saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  const base = { documentId: 'draft', nodeId: 'node', sessionId: 'session', contextHash: 'hash', status: 'completed' as const };
  saveThoughtGeneration(path, { ...base, id: 'a-later', createdAt: '2026-09-13T10:00:00.000Z' });
  saveThoughtGeneration(path, { ...base, id: 'z-earlier', createdAt: '2026-09-13T09:00:00.000Z' });
  saveThoughtGeneration(path, { ...base, id: 'legacy' });
  expect(listThoughtGenerations(path, 'draft').map(item => item.id)).toEqual(['legacy', 'z-earlier', 'a-later']);
  expect(loadThoughtGeneration(path, 'legacy')?.createdAt).toBeUndefined();
  expect(() => saveThoughtGeneration(path, { ...base, id: 'bad-date', createdAt: 'yesterday' })).toThrow();
});

it('limits node history to the requested node and validates its identity', () => {
  const path = root(); saveThoughtDocument(path, newThoughtDocument('draft'), 0);
  const base = { documentId: 'draft', sessionId: 'session', contextHash: 'hash', status: 'completed' as const };
  saveThoughtGeneration(path, { ...base, id: 'one', nodeId: 'first', answer: 'first answer' });
  saveThoughtGeneration(path, { ...base, id: 'two', nodeId: 'second', answer: 'unrelated answer' });
  expect(listThoughtGenerations(path, 'draft', 'first').map(item => item.id)).toEqual(['one']);
  expect(listThoughtGenerations(path, 'draft', 'missing')).toEqual([]);
  expect(() => listThoughtGenerations(path, 'draft', '../first')).toThrow();
});
