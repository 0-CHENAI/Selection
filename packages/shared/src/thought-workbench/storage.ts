import { mkdirSync, readFileSync, readdirSync, realpathSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { atomicWorkbenchWrite as atomicWriteFileSync } from './atomic.ts';
import { validateThoughtGraph } from './context.ts';
import type { ThoughtDocument, ThoughtGeneration, CompiledThoughtContext } from './types.ts';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text = z.string();
export const ThoughtReplaySchema = z.object({ id, documentId: id, nodeIds: z.array(id), completedNodeIds: z.array(id), generationId: id.optional(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']), error: text.optional() }).strict();
export const generationSchema = z.object({ id, documentId: id, nodeId: id, sessionId: id,
  sequence: z.number().int().nonnegative().optional(),
  mode: z.enum(['question', 'agent']).optional(),
  detached: z.boolean().optional(),
  preview: z.string().optional(),
  processText: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  contextHash: text, status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  answer: text.optional(), error: text.optional() }).strict();

function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
const material = z.object({ id, name: text, mimeType: text, digest: z.string().regex(/^[a-f0-9]{64}$/), text, page: z.number().int().positive().optional(),
  size: z.number().int().nonnegative().optional(), pages: z.array(z.object({ page: z.number().int().positive(), text }).strict()).optional(),
  selection: z.object({ materialId: id, page: z.number().int().positive().optional(), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict().optional(),
}).strict();
const version = z.object({ id, question: text, answer: text, contextHash: text, model: text, createdAt: text,
  status: z.enum(['completed', 'interrupted', 'failed']), sessionId: id.optional(), origin: z.enum(['model', 'manual']).optional() }).strict();
const source = z.object({ sessionId: text.optional(), messageId: text.optional(), taskSlug: text.optional(), runId: text.optional(),
  revision: z.number().int().nonnegative().optional(), nodeId: text.optional(), attempt: z.number().int().nonnegative().optional() }).strict();
export const ThoughtDocumentSchema = z.object({
  groups: z.array(z.object({ id, title: text, nodeIds: z.array(id), collapsed: z.boolean() }).strict()).optional(),
  schemaVersion: z.literal(1), id, revision: z.number().int().nonnegative(), title: text,
  projectId: text.optional(), taskSlug: text.optional(), taskEtag: text.optional(), executionYaml: text.optional(),
  lastAppliedProposalId: id.optional(),
  archived: z.boolean(), updatedAt: text,
  nodes: z.array(z.object({ id, kind: z.enum(['question', 'note', 'material', 'result']), title: text, question: text, answer: text,
    mode: z.enum(['question', 'agent']), model: text.optional(), llmConnection: text.optional(), role: text.optional(), archived: z.boolean(),
    highlights: z.array(text), highlightMode: z.enum(['off', 'filter', 'tag']), materials: z.array(material), excludedMaterialIds: z.array(text),
    versions: z.array(version), activeVersionId: id.optional(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), source: source.optional(),
  }).strict()),
  edges: z.array(z.object({ id, source: id, target: id, kind: z.enum(['context', 'reference']), order: z.number().finite(), depth: z.enum(['quote', 'full']) }).strict()),
}).strict();

export function documentPath(workspaceRoot: string, documentId: string, create: boolean): string {
  id.parse(documentId);
  const root = realpathSync(workspaceRoot);
  const parent = join(root, 'thought-workbenches');
  const directory = join(parent, documentId);
  // Check each component before creating below it; never write through user-created symlinks.
  for (const component of [parent, directory]) {
    if (isSymlink(component)) throw new Error('Invalid workbench directory');
    if (existsSync(component)) {
      if (lstatSync(component).isSymbolicLink() || !lstatSync(component).isDirectory()) throw new Error('Invalid workbench directory');
      if (!realpathSync(component).startsWith(root + sep)) throw new Error('Workbench path escapes workspace');
    } else if (create) mkdirSync(component);
  }
  const path = resolve(directory, 'document.json');
  if (isSymlink(path)) throw new Error('Invalid workbench document');
  return path;
}

export function workbenchBlobPath(root: string, documentId: string, digest: string): string {
  z.string().regex(/^[a-f0-9]{64}$/).parse(digest);
  const directory = documentPath(root, documentId, false).replace(/document\.json$/, '');
  if (!loadThoughtDocument(root, documentId)) throw new Error('Unknown workbench');
  const path = join(directory, `blob-${digest}`);
  if (isSymlink(path)) throw new Error('Invalid material blob path');
  return path;
}

export function loadThoughtDocument(root: string, documentId: string): ThoughtDocument | null {
  const path = documentPath(root, documentId, false);
  if (!existsSync(path)) return null;
  const doc = ThoughtDocumentSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (doc.id !== documentId) throw new Error('Workbench identity mismatch');
  validateThoughtGraph(doc);
  return doc;
}

/** Synchronous compare-and-write on the server event loop; no await inside the transaction. */
export function saveThoughtDocument(root: string, input: unknown, expectedRevision: number): ThoughtDocument {
  const document = ThoughtDocumentSchema.parse(input);
  validateThoughtGraph(document);
  const previous = loadThoughtDocument(root, document.id);
  if ((previous?.revision ?? 0) !== expectedRevision || document.revision !== expectedRevision) throw new Error('Workbench revision conflict');
  const next = { ...document, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
  atomicWriteFileSync(documentPath(root, document.id, true), JSON.stringify(next));
  return next;
}

export function listThoughtDocuments(root: string): ThoughtDocument[] {
  const parent = join(root, 'thought-workbenches');
  if (!existsSync(parent)) return [];
  if (lstatSync(parent).isSymbolicLink()) throw new Error('Invalid workbench directory');
  return readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory() && id.safeParse(entry.name).success)
    .map(entry => loadThoughtDocument(root, entry.name)).filter((doc): doc is ThoughtDocument => doc !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveThoughtGeneration(root: string, generation: ThoughtGeneration, context?: CompiledThoughtContext): void {
  generationSchema.parse(generation);
  // Each generation is a separately durable record, including failures and cancellation.
  const directory = documentPath(root, generation.documentId, true).replace(/document\.json$/, '');
  id.parse(generation.id);
  const path = join(directory, `generation-${generation.id}.json`);
  if (isSymlink(path)) throw new Error('Invalid generation path');
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  atomicWriteFileSync(path, JSON.stringify({ generation, context: context ?? previous?.context }));
}

export function loadThoughtGeneration(root: string, generationId: string): ThoughtGeneration | null {
  id.parse(generationId);
  for (const document of listThoughtDocuments(root)) {
    const directory = documentPath(root, document.id, false).replace(/document\.json$/, '');
    const path = join(directory, `generation-${generationId}.json`);
    if (isSymlink(path)) throw new Error('Invalid generation path');
    if (!existsSync(path)) continue;
    const value = generationSchema.parse(JSON.parse(readFileSync(path, 'utf8')).generation);
    if (value.id !== generationId || value.documentId !== document.id) throw new Error('Generation identity mismatch');
    return value;
  }
  return null;
}

/** Enumerate receipts within one document; reopening never schedules a model. */
export function listThoughtGenerations(root: string, documentId: string, nodeId?: string): ThoughtGeneration[] {
  if (nodeId !== undefined) id.parse(nodeId);
  if (!loadThoughtDocument(root, documentId)) throw new Error('Unknown workbench');
  const directory = documentPath(root, documentId, false).replace(/document\.json$/, '');
  return readdirSync(directory).filter(name => name.startsWith('generation-') && name.endsWith('.json')).sort().flatMap(name => {
    const generationId = name.slice('generation-'.length, -'.json'.length);
    id.parse(generationId);
    const path = join(directory, name);
    if (isSymlink(path)) throw new Error('Invalid generation path');
    const generation = generationSchema.parse(JSON.parse(readFileSync(path, 'utf8')).generation);
    if (generation.id !== generationId || generation.documentId !== documentId) throw new Error('Generation identity mismatch');
    return nodeId === undefined || generation.nodeId === nodeId ? [generation] : [];
  }).sort((left, right) => {
    // Unknown legacy times remain explicitly unknown and sort before dated
    // records. IDs break ties deterministically, independent of directory order.
    if (!left.createdAt && right.createdAt) return -1;
    if (left.createdAt && !right.createdAt) return 1;
    const time = left.createdAt && right.createdAt ? Date.parse(left.createdAt) - Date.parse(right.createdAt) : 0;
    return time || left.id.localeCompare(right.id);
  });
}

/** Document-owned records share the same path hardening as document.json. */
function recordPath(root: string, documentId: string, category: 'proposal' | 'source' | 'replay' | 'link', recordId: string): string {
  id.parse(recordId);
  const directory = documentPath(root, documentId, false).replace(/document\.json$/, '');
  if (!loadThoughtDocument(root, documentId)) throw new Error('Unknown workbench');
  const path = join(directory, `${category}-${recordId}.json`);
  if (isSymlink(path)) throw new Error('Invalid workbench record path');
  return path;
}

export function readWorkbenchRecord(root: string, documentId: string, category: 'proposal' | 'source' | 'replay' | 'link', recordId: string): unknown | null {
  const path = recordPath(root, documentId, category, recordId);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function writeWorkbenchRecord(root: string, documentId: string, category: 'proposal' | 'source' | 'replay' | 'link', recordId: string, value: unknown): void {
  atomicWriteFileSync(recordPath(root, documentId, category, recordId), JSON.stringify(value));
}

export function listWorkbenchRecords(root: string, documentId: string, category: 'proposal' | 'replay'): unknown[] {
  const directory = documentPath(root, documentId, false).replace(/document\.json$/, '');
  if (!loadThoughtDocument(root, documentId)) throw new Error('Unknown workbench');
  return readdirSync(directory).filter(name => name.startsWith(`${category}-`) && name.endsWith('.json'))
    .sort().map(name => {
      const recordId = name.slice(category.length + 1, -5);
      const record = readWorkbenchRecord(root, documentId, category, recordId);
      if (!record || typeof record !== 'object' || !('id' in record) || record.id !== recordId) throw new Error('Workbench record identity mismatch');
      return record;
    });
}
