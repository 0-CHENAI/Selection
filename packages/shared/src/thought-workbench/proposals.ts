import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { compileThoughtContext } from './context.ts';
import { diffWorkbenchDefinitions } from './diff.ts';
import { loadThoughtDocument, saveThoughtDocument, readWorkbenchRecord, writeWorkbenchRecord, listWorkbenchRecords } from './storage.ts';
import { loadTaskDocument, parseTaskDocument } from '../tasks/document.ts';
import type { ThoughtDocument, WorkbenchProposal, WorkbenchProposalBaseline } from './types.ts';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const WorkbenchProposalBaselineSchema = z.object({
  documentId: identifier, documentRevision: z.number().int().positive(),
  executionHash: z.string().regex(/^[a-f0-9]{64}$/), taskEtag: z.string().optional(), nodeIds: z.array(identifier),
}).strict();
export const WorkbenchProposalSchema = z.object({ id: identifier, baseline: WorkbenchProposalBaselineSchema, goal: z.string(), context: z.string(),
  currentYaml: z.string(), createdAt: z.string(), sessionId: identifier.optional(),
  status: z.enum(['generating', 'ready', 'failed', 'applied', 'discarded']), yaml: z.string().optional(), error: z.string().optional(),
  appliedRevision: z.number().int().positive().optional(),
  executionNodeIds: z.array(identifier).optional(),
}).strict();
const schema = WorkbenchProposalSchema;

// Match the browser-safe contentHash(string) canonical representation.
export const executionDraftHash = (yaml: string): string => createHash('sha256').update(JSON.stringify(yaml)).digest('hex');

/** Checked synchronously immediately before each state transition, not only in the renderer. */
export function assertProposalBaseline(root: string, input: WorkbenchProposalBaseline): ThoughtDocument {
  const baseline = WorkbenchProposalBaselineSchema.parse(input);
  const document = loadThoughtDocument(root, baseline.documentId);
  if (!document || document.revision !== baseline.documentRevision || executionDraftHash(document.executionYaml ?? '') !== baseline.executionHash || document.taskEtag !== baseline.taskEtag) {
    throw new Error('Workbench proposal baseline changed; regenerate the proposal');
  }
  if (document.taskSlug) {
    identifier.parse(document.taskSlug);
    const task = loadTaskDocument(root, document.taskSlug);
    if (!task || task.etag !== baseline.taskEtag) throw new Error('Task definition changed; reload before proposing');
  }
  if (new Set(baseline.nodeIds).size !== baseline.nodeIds.length || baseline.nodeIds.some(id => !document.nodes.some(n => n.id === id))) throw new Error('Invalid proposal source nodes');
  return document;
}

export function getWorkbenchProposal(root: string, documentId: string, proposalId: string): WorkbenchProposal {
  const proposal = schema.parse(readWorkbenchRecord(root, documentId, 'proposal', proposalId));
  if (proposal.id !== proposalId || proposal.baseline.documentId !== documentId) throw new Error('Proposal identity mismatch');
  return proposal;
}

export function listWorkbenchProposals(root: string, documentId: string): WorkbenchProposal[] {
  return listWorkbenchRecords(root, documentId, 'proposal').map(record => {
    const proposal = schema.parse(record);
    if (proposal.baseline.documentId !== documentId) throw new Error('Proposal identity mismatch');
    return proposal;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Historical context receipts, not a claim that later manual edits are derived
 * from those thoughts. Retain all applied rounds, including deleted thought IDs. */
export function executionNodeSources(root: string, documentId: string, nodeId: string): Array<{ proposalId: string; appliedRevision: number; thoughtNodeIds: string[] }> {
  identifier.parse(nodeId);
  if (!loadThoughtDocument(root, documentId)) throw new Error('Unknown workbench');
  return listWorkbenchProposals(root, documentId).flatMap(proposal =>
    proposal.status === 'applied' && proposal.appliedRevision !== undefined && proposal.executionNodeIds?.includes(nodeId)
      ? [{ proposalId: proposal.id, appliedRevision: proposal.appliedRevision, thoughtNodeIds: [...new Set(proposal.baseline.nodeIds)] }]
      : []);
}

export async function beginWorkbenchProposal(root: string, baseline: WorkbenchProposalBaseline, goal: string, currentYaml: string): Promise<WorkbenchProposal> {
  const document = assertProposalBaseline(root, baseline);
  if (currentYaml !== (document.executionYaml ?? '')) throw new Error('Proposal must include the latest complete execution draft');
  const contexts: string[] = [];
  for (const id of baseline.nodeIds) {
    const compiled = await compileThoughtContext(document, id);
    const node = document.nodes.find(node => node.id === id)!;
    contexts.push(`[Selected thought node ${id}]\n${compiled.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n')}${node.answer ? `\n[assistant]\n${node.answer}` : ''}`);
  }
  // Revalidate after asynchronous hashing. A concurrent editor must not attach a proposal to old input.
  assertProposalBaseline(root, baseline);
  const proposal: WorkbenchProposal = { id: randomUUID(), baseline, goal, currentYaml, context: contexts.join('\n\n'), status: 'generating', createdAt: new Date().toISOString() };
  writeWorkbenchRecord(root, document.id, 'proposal', proposal.id, proposal);
  return proposal;
}

export function finishWorkbenchProposal(root: string, documentId: string, proposalId: string, result: { yaml?: string; error?: string; sessionId?: string }): WorkbenchProposal {
  const proposal = getWorkbenchProposal(root, documentId, proposalId);
  // Cancellation/discard is terminal; late model events cannot resurrect the proposal.
  if (proposal.status !== 'generating') return proposal;
  let error = result.error;
  let executionNodeIds: string[] | undefined;
  if (!error) {
    const parsed = parseTaskDocument(result.yaml ?? '');
    if (!parsed.valid || !parsed.spec || parsed.sourceVersion !== 3) error = 'Proposal must be a valid V3 definition';
    const document = loadThoughtDocument(root, documentId);
    if (document?.taskSlug && parsed.spec?.id !== document.taskSlug) error = 'Proposal cannot change the saved task identity';
    if (!error && parsed.spec) {
      const before = parseTaskDocument(proposal.currentYaml);
      const after = parsed.spec as unknown as { nodes: Array<{ id: string }> };
      const existing = new Set(after.nodes.map(node => node.id));
      executionNodeIds = before.valid && before.spec
        ? [...new Set(diffWorkbenchDefinitions(before.spec, parsed.spec).flatMap(change => change.nodeId && existing.has(change.nodeId) ? [change.nodeId] : []))]
        : [...existing];
    }
  }
  const next: WorkbenchProposal = { ...proposal, ...result, executionNodeIds, error, status: error ? 'failed' : 'ready' };
  writeWorkbenchRecord(root, documentId, 'proposal', proposalId, schema.parse(next));
  return next;
}

export function discardWorkbenchProposal(root: string, documentId: string, proposalId: string): WorkbenchProposal {
  const proposal = getWorkbenchProposal(root, documentId, proposalId);
  if (proposal.status === 'applied') throw new Error('An applied proposal cannot be discarded');
  const next: WorkbenchProposal = { ...proposal, status: 'discarded' };
  writeWorkbenchRecord(root, documentId, 'proposal', proposalId, next);
  return next;
}

/** Applies only to the next-run draft. Never calls TaskRunner or writes task.yaml. */
export function applyWorkbenchProposal(root: string, documentId: string, proposalId: string): { document: ThoughtDocument; proposal: WorkbenchProposal } {
  const proposal = getWorkbenchProposal(root, documentId, proposalId);
  const current = loadThoughtDocument(root, documentId);
  // Repair a process crash between the atomic document commit and its history acknowledgement.
  if (current && (proposal.status === 'applied' || current.lastAppliedProposalId === proposalId)) {
    const repaired: WorkbenchProposal = { ...proposal, status: 'applied', appliedRevision: proposal.baseline.documentRevision + 1 };
    if (proposal.status !== 'applied') writeWorkbenchRecord(root, documentId, 'proposal', proposalId, repaired);
    return { document: current, proposal: repaired };
  }
  if (proposal.status !== 'ready' || !proposal.yaml) throw new Error('Proposal is not ready to apply');
  const document = assertProposalBaseline(root, proposal.baseline);
  const parsed = parseTaskDocument(proposal.yaml);
  if (!parsed.valid || !parsed.spec || parsed.sourceVersion !== 3 || (document.taskSlug && parsed.spec.id !== document.taskSlug)) throw new Error('Invalid execution proposal');
  const saved = saveThoughtDocument(root, { ...document, title: parsed.spec.title, projectId: parsed.spec.project, executionYaml: proposal.yaml, lastAppliedProposalId: proposalId }, document.revision);
  const next: WorkbenchProposal = { ...proposal, status: 'applied', appliedRevision: saved.revision };
  writeWorkbenchRecord(root, documentId, 'proposal', proposalId, next);
  return { document: saved, proposal: next };
}
