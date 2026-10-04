/** Browser-safe canonical plan helpers shared by authoring, validation and runtime. */
import { extractRefs } from './refs.ts';
import type { TaskSpec } from './schema.ts';

export interface DependencyNode {
  id: string;
  depends_on?: string[];
  prompt?: string;
  inputs?: Record<string, string | { from: string }>;
  actor?: { id: string; persona?: string };
}

/** Authored edges remain untouched; a data reference always also imposes ordering. */
export function effectiveNodeDeps(node: DependencyNode, nodes?: readonly DependencyNode[]): string[] {
  const deps = new Set(node.depends_on ?? []);
  const texts = [node.prompt ?? '', ...Object.values(node.inputs ?? {}).map(input => typeof input === 'string' ? input : input.from)];
  for (const text of texts) for (const ref of extractRefs(text)) if (ref.kind === 'node') deps.add(ref.nodeId);
  if (node.actor && nodes) {
    const index = nodes.findIndex(candidate => candidate.id === node.id);
    const previous = nodes.slice(0, index).findLast(candidate => candidate.actor?.id === node.actor!.id);
    if (previous) deps.add(previous.id);
  }
  return [...deps];
}

export function planDependencies(spec: { nodes: DependencyNode[] }): Map<string, Set<string>> {
  const ids = new Set(spec.nodes.map(node => node.id));
  return new Map(spec.nodes.map(node => [node.id, new Set(effectiveNodeDeps(node, spec.nodes).filter(id => id !== node.id && ids.has(id)))]));
}

/** Order-independent object comparison; array order remains part of the authored contract. */
export function planValueKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item) ?? 'undefined';
}

/** Locks can only be changed by explicit manual editing, never AI or a running patch. */
export function planProtectionErrors(from: Pick<TaskSpec, 'nodes' | 'locked_fields' | 'constraints' | 'decisions' | 'goal' | 'acceptance_criteria'>, to: typeof from): string[] {
  const errors: string[] = [];
  const next = new Map(to.nodes.map(node => [node.id, node]));
  for (const node of from.nodes) {
    const following = next.get(node.id);
    // The form omits default session kind; compare the same canonical node as schema parsing.
    if (node.locked && planValueKey({ ...node, kind: node.kind ?? 'session' }) !== planValueKey(following && { ...following, kind: following.kind ?? 'session' })) errors.push(`Locked node "${node.id}" cannot be changed or removed; unlock it manually first.`);
  }
  if (planValueKey(from.locked_fields ?? []) !== planValueKey(to.locked_fields ?? [])) errors.push('Plan locks cannot be changed by a proposal or runtime patch.');
  for (const field of from.locked_fields ?? []) {
    if (planValueKey(from[field]) !== planValueKey(to[field])) errors.push(`Locked field "${field}" cannot be changed; unlock it manually first.`);
  }
  return errors;
}
