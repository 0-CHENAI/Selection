import { canonicalJson } from './context.ts';

export interface WorkbenchFieldChange { path: string; before?: unknown; after?: unknown; nodeId?: string }

/** Compare every field; execution nodes are keyed by identity instead of unstable array indexes. */
export function diffWorkbenchDefinitions(before: unknown, after: unknown): WorkbenchFieldChange[] {
  const changes: WorkbenchFieldChange[] = [];
  function visit(left: unknown, right: unknown, path: string, nodeId?: string): void {
    if (canonicalJson(left) === canonicalJson(right)) return;
    if (path === '/nodes' && Array.isArray(left) && Array.isArray(right)) {
      const nodeMap = (nodes: unknown[]) => new Map(nodes.map(node => {
        const record = node as { id: string }; return [record.id, record] as const;
      }));
      const a = nodeMap(left), b = nodeMap(right);
      for (const id of new Set([...a.keys(), ...b.keys()])) visit(a.get(id), b.get(id), `${path}/${id}`, id);
      const aIds = left.map(node => (node as { id: string }).id), bIds = right.map(node => (node as { id: string }).id);
      if (aIds.length === bIds.length && aIds.every(id => b.has(id)) && canonicalJson(aIds) !== canonicalJson(bIds)) changes.push({ path: '/nodes/order', before: aIds, after: bIds });
      return;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit(a[key], b[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, nodeId);
      return;
    }
    changes.push({ path: path || '/', before: left, after: right, nodeId });
  }
  visit(before, after, '');
  return changes;
}
