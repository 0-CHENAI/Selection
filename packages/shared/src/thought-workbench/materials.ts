import { createHash, randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, fsyncSync } from 'node:fs';
import { z } from 'zod';
import { loadThoughtDocument, saveThoughtDocument, workbenchBlobPath } from './storage.ts';
import { newThoughtNode, type ThoughtDocument, type ThoughtMaterial } from './types.ts';

// Explicit upload safety limit, not a model/token budget. Oversize material is rejected, never truncated.
export const MAX_WORKBENCH_MATERIAL_BYTES = 32 * 1024 * 1024;
const inputSchema = z.object({ name: z.string().min(1).max(512), mimeType: z.string().min(1).max(256), base64: z.string(), text: z.string(),
  pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() }).strict()).optional(), nodeId: z.string().optional(),
}).strict();

function writeBlob(path: string, bytes: Uint8Array): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } catch (error) { closeSync(fd); unlinkSync(temporary); throw error; }
  closeSync(fd);
  try { renameSync(temporary, path); } catch (error) { unlinkSync(temporary); throw error; }
}

/** Persist an original independently of graph mutation (e.g. immutable session sources). */
export function storeWorkbenchMaterialBlob(root: string, documentId: string, bytes: Uint8Array): string {
  if (bytes.length > MAX_WORKBENCH_MATERIAL_BYTES) throw new Error('Material exceeds the 32 MiB upload safety limit');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const path = workbenchBlobPath(root, documentId, digest);
  if (existsSync(path)) {
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== digest) throw new Error('Stored material content is corrupt');
  } else writeBlob(path, bytes);
  return digest;
}

function currentDocument(root: string, documentId: string, revision: number): ThoughtDocument {
  const document = loadThoughtDocument(root, documentId);
  if (!document || document.revision !== revision) throw new Error('Workbench revision conflict');
  return document;
}

export function importWorkbenchMaterial(root: string, documentId: string, expectedRevision: number, input: z.infer<typeof inputSchema>): ThoughtDocument {
  const document = currentDocument(root, documentId, expectedRevision);
  const parsed = inputSchema.parse(input);
  if (parsed.nodeId !== undefined) {
    const target = document.nodes.find(node => node.id === parsed.nodeId);
    if (!target || target.kind === 'result') throw new Error('Select an editable material target');
  }
  if (parsed.base64.length > Math.ceil(MAX_WORKBENCH_MATERIAL_BYTES / 3) * 4) throw new Error('Material exceeds the 32 MiB upload safety limit');
  const bytes = Buffer.from(parsed.base64, 'base64');
  if (bytes.toString('base64') !== parsed.base64) throw new Error('Invalid material encoding');
  if (bytes.length > MAX_WORKBENCH_MATERIAL_BYTES) throw new Error('Material exceeds the 32 MiB upload safety limit');
  if (parsed.pages && new Set(parsed.pages.map(page => page.page)).size !== parsed.pages.length) throw new Error('Duplicate material page');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const path = workbenchBlobPath(root, documentId, digest);
  const existed = existsSync(path);
  if (existed) {
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== digest) throw new Error('Stored material content is corrupt');
  } else writeBlob(path, bytes);
  const material: ThoughtMaterial = { id: randomUUID(), name: parsed.name, mimeType: parsed.mimeType, digest, size: bytes.length, text: parsed.text, pages: parsed.pages };
  let nodes = document.nodes;
  if (parsed.nodeId !== undefined) {
    nodes = nodes.map(node => node.id === parsed.nodeId ? { ...node, materials: [...node.materials, material] } : node);
  } else nodes = [...nodes, { ...newThoughtNode(randomUUID(), { x: 0, y: nodes.length * 180 }), kind: 'material', title: parsed.name, materials: [material] }];
  try {
    return saveThoughtDocument(root, { ...document, nodes }, expectedRevision);
  } catch (error) {
    // This transaction is synchronous. Only remove the newly created original;
    // an existing digest can belong to other nodes, quotes or source receipts.
    if (!existed) {
      try { unlinkSync(path); } catch { /* Preserve the original save error. */ }
    }
    throw error;
  }
}

export function readWorkbenchMaterial(root: string, documentId: string, materialId: string): { material: ThoughtMaterial; base64: string } {
  const document = loadThoughtDocument(root, documentId);
  const material = document?.nodes.flatMap(node => node.materials).find(item => item.id === materialId);
  if (!material) throw new Error('Unknown material in workbench');
  const bytes = readFileSync(workbenchBlobPath(root, documentId, material.digest));
  if (createHash('sha256').update(bytes).digest('hex') !== material.digest) throw new Error('Material digest mismatch');
  return { material, base64: bytes.toString('base64') };
}

export function quoteWorkbenchMaterial(root: string, documentId: string, expectedRevision: number, materialId: string, selection: { page?: number; start: number; end: number }): ThoughtDocument {
  const document = currentDocument(root, documentId, expectedRevision);
  const material = document.nodes.flatMap(node => node.materials).find(item => item.id === materialId);
  if (!material || material.selection) throw new Error('Select an original material');
  const text = selection.page === undefined ? material.text : material.pages?.find(item => item.page === selection.page)?.text;
  if (text === undefined || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end <= selection.start || selection.end > text.length) throw new Error('Invalid material selection');
  const quote: ThoughtMaterial = { id: randomUUID(), name: material.name, mimeType: material.mimeType, digest: material.digest, size: material.size,
    text: text.slice(selection.start, selection.end), page: selection.page, selection: { materialId, ...selection } };
  // An independent quote does not inherit the whole source material; that would defeat selection.
  const node = { ...newThoughtNode(randomUUID(), { x: 300, y: document.nodes.length * 180 }), kind: 'material' as const, title: material.name, materials: [quote] };
  return saveThoughtDocument(root, { ...document, nodes: [...document.nodes, node] }, expectedRevision);
}
