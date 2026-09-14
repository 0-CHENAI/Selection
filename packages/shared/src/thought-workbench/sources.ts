import { createHash } from 'node:crypto';
import type { Message } from '@craft-agent/core/types';
import type { ThoughtDocument, ThoughtNode } from './types.ts';
import { newThoughtNode } from './types.ts';
import { canonicalJson } from './context.ts';
import { loadThoughtDocument, saveThoughtDocument, readWorkbenchRecord, writeWorkbenchRecord, ThoughtDocumentSchema } from './storage.ts';
import { loadTaskResults } from '../tasks/results.ts';
import { readRunLog } from '../tasks/storage.ts';

const sourceId = (source: ThoughtNode['source']) => `source-${createHash('sha256').update(canonicalJson(source)).digest('hex').slice(0, 32)}`;

/** Mirrors contain only committed content. Tool chatter and previews are not answers. */
export function isMirrorableMessage(message: Message): boolean {
  if (message.hidden || message.isStreaming || message.isPending || message.isQueued || message.isError) return false;
  if (message.role === 'user') return true;
  return message.role === 'assistant' && !message.isIntermediate && !message.answerPreview
    && (message.answerProtocol !== 'explicit-v1' || message.answerCommitted === true);
}

/** A completion event identifies its own answer; never fall back to a prior
 * turn, process text, or the event's unverified convenience text. */
export function committedGenerationAnswer(messages: Message[], finalMessageId?: string): string {
  const answer = finalMessageId ? messages.find(message => message.id === finalMessageId) : undefined;
  if (!answer || answer.role !== 'assistant' || !isMirrorableMessage(answer) || !answer.content.trim()) throw new Error('Agent completed without a confirmed answer');
  return answer.content;
}

/** Adds source snapshots, never updates an existing snapshot in place. */
export function appendSourceNodes(document: ThoughtDocument, incoming: ThoughtNode[]): ThoughtDocument {
  const known = new Map(document.nodes.map(node => [node.id, node]));
  const added: ThoughtNode[] = [];
  for (const node of incoming) {
    const previous = known.get(node.id);
    if (previous) {
      if (canonicalJson(previous.source) !== canonicalJson(node.source) || previous.question !== node.question || previous.answer !== node.answer || canonicalJson(previous.materials) !== canonicalJson(node.materials)) throw new Error('Source snapshot changed; import a new source version');
      continue;
    }
    known.set(node.id, node); added.push(node);
  }
  if (!added.length) return document;
  return { ...document, nodes: [...document.nodes, ...added.map((node, index) => ({ ...node, position: { x: 0, y: (document.nodes.length + index) * 180 } }))] };
}

export function sessionSourceNodes(sessionId: string, messages: Message[], messageIds?: string[]): ThoughtNode[] {
  const chosen = messageIds ? new Set(messageIds) : undefined;
  const eligible = messages.filter(isMirrorableMessage).filter(message => !chosen || chosen.has(message.id));
  if (chosen && (chosen.size !== messageIds!.length || eligible.length !== chosen.size)) throw new Error('Select only completed conversation messages');
  return eligible.map(message => {
    const source = { sessionId, messageId: message.id };
    return { ...newThoughtNode(sourceId(source)), kind: 'result' as const, title: message.content.slice(0, 80),
      question: message.role === 'user' ? message.content : '', answer: message.role === 'assistant' ? message.content : '', source };
  });
}

export function appendSessionSources(document: ThoughtDocument, incoming: ThoughtNode[]): ThoughtDocument {
  const next = appendSourceNodes(document, incoming);
  if (next === document) return document;
  const existing = new Set(document.nodes.map(node => node.id));
  const edges = [...document.edges];
  for (let i = 1; i < incoming.length; i++) {
    const parent = incoming[i - 1]!, child = incoming[i]!;
    // Re-import must not restore a context edge the user deliberately cut.
    if (existing.has(child.id)) continue;
    edges.push({ id: `mirror-${child.id}`, source: parent.id, target: child.id, kind: 'context', depth: 'full', order: 0 });
  }
  return { ...next, edges };
}

/** Immutable receipts let graph undo restore a removed mirror without trusting client text. */
export function recordSourceSnapshots(root: string, documentId: string, nodes: ThoughtNode[]): void {
  const pending: ThoughtNode[] = [];
  const ids = new Set<string>();
  // Validate the complete batch before publishing any immutable receipt.
  for (const input of nodes) {
    const node = ThoughtDocumentSchema.shape.nodes.element.parse(input);
    if (node.kind !== 'result' || ids.has(node.id)) throw new Error('Invalid or duplicate source snapshot');
    ids.add(node.id);
    const previous = readWorkbenchRecord(root, documentId, 'source', node.id);
    if (previous) {
      const snapshot = ThoughtDocumentSchema.shape.nodes.element.parse(previous);
      assertSourceNodesUnchanged({ ...newEmptySourceDocument(documentId), nodes: [snapshot] }, { ...newEmptySourceDocument(documentId), nodes: [node] });
    } else pending.push(node);
  }
  for (const node of pending) writeWorkbenchRecord(root, documentId, 'source', node.id, node);
}

function newEmptySourceDocument(id: string): ThoughtDocument {
  return { schemaVersion: 1, id, revision: 0, title: '', archived: false, nodes: [], edges: [], updatedAt: '' };
}

export function sourceReceipts(root: string, documentId: string, nodes: ThoughtNode[]): ThoughtNode[] {
  return nodes.filter(node => node.kind === 'result').flatMap(node => {
    const value = readWorkbenchRecord(root, documentId, 'source', node.id);
    if (!value) return [];
    const snapshot = ThoughtDocumentSchema.shape.nodes.element.parse(value);
    if (snapshot.id !== node.id || snapshot.kind !== 'result') throw new Error('Invalid source receipt');
    return [snapshot];
  });
}

export function importTaskResult(root: string, documentId: string, expectedRevision: number, slug: string, runId: string, nodeId: string): ThoughtDocument {
  const document = loadThoughtDocument(root, documentId);
  if (!document || document.revision !== expectedRevision) throw new Error('Workbench revision conflict');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId)) throw new Error('Invalid result identity');
  const results = loadTaskResults(root, slug, runId);
  const result = results.nodes.find(node => node.id === nodeId);
  if (!result || result.state !== 'done' || !result.output) throw new Error('Only completed node outputs can enter the thought view');
  const lifecycle = readRunLog(root, slug, runId).filter(entry => (entry.kind === 'node-scheduled' || entry.kind === 'node-finished') && entry.nodeId === nodeId);
  const last = lifecycle.at(-1);
  // The output file can still contain the previous attempt while a retry is running.
  if (last?.kind !== 'node-finished' || last.state !== 'done') throw new Error('Node attempt is not complete');
  const scheduled = lifecycle.filter(entry => entry.kind === 'node-scheduled').at(-1);
  const source = { taskSlug: slug, runId, revision: scheduled?.revision ?? 0, nodeId, attempt: result.attempt ?? 0 };
  const node: ThoughtNode = { ...newThoughtNode(sourceId(source)), kind: 'result', title: result.title, answer: result.output, source };
  recordSourceSnapshots(root, documentId, [node]);
  const next = appendSourceNodes(document, [node]);
  return next === document ? document : saveThoughtDocument(root, next, expectedRevision);
}

/** Ordinary graph saves may move/archive mirrors, but never rewrite their authoritative text. */
export function assertSourceNodesUnchanged(previous: ThoughtDocument | null, next: ThoughtDocument, receipts: ThoughtNode[] = []): void {
  const old = new Map([...receipts, ...(previous?.nodes ?? [])].filter(node => node.kind === 'result').map(node => [node.id, node]));
  for (const node of next.nodes) {
    const before = old.get(node.id);
    if (node.kind === 'result' || before) {
      if (!before || node.kind !== 'result' || node.question !== before.question || node.answer !== before.answer || canonicalJson(node.source) !== canonicalJson(before.source) || canonicalJson(node.materials) !== canonicalJson(before.materials)) throw new Error('Source result nodes are read-only');
    }
  }
}
