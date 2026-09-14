import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync, mkdtempSync, writeFileSync, renameSync, rmSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { documentPath, loadThoughtDocument, ThoughtDocumentSchema, generationSchema, ThoughtReplaySchema } from './storage.ts';
import { WorkbenchProposalSchema } from './proposals.ts';
import { canonicalJson, validateThoughtGraph } from './context.ts';
import type { ThoughtDocument } from './types.ts';

const filename = /^(document\.json|blob-[a-f0-9]{64}|(?:generation|proposal|source|replay)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json)$/;
const schema = z.object({ format: z.literal('selection-workbench'), version: z.literal(1),
  files: z.array(z.object({ name: z.string().regex(filename), digest: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string() }).strict()),
}).strict();
export type WorkbenchBundle = z.infer<typeof schema>;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Includes disconnected source receipts and generation snapshots, not merely visible nodes. */
export function exportWorkbenchBundle(root: string, id: string): WorkbenchBundle {
  if (!loadThoughtDocument(root, id)) throw new Error('Unknown workbench');
  const directory = dirname(documentPath(root, id, false));
  const files = readdirSync(directory).filter(name => filename.test(name)).sort().map(name => {
    const path = join(directory, name);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Invalid bundle file');
    const bytes = readFileSync(path);
    if (name.startsWith('blob-') && hash(bytes) !== name.slice(5)) throw new Error('Material digest mismatch');
    return { name, digest: hash(bytes), base64: bytes.toString('base64') };
  });
  return { format: 'selection-workbench', version: 1, files };
}

/** Always imports a detached copy. Never overwrites a live task or resumes external execution. */
export function importWorkbenchBundle(root: string, input: unknown): ThoughtDocument {
  const bundle = schema.parse(input);
  const files = new Map<string, Buffer>();
  for (const file of bundle.files) {
    if (files.has(file.name)) throw new Error('Duplicate bundle file');
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64 || hash(bytes) !== file.digest) throw new Error('Bundle checksum mismatch');
    if (file.name.startsWith('blob-') && file.name.slice(5) !== file.digest) throw new Error('Material digest mismatch');
    files.set(file.name, bytes);
  }
  const original = ThoughtDocumentSchema.parse(JSON.parse(files.get('document.json')?.toString('utf8') ?? 'null'));
  validateThoughtGraph(original);
  for (const node of original.nodes) for (const material of node.materials) {
    if (!files.has(`blob-${material.digest}`)) throw new Error('Missing material original');
  }
  const id = randomUUID();
  const generationIds = new Map([...files.keys()].filter(name => name.startsWith('generation-')).map(name => [name.slice(11, -5), randomUUID()]));
  const document: ThoughtDocument = { ...original, id, revision: 1, taskSlug: undefined, taskEtag: undefined,
    projectId: undefined, lastAppliedProposalId: undefined, updatedAt: new Date().toISOString(),
    nodes: original.nodes.map(node => ({ ...node,
      activeVersionId: node.activeVersionId ? generationIds.get(node.activeVersionId) ?? node.activeVersionId : undefined,
      versions: node.versions.map(version => ({ ...version, id: generationIds.get(version.id) ?? version.id })),
    })) };
  // Validate and rewrite document-scoped identities before touching the filesystem.
  for (const [name, bytes] of [...files]) {
    if (name === 'document.json' || name.startsWith('blob-')) continue;
    const value = JSON.parse(bytes.toString('utf8'));
    const recordId = name.slice(name.indexOf('-') + 1, -5);
    if (name.startsWith('source-')) {
      const source = ThoughtDocumentSchema.shape.nodes.element.parse(value);
      if (source.id !== recordId || source.kind !== 'result') throw new Error('Invalid source receipt');
      for (const material of source.materials) if (!files.has(`blob-${material.digest}`)) throw new Error('Missing source material original');
      const visible = document.nodes.find(node => node.id === source.id);
      if (visible && (visible.kind !== 'result' || visible.question !== source.question || visible.answer !== source.answer || canonicalJson(visible.source) !== canonicalJson(source.source) || canonicalJson(visible.materials) !== canonicalJson(source.materials))) throw new Error('Source receipt content mismatch');
    } else if (name.startsWith('proposal-')) {
      WorkbenchProposalSchema.parse(value);
      if (value.id !== recordId || value.baseline?.documentId !== original.id) throw new Error('Invalid proposal identity');
      value.baseline.documentId = id;
      // Imported proposals remain reviewable but cannot apply a foreign baseline.
      if (value.status === 'generating' || value.status === 'ready') value.status = 'discarded';
    } else if (name.startsWith('replay-')) {
      ThoughtReplaySchema.parse(value);
      if (value.id !== recordId || value.documentId !== original.id) throw new Error('Invalid replay identity');
      value.documentId = id;
      if (value.generationId) value.generationId = generationIds.get(value.generationId) ?? value.generationId;
      if (value.status === 'running') value.status = 'interrupted';
    } else {
      generationSchema.parse(value.generation);
      if (value.generation?.id !== recordId || value.generation.documentId !== original.id) throw new Error('Invalid generation identity');
      value.generation.id = generationIds.get(recordId)!;
      value.generation.documentId = id;
      value.generation.detached = true;
      if (value.generation.status === 'running') value.generation.status = 'interrupted';
      if (value.context) value.context.documentId = id;
    }
    if (name.startsWith('generation-')) {
      files.delete(name);
      files.set(`generation-${value.generation.id}.json`, Buffer.from(JSON.stringify(value)));
    } else files.set(name, Buffer.from(JSON.stringify(value)));
  }
  files.set('document.json', Buffer.from(JSON.stringify(document)));
  // Create the hardened parent via a reserved empty destination, then stage beside it.
  const destination = dirname(documentPath(root, id, true));
  const staging = mkdtempSync(join(dirname(destination), '.import-'));
  try {
    for (const [name, bytes] of files) {
      const fd = openSync(join(staging, name), 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return document;
}
