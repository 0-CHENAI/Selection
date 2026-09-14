import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newThoughtDocument, newThoughtNode, type ThoughtDocument, type WorkbenchProposalBaseline } from './types.ts';
import { saveThoughtDocument, loadThoughtDocument, writeWorkbenchRecord } from './storage.ts';
import { beginWorkbenchProposal, finishWorkbenchProposal, applyWorkbenchProposal, discardWorkbenchProposal, listWorkbenchProposals, executionDraftHash } from './proposals.ts';
import { loadTaskDocument } from '../tasks/document.ts';
import { executionNodeSources } from './proposals';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const yaml = (title = 'Original') => `schema_version: 3\nid: workflow\ntitle: ${title}\ngoal: Review\nnodes:\n  - id: review\n    kind: approval\n`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thought-proposals-')); roots.push(root);
  const document = saveThoughtDocument(root, { ...newThoughtDocument('draft'), executionYaml: yaml(), nodes: [{ ...newThoughtNode('thought'), question: 'Question', answer: 'Answer with sources' }] }, 0);
  return { root, document };
}
function baseline(document: ThoughtDocument): WorkbenchProposalBaseline {
  return { documentId: document.id, documentRevision: document.revision, executionHash: executionDraftHash(document.executionYaml ?? ''), taskEtag: document.taskEtag, nodeIds: ['thought'] };
}

it('synchronizes the selected project when applying an execution proposal', async () => {
  const f = fixture();
  const proposal = await beginWorkbenchProposal(f.root, baseline(f.document), 'Change project', f.document.executionYaml!);
  finishWorkbenchProposal(f.root, f.document.id, proposal.id, { yaml: yaml() + 'project: project-b\n' });
  const applied = applyWorkbenchProposal(f.root, f.document.id, proposal.id).document;
  expect(applied.projectId).toBe('project-b');
  const remove = await beginWorkbenchProposal(f.root, baseline(applied), 'Remove project', applied.executionYaml!);
  finishWorkbenchProposal(f.root, applied.id, remove.id, { yaml: yaml() });
  expect(applyWorkbenchProposal(f.root, applied.id, remove.id).document.projectId).toBeUndefined();
  expect(readdirSync(f.root)).toEqual(['thought-workbenches']);
});

it('retains three authoring rounds while each apply changes only the execution draft', async () => {
  const f = fixture(); let document = f.document;
  for (let round = 1; round <= 3; round++) {
    const proposal = await beginWorkbenchProposal(f.root, baseline(document), `Round ${round}`, document.executionYaml!);
    expect(proposal.context).toContain('Answer with sources');
    expect(loadThoughtDocument(f.root, document.id)?.revision).toBe(document.revision);
    finishWorkbenchProposal(f.root, document.id, proposal.id, { yaml: yaml(`Round ${round}`) });
    document = applyWorkbenchProposal(f.root, document.id, proposal.id).document;
    expect(document.executionYaml).toBe(yaml(`Round ${round}`));
    expect(document.title).toBe(`Round ${round}`);
  }
  expect(listWorkbenchProposals(f.root, document.id).map(p => p.status)).toEqual(['applied', 'applied', 'applied']);
  expect(readdirSync(f.root)).toEqual(['thought-workbenches']);
});

it('records execution-node context provenance without claiming unchanged nodes were rewritten', async () => {
  const { root, document } = fixture();
  const proposal = await beginWorkbenchProposal(root, baseline(document), 'Rename approval', document.executionYaml!);
  const ready = finishWorkbenchProposal(root, document.id, proposal.id, { yaml: yaml().replace('kind: approval', 'kind: approval\n    title: Review evidence') });
  expect(ready.executionNodeIds).toEqual(['review']);
  expect(ready.baseline.nodeIds).toEqual(['thought']);
  expect(executionNodeSources(root, document.id, 'review')).toEqual([]);
  applyWorkbenchProposal(root, document.id, proposal.id);
  expect(executionNodeSources(root, document.id, 'review')).toEqual([{ proposalId: proposal.id, appliedRevision: document.revision + 1, thoughtNodeIds: ['thought'] }]);
  expect(executionNodeSources(root, document.id, 'unrelated')).toEqual([]);
  expect(listWorkbenchProposals(root, document.id)[0]?.executionNodeIds).toEqual(['review']);
  const next = loadThoughtDocument(root, document.id)!;
  const unchanged = await beginWorkbenchProposal(root, baseline(next), 'Change workflow title only', next.executionYaml!);
  expect(finishWorkbenchProposal(root, document.id, unchanged.id, { yaml: next.executionYaml!.replace('title: Original', 'title: Renamed') }).executionNodeIds).toEqual([]);
});

it('rejects stale graph and execution baselines, including manual changes before apply', async () => {
  const { root, document } = fixture();
  const proposal = await beginWorkbenchProposal(root, baseline(document), 'Change title', document.executionYaml!);
  finishWorkbenchProposal(root, document.id, proposal.id, { yaml: yaml('Proposed') });
  saveThoughtDocument(root, { ...document, title: 'Manual edit' }, document.revision);
  expect(() => applyWorkbenchProposal(root, document.id, proposal.id)).toThrow('baseline changed');
  await expect(beginWorkbenchProposal(root, baseline(document), 'Again', document.executionYaml!)).rejects.toThrow('baseline changed');
  expect(loadThoughtDocument(root, document.id)?.executionYaml).toBe(yaml());
});

it('rejects a request carrying a different execution definition than the persisted draft', async () => {
  const { root, document } = fixture();
  await expect(beginWorkbenchProposal(root, baseline(document), 'Change', yaml('Unpersisted'))).rejects.toThrow('latest complete execution draft');
  expect(listWorkbenchProposals(root, document.id)).toEqual([]);
});

it('checks the actual task ETag again at apply without overwriting the external edit', async () => {
  const f = fixture(); const directory = join(f.root, 'tasks', 'workflow'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'task.yaml'), yaml());
  const task = loadTaskDocument(f.root, 'workflow')!;
  const document = saveThoughtDocument(f.root, { ...f.document, taskSlug: task.slug, taskEtag: task.etag }, f.document.revision);
  const proposal = await beginWorkbenchProposal(f.root, baseline(document), 'Change', document.executionYaml!);
  finishWorkbenchProposal(f.root, document.id, proposal.id, { yaml: yaml('Proposed') });
  writeFileSync(join(directory, 'task.yaml'), yaml('External'));
  expect(() => applyWorkbenchProposal(f.root, document.id, proposal.id)).toThrow('Task definition changed');
  expect(loadTaskDocument(f.root, 'workflow')?.yaml).toBe(yaml('External'));
});

it('keeps discarded requests terminal even when the model finishes later', async () => {
  const { root, document } = fixture();
  const proposal = await beginWorkbenchProposal(root, baseline(document), 'Change', document.executionYaml!);
  discardWorkbenchProposal(root, document.id, proposal.id);
  expect(finishWorkbenchProposal(root, document.id, proposal.id, { yaml: yaml('Late') }).status).toBe('discarded');
  expect(() => applyWorkbenchProposal(root, document.id, proposal.id)).toThrow('not ready');
});

it('recovers a proposal acknowledgement after document commit without applying twice', async () => {
  const { root, document } = fixture();
  const proposal = await beginWorkbenchProposal(root, baseline(document), 'Change', document.executionYaml!);
  const ready = finishWorkbenchProposal(root, document.id, proposal.id, { yaml: yaml('Applied') });
  const first = applyWorkbenchProposal(root, document.id, proposal.id);
  writeWorkbenchRecord(root, document.id, 'proposal', proposal.id, ready);
  const recovered = applyWorkbenchProposal(root, document.id, proposal.id);
  expect(recovered.document.revision).toBe(first.document.revision);
  expect(recovered.proposal.status).toBe('applied');
});

it('requires a valid V3 result, not merely valid legacy YAML', async () => {
  const { root, document } = fixture();
  const proposal = await beginWorkbenchProposal(root, baseline(document), 'Change', document.executionYaml!);
  expect(finishWorkbenchProposal(root, document.id, proposal.id, { yaml: yaml().replace('schema_version: 3', 'schema_version: 2') }).status).toBe('failed');
});
