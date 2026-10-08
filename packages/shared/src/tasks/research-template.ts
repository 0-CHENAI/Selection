/** Browser-safe optional native research template, using the existing task runner. */
import type { TaskSpec, TaskNode } from './schema.ts';
import type { ResearchConfig, ResearchRole } from './research.ts';
export * from './research.ts';

export function addResearchTemplate(spec: TaskSpec, config: ResearchConfig): TaskSpec {
  if (spec.nodes.some(node => node.researchRole)) return { ...spec, research: { ...config, assuranceVersion: spec.research?.assuranceVersion ?? config.assuranceVersion } };
  const nodes = spec.nodes.filter(node => node.prompt?.trim() || node.outputs?.length || node.kind !== 'session');
  const taken = new Set(nodes.map(node => node.id));
  const allocate = (name: string) => { let id = name, suffix = 2; while (taken.has(id)) id = `${name}-${suffix++}`; taken.add(id); return id; };
  const research = allocate('research'), review = allocate('review'), report = allocate('research-report');
  const makeNode = (id: string, role: ResearchRole, depends: string[], prompt: string): TaskNode => ({ id, kind: 'session', researchRole: role,
    depends_on: depends, prompt, cache: 'none', outputs: [{ name: 'research', kind: 'param', type: 'json', required: true }] });
  return { ...spec, schema_version: 3, runner: 'orchestrate', research: { ...config, assuranceVersion: 2, judgmentVersion: 1 },
    nodes: [...nodes,
      makeNode(research, 'researcher', nodes.map(node => node.id), 'Read the original frozen sources. Address the research dimensions and premises. Submit evidence and versioned claims with explicit falsificationConditions in values.research. Record missing evidence honestly. Do not certify your own claims.'),
      makeNode(review, 'reviewer', [research], 'Independently read the necessary original source snapshots. Review the exact current claim versions for citation existence, semantic support and source limits. Submit premiseReviews covering every important exact claim version; include changeEvidence and classification. Fact errors and evidence gaps require original-line repair. Only a genuinely different premise creates an explicit branchCandidate for the coordinator to open or decline. Record important issues and dispositions; defer corrections so the coordinator can add canonical correction and fresh-review tasks before the report.'),
      makeNode(report, 'reporter', [review], 'Produce values.research.report referencing only current independently reviewed supported claims. Include all critical numbers and recommendations, coverage limits and unresolved issues. The host renders the visible report from these same versions. Never reuse an old review for a corrected version.')],
    outputs: { ...spec.outputs, research_report: '${nodes.' + report + '.output}' } };
}
