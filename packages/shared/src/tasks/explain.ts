/** Browser-safe views of the canonical plan; never a scheduler or an editable graph. */
import { effectiveNodeDeps, planValueKey, type DependencyNode } from './plan.ts';
import { extractRefs } from './refs.ts';
import type { ResearchSummary } from './research.ts';

export const TASK_VIEWS = ['task', 'data', 'control', 'actor', 'research'] as const;
export type TaskView = typeof TASK_VIEWS[number];
export interface ExplainNode extends DependencyNode {
  title?: string; kind?: string; permissionMode?: string; researchRole?: string;
  when?: unknown; loop?: unknown; for_each?: string; approval?: boolean;
  route?: { cases?: Array<{ goto: string; when: unknown }>; default: string };
  outputs?: Array<{ name?: string; kind?: string; type?: string }>;
}
export interface ExplainSpec { nodes: ExplainNode[]; defaults?: { permissionMode?: string }; research?: unknown }
export interface ExplainGraph { nodes: Array<{ id: string; title: string; kind: string }>; edges: Array<{ source: string; target: string; label?: string }> }
export function projectTaskView(spec: ExplainSpec, view: TaskView, research?: ResearchSummary): ExplainGraph {
  const nodes = spec.nodes.map(node => ({ id: node.id, title: node.title ?? node.id, kind: node.kind ?? 'session' }));
  const edges: ExplainGraph['edges'] = [];
  const edge = (source: string, target: string, label?: string) => {
    if (source !== target && !edges.some(item => item.source === source && item.target === target && item.label === label)) edges.push({ source, target, label });
  };
  for (const node of spec.nodes) {
    if (view === 'task') effectiveNodeDeps(node, spec.nodes).forEach(dep => edge(dep, node.id));
    if (view === 'data') for (const binding of [node.prompt ?? '', ...Object.values(node.inputs ?? {}).map(input => typeof input === 'string' ? input : input.from)]) {
      for (const ref of extractRefs(binding)) if (ref.kind === 'node') edge(ref.nodeId, node.id, ref.field ?? 'output');
    }
    if (view === 'control') {
      (node.depends_on ?? []).forEach(dep => edge(dep, node.id, node.when ? JSON.stringify(node.when) : undefined));
      node.route?.cases?.forEach(item => edge(node.id, item.goto, JSON.stringify(item.when)));
      if (node.route) edge(node.id, node.route.default, 'default');
    }
    if (view === 'actor' && node.actor) {
      nodes.find(item => item.id === node.id)!.title = `${node.actor.id} · ${node.title ?? node.id}`;
      const previous = spec.nodes.slice(0, spec.nodes.indexOf(node)).reverse().find(item => item.actor?.id === node.actor!.id);
      if (previous) edge(previous.id, node.id, node.actor.id);
    }
    if (view === 'research' && node.researchRole) nodes.find(item => item.id === node.id)!.title = `${node.title ?? node.id} · ${node.researchRole}`;
  }
  if (view === 'research' && research) {
    research.sources.forEach(source => nodes.push({ id: `source:${source.id}@${source.version}`, title: source.ref, kind: 'source' }));
    research.claims.forEach(claim => {
      const id = `claim:${claim.id}@${claim.version}`;
      nodes.push({ id, title: claim.text, kind: 'claim' });
      if (nodes.some(node => node.id === claim.producedBy.nodeId)) edge(claim.producedBy.nodeId, id, 'claim');
      for (const evidenceId of claim.evidenceIds) {
        const evidence = research.records.flatMap(record => record.payload.evidence).find(item => item.id === evidenceId);
        if (evidence) edge(`source:${evidence.sourceId}@${evidence.sourceVersion}`, id, evidenceId);
      }
      if (claim.reviewer && nodes.some(node => node.id === claim.reviewer!.nodeId)) edge(id, claim.reviewer.nodeId, claim.review?.support);
      if (research.report?.claimRefs.some(ref => ref.id === claim.id && ref.version === claim.version)) edge(id, research.report.producedBy.nodeId, 'report');
    });
  }
  const ids = new Set(nodes.map(node => node.id));
  return { nodes, edges: edges.filter(item => ids.has(item.source) && ids.has(item.target)) };
}
export function explainPreflight(spec: ExplainSpec) {
  return {
    frontier: spec.nodes.filter(node => !effectiveNodeDeps(node, spec.nodes).length).map(node => ({ id: node.id,
      conditional: node.when !== undefined || node.for_each !== undefined || node.loop !== undefined })),
    permissions: spec.nodes.map(node => ({ id: node.id, mode: node.permissionMode ?? spec.defaults?.permissionMode ?? 'safe',
      capabilities: (node.permissionMode ?? spec.defaults?.permissionMode ?? 'safe') === 'safe' ? 'read-only' : 'writes-require-runtime-policy',
      approval: node.approval === true || node.kind === 'approval' })),
    unknown: spec.nodes.filter(node => node.route || node.when || node.loop || node.for_each).map(node => node.id),
    note: 'Static frontier and permission capabilities only. Runtime conditions, dynamic instances, actual effects and external service availability are not predicted.',
  };
}
/** Includes downstream nodes whose input/order can change, even when their definitions are unchanged. */
export function revisionImpact(before: ExplainSpec, after: ExplainSpec, cancelled: string[] = []) {
  const added = after.nodes.filter(node => !before.nodes.some(old => old.id === node.id)).map(node => node.id);
  const changed = after.nodes.filter(node => before.nodes.some(old => old.id === node.id && planValueKey(old) !== planValueKey(node))).map(node => node.id);
  const removed = before.nodes.filter(node => !after.nodes.some(next => next.id === node.id)).map(node => node.id);
  const affected = new Set([...added, ...changed, ...removed, ...cancelled]);
  for (let grew = true; grew;) { grew = false; for (const spec of [before, after]) for (const node of spec.nodes) if (!affected.has(node.id) && effectiveNodeDeps(node, spec.nodes).some(dep => affected.has(dep))) { affected.add(node.id); grew = true; } }
  return { added, changed, removed, cancelled, affected: [...affected], unaffected: after.nodes.filter(node => !affected.has(node.id)).map(node => node.id) };
}
