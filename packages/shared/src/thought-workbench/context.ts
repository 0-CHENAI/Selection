/**
 * Layered context traversal adapted from ThoughtDAG src/lib/graph.ts and
 * src/store/context-builder.ts at ef04210f6106a0dbc30f353cf67b25bee47d769c.
 * Copyright (c) 2026 Xia Chen, MIT; see THIRD_PARTY.md in this directory.
 * Selection uses indexed iterative walks and hashes the final input rather than UI state.
 */
import type { CompiledThoughtContext, ThoughtDocument, ThoughtEdge, ThoughtNode } from './types.ts';

export function canonicalJson(value: unknown): string {
  function normalize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v)
      .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, normalize(item)]));
    return v;
  }
  return JSON.stringify(normalize(value));
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function graphIndex(document: Pick<ThoughtDocument, 'nodes' | 'edges'>) {
  const nodes = new Map<string, ThoughtNode>();
  const incoming = new Map<string, ThoughtEdge[]>();
  for (const node of document.nodes) {
    if (nodes.has(node.id)) throw new Error(`Duplicate node: ${node.id}`);
    nodes.set(node.id, node);
  }
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of document.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error('Unknown edge endpoint');
    if (edge.source === edge.target) throw new Error('Self dependency');
    const pair = JSON.stringify([edge.source, edge.target]);
    if (edgeIds.has(edge.id) || pairs.has(pair)) throw new Error('Duplicate edge');
    edgeIds.add(edge.id); pairs.add(pair);
    const edges = incoming.get(edge.target);
    if (edges) edges.push(edge);
    else incoming.set(edge.target, [edge]);
  }
  for (const edges of incoming.values()) edges.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, incoming };
}

/** Iterative DFS avoids call-stack exhaustion on long imported conversations. */
function orderedAncestors(ids: string[], incoming: Map<string, ThoughtEdge[]>, structuralOnly: boolean): string[] {
  const seen = new Set<string>();
  const active = new Set<string>();
  const ordered: string[] = [];
  for (const start of ids) {
    const stack: Array<{ id: string; exit: boolean }> = [{ id: start, exit: false }];
    while (stack.length) {
      const frame = stack.pop()!;
      if (frame.exit) { active.delete(frame.id); seen.add(frame.id); ordered.push(frame.id); continue; }
      if (active.has(frame.id)) throw new Error('Cyclic context graph');
      if (seen.has(frame.id)) continue;
      active.add(frame.id);
      stack.push({ id: frame.id, exit: true });
      const parents = (incoming.get(frame.id) ?? []).filter(e => !structuralOnly || e.kind === 'context');
      for (let i = parents.length - 1; i >= 0; i--) stack.push({ id: parents[i]!.source, exit: false });
    }
  }
  return ordered;
}

export function validateThoughtGraph(document: Pick<ThoughtDocument, 'nodes' | 'edges' | 'groups'>): void {
  const { nodes, incoming } = graphIndex(document);
  orderedAncestors([...nodes.keys()], incoming, false);
  const groupIds = new Set<string>();
  const members = new Set<string>();
  for (const group of document.groups ?? []) {
    if (groupIds.has(group.id)) throw new Error('Duplicate group');
    groupIds.add(group.id);
    for (const id of group.nodeIds) {
      if (!nodes.has(id) || members.has(id)) throw new Error('Invalid group membership');
      members.add(id);
    }
  }
}

/** Explicit replay targets in dependency order; never implicitly schedules an ancestor. */
export function thoughtReplayOrder(document: ThoughtDocument, targetIds: string[]): string[] {
  const { nodes, incoming } = graphIndex(document);
  orderedAncestors([...nodes.keys()], incoming, false);
  for (const id of targetIds) if (!nodes.has(id)) throw new Error(`Unknown replay target: ${id}`);
  const selected = new Set(targetIds);
  return orderedAncestors(targetIds, incoming, false).filter(id => {
    const node = nodes.get(id)!;
    return selected.has(id) && !node.archived && node.kind === 'question';
  });
}

function response(node: ThoughtNode): string {
  if (node.highlightMode === 'filter' && node.highlights.length) return node.highlights.join('\n\n');
  if (node.highlightMode === 'tag' && node.highlights.length) {
    return `${node.answer}\n[Highlighted passages]\n${node.highlights.join('\n\n')}`;
  }
  return node.answer;
}

export async function compileThoughtContext(document: ThoughtDocument, targetId: string): Promise<CompiledThoughtContext> {
  const { nodes, incoming } = graphIndex(document);
  orderedAncestors([...nodes.keys()], incoming, false);
  const target = nodes.get(targetId);
  if (!target) throw new Error('Unknown target node');
  const mainIds = orderedAncestors([targetId], incoming, true);
  const mainSet = new Set(mainIds);
  const messages: CompiledThoughtContext['messages'] = [];
  const materials: CompiledThoughtContext['materials'] = [];
  const excluded = new Set(mainIds.flatMap(id => nodes.get(id)!.excludedMaterialIds));
  // Keep original text strings as keys instead of allocating a JSON-escaped
  // copy for every inherited reference to a potentially large material.
  const materialDigests = new Map<string, Map<number | undefined, Set<string>>>();
  const pushMaterials = (node: ThoughtNode) => {
    for (const material of node.materials) {
      if (excluded.has(material.id)) continue;
      // Extraction revisions also matter when a blob has not changed.
      let pages = materialDigests.get(material.digest);
      if (!pages) { pages = new Map(); materialDigests.set(material.digest, pages); }
      let texts = pages.get(material.page);
      if (!texts) { texts = new Set(); pages.set(material.page, texts); }
      if (texts.has(material.text)) continue;
      texts.add(material.text); materials.push(material);
      messages.push({ role: 'user', content: `[Material: ${material.name}${material.page === undefined ? '' : `, page ${material.page}`} ]\n${material.text}`, nodeId: node.id, materialId: material.id });
    }
  };
  if (target.role) messages.push({ role: 'system', content: target.role, nodeId: target.id });
  for (const id of mainIds) {
    const node = nodes.get(id)!;
    if (node.archived) continue;
    pushMaterials(node);
    if (node.kind === 'note' || node.kind === 'material') messages.push({ role: 'user', content: `[${node.kind}]\n${node.question}`, nodeId: id });
  }
  const seenReferences = new Set<string>();
  const references = new Map<string, ThoughtEdge>();
  for (const id of mainIds) {
    for (const edge of incoming.get(id) ?? []) {
      if (edge.kind !== 'reference' || nodes.get(id)!.archived || mainSet.has(edge.source)) continue;
      // Keep first-appearance ordering but upgrade to the widest explicitly selected depth.
      if (!references.has(edge.source) || edge.depth === 'full') references.set(edge.source, edge);
    }
  }
  for (const edge of references.values()) {
    const referenceIds = edge.depth === 'full' ? orderedAncestors([edge.source], incoming, true) : [edge.source];
    for (const refId of referenceIds) {
      const ref = nodes.get(refId)!;
      if (ref.archived || mainSet.has(refId) || seenReferences.has(refId)) continue;
      seenReferences.add(refId);
      pushMaterials(ref);
      if (ref.source) messages.push({ role: 'user', content: `[Source]\n${canonicalJson(ref.source)}`, nodeId: refId });
      messages.push({ role: 'user', content: `[Reference]\nQ: ${ref.question}\nA: ${response(ref)}`, nodeId: refId });
    }
  }
  for (const id of mainIds) {
    const node = nodes.get(id)!;
    if (node.archived || node.kind === 'note' || node.kind === 'material') continue;
    if (node.kind === 'result' && node.source) messages.push({ role: 'user', content: `[Source]\n${canonicalJson(node.source)}`, nodeId: id });
    if (node.question) messages.push({ role: 'user', content: node.question, nodeId: id });
    if (id !== targetId && node.answer) messages.push({ role: 'assistant', content: response(node), nodeId: id });
  }
  const systemPrompt = target.mode === 'question' ? ['Answer using the supplied conversation and materials. No tools are available.', target.role].filter(Boolean).join('\n\n') : '';
  const prompt = target.mode === 'question' ? target.question : messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n');
  const input = { messages, materials, prompt, systemPrompt, mode: target.mode, model: target.model, llmConnection: target.llmConnection, projectId: document.projectId };
  return { documentId: document.id, revision: document.revision, targetId, ...input, hash: await contentHash(input) };
}

export async function isThoughtStale(document: ThoughtDocument, nodeId: string): Promise<boolean> {
  const node = document.nodes.find(n => n.id === nodeId);
  const version = node?.versions.find(v => v.id === node.activeVersionId);
  return !!version && version.contextHash !== (await compileThoughtContext(document, nodeId)).hash;
}
