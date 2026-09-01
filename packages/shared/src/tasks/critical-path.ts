import { nodeDeps, type TaskNode, type TaskSpec } from './schema.ts';

const TERMINAL = new Set(['done', 'skipped', 'failed', 'invalid', 'cancelled']);

/**
 * Remaining critical-path length for each definition node.
 * Finished nodes are 0. Pending/ready nodes are 1 + max(downstream remaining).
 */
export function criticalPathRemaining(
  spec: TaskSpec,
  states: ReadonlyMap<string, { state: string }>,
): Map<string, number> {
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();

  const dependents = new Map<string, string[]>();
  for (const node of spec.nodes) dependents.set(node.id, []);
  for (const node of spec.nodes) {
    for (const dep of nodeDeps(node)) {
      dependents.get(dep)?.push(node.id);
    }
  }

  const visit = (id: string): number => {
    const cached = ranks.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const state = states.get(id)?.state;
    if (state && TERMINAL.has(state)) {
      ranks.set(id, 0);
      visiting.delete(id);
      return 0;
    }
    let maxDown = 0;
    for (const child of dependents.get(id) ?? []) {
      maxDown = Math.max(maxDown, visit(child));
    }
    const rank = 1 + maxDown;
    ranks.set(id, rank);
    visiting.delete(id);
    return rank;
  };

  for (const node of spec.nodes) visit(node.id);
  return ranks;
}

/** Critical-path first, then original definition order. */
export function sortReadyByCriticalPath(nodes: TaskNode[], spec: TaskSpec, ranks: Map<string, number>): TaskNode[] {
  const order = new Map(spec.nodes.map((node, index) => [node.id, index]));
  return [...nodes].sort((a, b) => {
    const diff = (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0);
    if (diff !== 0) return diff;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}
