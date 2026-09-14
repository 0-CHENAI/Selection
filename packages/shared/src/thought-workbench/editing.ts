import type { ThoughtDocument } from './types.ts';
import { newThoughtNode } from './types.ts';
import { validateThoughtGraph } from './context.ts';

/** Deterministic layered layout in O(V + E), independent of model input fields. */
export function layoutThoughtGraph(document: ThoughtDocument): ThoughtDocument {
  validateThoughtGraph(document);
  const degrees = new Map(document.nodes.map(node => [node.id, 0]));
  const children = new Map<string, string[]>();
  const layers = new Map(document.nodes.map(node => [node.id, 0]));
  for (const edge of document.edges) {
    degrees.set(edge.target, degrees.get(edge.target)! + 1);
    const outgoing = children.get(edge.source);
    if (outgoing) outgoing.push(edge.target); else children.set(edge.source, [edge.target]);
  }
  const queue = document.nodes.filter(node => !degrees.get(node.id)).map(node => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const child of children.get(id) ?? []) {
      layers.set(child, Math.max(layers.get(child)!, layers.get(id)! + 1));
      degrees.set(child, degrees.get(child)! - 1);
      if (!degrees.get(child)) queue.push(child);
    }
  }
  const rows = new Map<number, number>();
  return { ...document, nodes: document.nodes.map(node => {
    const layer = layers.get(node.id)!;
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return { ...node, position: { x: layer * 320, y: row * 180 } };
  }) };
}

/** All upstream paths, including explicit references, without recursive stack growth. */
export function thoughtUpstreamPath(document: ThoughtDocument, nodeIds: string[]): Set<string> {
  const incoming = new Map<string, string[]>();
  const known = new Set(document.nodes.map(node => node.id));
  for (const edge of document.edges) {
    const parents = incoming.get(edge.target);
    if (parents) parents.push(edge.source); else incoming.set(edge.target, [edge.source]);
  }
  const path = new Set<string>();
  const queue = [...nodeIds];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    if (!known.has(id) || path.has(id)) continue;
    path.add(id);
    queue.push(...(incoming.get(id) ?? []));
  }
  return path;
}

/** Undo graph authoring, not completed executions or task/proposal transactions. */
export function restoreThoughtEdit(current: ThoughtDocument, snapshot: ThoughtDocument): ThoughtDocument {
  if (current.id !== snapshot.id) throw new Error('Cannot undo another workbench');
  const latest = new Map(current.nodes.map(node => [node.id, node]));
  const restored = new Set(snapshot.nodes.map(node => node.id));
  const nodes = snapshot.nodes.map(node => {
    const now = latest.get(node.id);
    if (!now) return node;
    const known = new Set(node.versions.map(version => version.id));
    const added = now.versions.filter(version => !known.has(version.id));
    // Authoritative versions win if an old snapshot happens to contain the same ID.
    const versions = new Map(node.versions.map(version => [version.id, version]));
    for (const version of now.versions) versions.set(version.id, version);
    const retainAnswer = added.some(version => version.id === now.activeVersionId);
    return { ...node, versions: [...versions.values()],
      ...(retainAnswer ? { answer: now.answer, activeVersionId: now.activeVersionId } : {}) };
  });
  // An undo of node creation must not pretend that already executed tools were undone.
  // Keep its receipts accessible as an archived, disconnected node.
  for (const node of current.nodes) {
    if (!restored.has(node.id) && (node.versions.length || node.source)) nodes.push({ ...node, archived: true });
  }
  return { ...current, title: snapshot.title, nodes, edges: snapshot.edges, groups: snapshot.groups };
}

export function thoughtGroupBounds(document: ThoughtDocument, nodeIds: string[]) {
  const members = new Set(nodeIds);
  const nodes = document.nodes.filter(node => members.has(node.id));
  if (!nodes.length) return { x: 0, y: 0, width: 280, height: 100 };
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    x = Math.min(x, node.position.x); y = Math.min(y, node.position.y);
    right = Math.max(right, node.position.x + 240); bottom = Math.max(bottom, node.position.y + 100);
  }
  return { x: x - 24, y: y - 44, width: right - x + 48, height: bottom - y + 68 };
}

export function groupThoughtNodes(document: ThoughtDocument, nodeIds: string[], id: string, title: string): ThoughtDocument {
  const members = new Set(nodeIds);
  if (!members.size || [...members].some(id => !document.nodes.some(node => node.id === id))) throw new Error('Select nodes to group');
  const groups = (document.groups ?? []).map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !members.has(id)) })).filter(group => group.nodeIds.length);
  const next = { ...document, groups: [...groups, { id, title, nodeIds: [...members], collapsed: false }] };
  validateThoughtGraph(next);
  return next;
}

/** Summary is an explicit no-tool question with traceable references, never a destructive rewrite. */
export function addThoughtSummary(document: ThoughtDocument, nodeIds: string[], id: string, title: string, question: string): ThoughtDocument {
  const sources = [...new Set(nodeIds)];
  if (!sources.length || sources.some(id => !document.nodes.some(node => node.id === id))) throw new Error('Select summary sources');
  const bounds = thoughtGroupBounds(document, sources);
  const node = { ...newThoughtNode(id, { x: bounds.x + bounds.width + 60, y: bounds.y + 44 }), title, question };
  const next = { ...document, nodes: [...document.nodes, node], edges: [...document.edges, ...sources.map((source, order) => ({
    id: `${id}-${order}`, source, target: id, kind: 'reference' as const, depth: 'full' as const, order,
  }))] };
  validateThoughtGraph(next);
  return next;
}
