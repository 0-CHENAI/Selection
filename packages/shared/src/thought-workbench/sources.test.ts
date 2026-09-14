import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@craft-agent/core/types';
import { newThoughtDocument } from './types.ts';
import { committedGenerationAnswer, appendSessionSources, sessionSourceNodes, importTaskResult, assertSourceNodesUnchanged, recordSourceSnapshots } from './sources.ts';
import { saveThoughtDocument, readWorkbenchRecord } from './storage.ts';
import { appendRunLog, writeNodeOutput } from '../tasks/storage.ts';

const roots: string[] = [];
it('accepts only the identified committed answer, never an earlier answer or preview', () => {
  const answer: Message = { id: 'final', role: 'assistant', content: ' confirmed ', timestamp: 1, answerProtocol: 'explicit-v1', answerCommitted: true };
  expect(committedGenerationAnswer([answer], 'final')).toBe(' confirmed ');
  expect(() => committedGenerationAnswer([answer])).toThrow('confirmed answer');
  expect(() => committedGenerationAnswer([answer], 'missing')).toThrow('confirmed answer');
  for (const patch of [{ answerCommitted: false }, { answerPreview: true }, { isIntermediate: true }, { isStreaming: true }, { content: ' ' }]) {
    expect(() => committedGenerationAnswer([{ ...answer, ...patch }], 'final')).toThrow('confirmed answer');
  }
});
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const message = (id: string, patch: Partial<Message> = {}): Message => ({ id, role: 'assistant', content: id, timestamp: 1, ...patch });

it('validates every source before writing any receipt so a rejected batch can be retried', () => {
  const root = mkdtempSync(join(tmpdir(), 'thought-sources-')); roots.push(root);
  const document = saveThoughtDocument(root, newThoughtDocument('draft'), 0);
  const nodes = sessionSourceNodes('session', [message('one'), message('two')]);
  expect(() => recordSourceSnapshots(root, document.id, [nodes[0]!, { ...nodes[1]!, kind: 'question' }])).toThrow('source snapshot');
  expect(readWorkbenchRecord(root, document.id, 'source', nodes[0]!.id)).toBeNull();
  expect(() => recordSourceSnapshots(root, document.id, [nodes[0]!, nodes[0]!])).toThrow('duplicate');
  expect(readWorkbenchRecord(root, document.id, 'source', nodes[0]!.id)).toBeNull();
  recordSourceSnapshots(root, document.id, nodes);
  expect(readWorkbenchRecord(root, document.id, 'source', nodes[1]!.id)).toEqual(nodes[1]);
});

it('mirrors only completed user messages and committed answers', () => {
  const nodes = sessionSourceNodes('session', [message('user', { role: 'user' }), message('preview', { answerPreview: true }), message('uncommitted', { answerProtocol: 'explicit-v1' }), message('final', { answerProtocol: 'explicit-v1', answerCommitted: true }), message('process', { isIntermediate: true }), message('hidden', { hidden: true }), message('stream', { isStreaming: true }), message('tool', { role: 'tool' })]);
  expect(nodes.map(node => node.source?.messageId)).toEqual(['user', 'final']);
  expect(() => sessionSourceNodes('session', [message('preview', { answerPreview: true })], ['preview'])).toThrow('completed');
});

it('deduplicates source imports and does not recreate deliberately cut context', () => {
  const incoming = sessionSourceNodes('session', [message('user', { role: 'user' }), message('answer')]);
  const first = appendSessionSources(newThoughtDocument('draft'), incoming);
  expect(first.edges).toHaveLength(1);
  const cut = { ...first, edges: [] };
  expect(appendSessionSources(cut, incoming)).toBe(cut);
  expect(() => appendSessionSources(first, [{ ...incoming[1]!, answer: 'changed' }])).toThrow('snapshot changed');
});

it('protects source content but permits layout and archive changes', () => {
  const document = appendSessionSources(newThoughtDocument('draft'), sessionSourceNodes('session', [message('answer')]));
  expect(() => assertSourceNodesUnchanged(document, { ...document, nodes: document.nodes.map(node => ({ ...node, archived: true, position: { x: 1, y: 2 } })) })).not.toThrow();
  expect(() => assertSourceNodesUnchanged(document, { ...document, nodes: document.nodes.map(node => ({ ...node, answer: 'forged' })) })).toThrow('read-only');
  expect(() => assertSourceNodesUnchanged(null, document)).toThrow('read-only');
});

it('imports authoritative completed outputs with the scheduled revision and attempt', () => {
  const root = mkdtempSync(join(tmpdir(), 'thought-results-')); roots.push(root);
  const document = saveThoughtDocument(root, newThoughtDocument('draft'), 0);
  const t = new Date().toISOString();
  appendRunLog(root, 'task', 'run', { t, kind: 'node-scheduled', nodeId: 'node', revision: 1 });
  appendRunLog(root, 'task', 'run', { t, kind: 'node-finished', nodeId: 'node', sessionId: 'session', state: 'done', revision: 2 });
  writeNodeOutput(root, 'task', 'run', 'node', { text: 'Result' });
  const imported = importTaskResult(root, document.id, document.revision, 'task', 'run', 'node');
  expect(imported.nodes[0]?.source).toEqual({ taskSlug: 'task', runId: 'run', revision: 1, nodeId: 'node', attempt: 1 });
  expect(imported.nodes[0]?.answer).toBe('Result');
  expect(importTaskResult(root, document.id, imported.revision, 'task', 'run', 'node').revision).toBe(imported.revision);
  appendRunLog(root, 'task', 'run', { t, kind: 'node-scheduled', nodeId: 'node', revision: 3 });
  // Scheduling a retry now clears the projected previous output immediately.
  expect(() => importTaskResult(root, document.id, imported.revision, 'task', 'run', 'node')).toThrow('Only completed node outputs');
  expect(() => importTaskResult(root, document.id, imported.revision, '../escape', 'run', 'node')).toThrow('identity');
});
