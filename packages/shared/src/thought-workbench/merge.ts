import { compileThoughtContext, thoughtReplayOrder, validateThoughtGraph } from './context.ts';
import type { ThoughtDocument } from './types.ts';

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => equal(left[key], right[key]));
}

function merge(base: unknown, local: unknown, remote: unknown, path: string): unknown {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  const keyed = (value: unknown): value is Array<{ id: string }> => Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.id === 'string');
  if (keyed(base) && keyed(local) && keyed(remote)) {
    const maps = [base, local, remote].map(items => new Map(items.map(item => [item.id, item])));
    return [...new Set([...local, ...remote].map(item => item.id))].flatMap(id => {
      const value = merge(maps[0]!.get(id), maps[1]!.get(id), maps[2]!.get(id), `${path}/${id}`);
      return value === undefined ? [] : [value];
    });
  }
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (record(base) && record(local) && record(remote)) {
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].map(key => [key, merge(base[key], local[key], remote[key], `${path}/${key}`)]));
  }
  throw new Error(`Workbench edit conflict: ${path}`);
}

/** Merge only independent edits. Same-field changes and delete/edit races require
 * user resolution; never silently replace another editor's graph or task link. */
export async function mergeThoughtDocuments(base: ThoughtDocument, local: ThoughtDocument, remote: ThoughtDocument): Promise<ThoughtDocument> {
  if (base.id !== local.id || base.id !== remote.id || remote.revision < base.revision) throw new Error('Workbench merge baseline mismatch');
  const normalizedLocal = { ...local, revision: base.revision, updatedAt: base.updatedAt };
  const normalizedRemote = { ...remote, revision: base.revision, updatedAt: base.updatedAt };
  let result = { ...merge(base, normalizedLocal, normalizedRemote, '') as ThoughtDocument, revision: remote.revision, updatedAt: remote.updatedAt };
  validateThoughtGraph(result);
  // Evaluate upstream first: an invalid newly delivered ancestor answer must not
  // make a descendant's old input appear current during the same reconciliation.
  const order = thoughtReplayOrder(result, result.nodes.filter(node => node.kind === 'question' && !node.archived).map(node => node.id));
  for (const id of order) {
    const node = result.nodes.find(item => item.id === id)!;
    const prior = local.nodes.find(item => item.id === id);
    const version = node.versions.find(item => item.id === node.activeVersionId);
    if (!prior || !version || prior.versions.some(item => item.id === version.id)) continue;
    if ((await compileThoughtContext(result, id)).hash !== version.contextHash) {
      result = { ...result, nodes: result.nodes.map(item => item.id === id ? { ...item, answer: prior.answer, activeVersionId: prior.activeVersionId } : item) };
    }
  }
  return result;
}
