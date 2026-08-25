/**
 * Kind registry for the v2 Conductor. ActiveRun dispatches through these
 * classifiers; each executor still lives next to the scheduler so we do not
 * invent a framework before the kinds exist.
 */
import type { NodeKind, TaskNode } from '@craft-agent/shared/tasks';

export const V2_IMPLEMENTED_KINDS = new Set<NodeKind>([
  'session',
  'orchestrator',
  'parallel',
  'route',
  'approval',
  'finally',
]);

export const MAX_RUN_INSTANCES = 256;

export function isSessionLikeKind(kind: NodeKind | undefined): boolean {
  return kind === 'session' || kind === 'orchestrator' || kind === 'finally';
}

export function isControlKind(kind: NodeKind | undefined): boolean {
  return kind === 'parallel' || kind === 'route';
}

export function unimplementedV2Nodes(nodes: readonly TaskNode[]): TaskNode[] {
  return nodes.filter((n) => !V2_IMPLEMENTED_KINDS.has(n.kind));
}
