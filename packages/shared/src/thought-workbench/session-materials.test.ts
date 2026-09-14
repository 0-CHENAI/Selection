import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Message } from '@craft-agent/core/types';
import { attachSessionMaterials } from './session-materials.ts';
import { sessionSourceNodes, appendSessionSources, assertSourceNodesUnchanged } from './sources.ts';
import { newThoughtDocument } from './types.ts';
import { saveThoughtDocument } from './storage.ts';
import { readWorkbenchMaterial } from './materials.ts';
import { exportWorkbenchBundle, importWorkbenchBundle } from './bundle.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thought-session-materials-')); roots.push(root);
  const directory = join(root, 'sessions', 'session', 'attachments'); mkdirSync(directory, { recursive: true });
  const storedPath = join(directory, 'source.txt'); writeFileSync(storedPath, '完整材料');
  const message: Message = { id: 'message', role: 'user', content: 'Read this', timestamp: 1, attachments: [{ id: 'file', type: 'text', name: 'source.txt', mimeType: 'text/plain', size: 12, storedPath }] };
  const document = saveThoughtDocument(root, newThoughtDocument('draft'), 0);
  return { root, directory, document, message, mirror: () => attachSessionMaterials(root, document.id, 'session', [message], sessionSourceNodes('session', [message])) };
}

it('copies session originals with stable identities and survives detached backup import', async () => {
  const f = fixture();
  const nodes = await f.mirror();
  expect(await f.mirror()).toEqual(nodes);
  const saved = saveThoughtDocument(f.root, appendSessionSources(f.document, nodes), f.document.revision);
  const material = nodes[0]!.materials[0]!;
  expect(material.text).toBe('完整材料');
  expect(readWorkbenchMaterial(f.root, saved.id, material.id).base64).toBe(Buffer.from('完整材料').toString('base64'));
  const copy = importWorkbenchBundle(f.root, exportWorkbenchBundle(f.root, saved.id));
  expect(readWorkbenchMaterial(f.root, copy.id, material.id).base64).toBe(Buffer.from('完整材料').toString('base64'));
  const forged = { ...saved, nodes: nodes.map(node => ({ ...node, materials: node.materials.map(item => ({ ...item, text: 'forged' })) })) };
  expect(() => assertSourceNodesUnchanged(saved, forged)).toThrow('read-only');
  expect(() => appendSessionSources(saved, forged.nodes)).toThrow('snapshot changed');
});

it('rejects foreign paths and symlinks and invalid files instead of silently omitting them', async () => {
  const f = fixture();
  const outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'private');
  const attachment = f.message.attachments![0]!;
  attachment.storedPath = outside;
  await expect(f.mirror()).rejects.toThrow('outside its session');
  const link = join(f.directory, 'link'); symlinkSync(outside, link); attachment.storedPath = link;
  await expect(f.mirror()).rejects.toThrow('outside its session');
  attachment.storedPath = join(f.directory, 'source.txt'); attachment.type = 'pdf';
  attachment.mimeType = 'application/pdf';
  await expect(f.mirror()).rejects.toThrow();
});

it('retains image bytes and the existing Office extraction without using thumbnails as originals', async () => {
  const f = fixture();
  const attachment = f.message.attachments![0]!;
  attachment.type = 'image'; attachment.mimeType = 'image/png';
  const bytes = Buffer.from([137, 80, 78, 71]); writeFileSync(attachment.storedPath, bytes);
  attachment.thumbnailBase64 = Buffer.from('not the original').toString('base64');
  const image = (await f.mirror())[0]!.materials[0]!;
  const imageDoc = saveThoughtDocument(f.root, appendSessionSources(f.document, await f.mirror()), f.document.revision);
  expect(readWorkbenchMaterial(f.root, imageDoc.id, image.id).base64).toBe(bytes.toString('base64'));
  expect(image.text).toBe('');
  attachment.type = 'office'; attachment.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  attachment.markdownPath = join(f.directory, 'extracted.md'); writeFileSync(attachment.markdownPath, '# Office content');
  expect((await f.mirror())[0]!.materials[0]!.text).toBe('# Office content');
});

it('extracts PDF pages and DOCX notes during session import without preconverted text', async () => {
  const f = fixture();
  const attachment = f.message.attachments![0]!;
  attachment.name = 'invoice.pdf'; attachment.type = 'pdf'; attachment.mimeType = 'application/pdf';
  const pdf = readFileSync(join(import.meta.dir, '../../../../apps/electron/src/renderer/assets/samples/sample-invoice.pdf'));
  writeFileSync(attachment.storedPath, pdf);
  const extracted = (await f.mirror())[0]!.materials[0]!;
  expect(extracted.pages?.map(page => page.page)).toEqual([1, 2]);
  expect(extracted.pages?.[1]?.text).toContain('Terms');
  const require = createRequire(import.meta.url);
  const docx = readFileSync(join(dirname(require.resolve('mammoth/package.json')), 'test/test-data/footnotes.docx'));
  writeFileSync(attachment.storedPath, docx);
  attachment.name = 'notes.docx'; attachment.type = 'office'; attachment.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  expect((await f.mirror())[0]!.materials[0]!.text).toContain('A tachyon walks into a bar.');
});
