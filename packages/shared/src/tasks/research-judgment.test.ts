import { expect, test } from 'bun:test';
import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, validateResearchRecord, type ResearchRecord } from './research';
import { expandResearch } from './research-expansion';

const config = ResearchConfigSchema.parse({ judgmentVersion: 1, line: { id: 'main', question: 'Cost', premises: ['two years'] },
  dimensions: [{ id: 'cost', requirement: 'original cost' }], sources: [{ id: 'source', path: 'cost.txt' }] });
const sources = [{ id: 'source', ref: 'original', version: 'v1', acquiredAt: 'now', text: '1000000' }];
function record(role: ResearchRecord['role'], session: string, payload: unknown): ResearchRecord {
  return { role, producedBy: { runId: 'r', nodeId: session, attempt: 1, revision: 0, artifactVersion: session, sessionId: session }, payload: ResearchPayloadSchema.parse(payload) };
}
const authored = record('researcher', 'author', { evidence: [{ id: 'e1', sourceId: 'source', sourceVersion: 'v1', locator: { startLine: 1, endLine: 1 }, excerpt: '1000000' }],
  claims: [{ id: 'cost', version: 1, type: 'fact', text: 'Original says 1000000', dimensionIds: ['cost'], evidenceIds: ['e1'], critical: true,
    falsificationConditions: ['A corrected original changes the amount or its two-year scope'] }] });
const critique = { id: 'premise-main-v1', lineId: 'main', premises: ['two years'], claimRefs: [{ id: 'cost', version: 1 }],
  classification: 'retained', finding: 'The scope is explicit; it does not establish real market cost', changeEvidence: ['A revised scope or independent conflicting original'] };
const reviewed = record('reviewer', 'independent', { reviews: [{ claimRef: { id: 'cost', version: 1 }, citationExists: true, support: 'supported', finding: 'Exact original range' }], premiseReviews: [critique] });
const report = record('reporter', 'report', { report: { claimRefs: [{ id: 'cost', version: 1 }], limitations: ['Test data, not a market claim'], unresolved: [] } });

test('premise rejection identifies the exact changed entry without rewriting submitted or frozen text', () => {
  const premises = ['one', 'two', 'three', 'four', 'five', 'six', '初审后按精确原文追加勘误'];
  const scoped = { ...config, line: { ...config.line, premises } };
  const changed = record('reviewer', 'independent', { premiseReviews: [{ ...critique, premises: [...premises.slice(0, 6), '初审后按精确勘误追加'] }] });
  const before = JSON.stringify({ scoped, changed });
  const errors = validateResearchRecord(scoped, sources, [authored], changed);
  expect(errors.join(' ')).toContain('premises[6] received "初审后按精确勘误追加"; expected "初审后按精确原文追加勘误"');
  expect(JSON.stringify({ scoped, changed })).toBe(before);
  const corrected = record('reviewer', 'independent', { premiseReviews: [{ ...critique, premises }] });
  expect(validateResearchRecord(scoped, sources, [authored], corrected)).toEqual([]);
});

test('B2 requires independent exact-version premise critique and falsification, retaining legacy readability', () => {
  expect(validateResearchRecord(config, sources, [authored], reviewed)).toEqual([]);
  expect(validateResearchRecord(config, sources, [authored], { ...reviewed, producedBy: authored.producedBy }).join(' ')).toContain('not independent');
  expect(summarizeResearch(config, sources, [authored, reviewed, report]).blockers).toEqual([]);
  const missing = structuredClone(authored); delete missing.payload.claims[0]!.falsificationConditions;
  expect(summarizeResearch(config, sources, [missing, reviewed, report]).blockers.join(' ')).toContain('falsification');
  const revised = record('researcher', 'repair', { claims: [{ ...authored.payload.claims[0]!, version: 2 }] });
  const fresh = record('reviewer', 'fresh', { reviews: [{ ...reviewed.payload.reviews[0]!, claimRef: { id: 'cost', version: 2 } }] });
  const next = summarizeResearch(config, sources, [authored, reviewed, revised, fresh]);
  expect(next.judgment!.critiques[0]!.current).toBe(false);
  expect(next.judgment!.stages[0]!.state).toBe('pending-review');
  const legacy = { ...config, judgmentVersion: undefined };
  expect(summarizeResearch(legacy, sources, [missing, record('reviewer', 'old', { reviews: reviewed.payload.reviews }), report]).blockers).toEqual([]);
  expect(summarizeResearch(legacy, sources, [authored]).judgment).toBeUndefined();
});

test('B2 factual repair stays on its line; alternative candidates need one atomic canonical disposition', () => {
  const fact = record('reviewer', 'fact-audit', { premiseReviews: [{ ...critique, classification: 'fact-error' }] });
  expect(validateResearchRecord(config, sources, [authored], fact)).toEqual([]);
  const candidate = { id: 'annual-candidate', critiqueId: critique.id, parentLineId: 'main', question: 'Annual cost interpretation', premises: ['one year'], reason: 'Different time horizon, not a correction to the source number' };
  const forkReview = record('reviewer', 'fork-audit', { premiseReviews: [{ ...critique, classification: 'alternative-premise' }], branchCandidates: [candidate] });
  expect(validateResearchRecord(config, sources, [authored], forkReview)).toEqual([]);
  const identical = record('reviewer', 'fork-audit', { ...forkReview.payload, branchCandidates: [{ ...candidate, premises: ['two years'] }] });
  expect(validateResearchRecord(config, sources, [authored], identical).join(' ')).toContain('identical-premise');
  const wrong = record('reviewer', 'fact-audit', { ...fact.payload, branchCandidates: [candidate] });
  expect(validateResearchRecord(config, sources, [authored], wrong).join(' ')).toContain('alternative-premise critique');
  const records = [authored, forkReview];
  expect(summarizeResearch(config, sources, records).blockers.join(' ')).toContain('requires an open or not-adopt disposition');
  const declined = expandResearch(config, { branchDispositions: [{ candidateId: candidate.id, action: 'not-adopt', reason: 'Outside the user-authorized two-year comparison' }] }, new Map(), records);
  expect(summarizeResearch(declined, sources, records).judgment!.candidates[0]!.disposition?.action).toBe('not-adopt');
  const line = { id: 'annual', question: candidate.question, premises: candidate.premises, parentLineIds: ['main'], candidateId: candidate.id };
  const tasks = new Map([['annual-research', { researchRole: 'researcher', researchLineIds: ['annual'] }]]);
  expect(() => expandResearch(config, { lines: [line] }, tasks, records)).toThrow('atomic candidate disposition');
  const opening = { candidateId: candidate.id, action: 'open', reason: 'Authorized alternative premise', lineId: 'annual', taskRef: 'annual-research' };
  expect(expandResearch(config, { lines: [line], branchDispositions: [opening] }, tasks, records).lines?.[0]).toEqual({ ...line, sourceIds: undefined });
  expect(() => expandResearch(declined, { lines: [line], branchDispositions: [opening] }, tasks, records)).toThrow('immutable disposition');
  expect(() => expandResearch(config, { lines: [{ ...line, candidateId: undefined }], branchDispositions: [opening] }, tasks, records)).toThrow('exact independent');
});

test('B4 a local report passes without waiting for unrelated research; final delivery still waits for every selected line', () => {
  const multi = ResearchConfigSchema.parse({ ...config, lines: [{ id: 'other', question: 'Independent unresolved line', premises: ['different basis'] }] });
  const a = structuredClone(authored); a.payload.claims[0]!.lineIds = ['main'];
  const other = record('researcher', 'other-author', { claims: [{ ...authored.payload.claims[0]!, id: 'other-cost', lineIds: ['other'] }] });
  const local = record('reporter', 'local-report', { report: { ...report.payload.report, lineIds: ['main'] } });
  const records = [a, reviewed, other, local];
  expect(summarizeResearch(multi, sources, records, [], ['main']).blockers).toEqual([]);
  const overall = summarizeResearch(multi, sources, records);
  expect(overall.blockers.join(' ')).toContain('Final research report must cover all');
  expect(overall.judgment!.stages.map(stage => stage.state)).toEqual(['deliverable', 'pending-review']);
  expect(validateResearchRecord(multi, sources, [a, reviewed, other], record('reporter', 'bad-local', { report: { ...local.payload.report, claimRefs: [{ id: 'other-cost', version: 1 }] } })).join(' ')).toContain('outside its selected');
});

test('B4 execution and a citation do not bypass unfinished corrections; explicit limits remain visible', () => {
  const issue = { id: 'gap', claimRef: { id: 'cost', version: 1 }, finding: 'Original cannot establish a market cost', disposition: 'add-evidence', reason: 'Need an independent real-market source' };
  const audit = record('reviewer', 'gap-audit', { reviews: [{ ...reviewed.payload.reviews[0]!, support: 'partial' }],
    premiseReviews: [{ ...critique, classification: 'evidence-gap' }], issues: [issue] });
  const limitedReport = record('reporter', 'limited-report', { report: { claimRefs: [], limitations: ['Only test data available'], unresolved: ['Market cost not established'] } });
  const pending = summarizeResearch(config, sources, [authored, audit, limitedReport]);
  expect(pending.judgment!.stages[0]!.state).toBe('needs-work');
  expect(pending.blockers.join(' ')).toContain('still requires correction');
  const limited = record('reviewer', 'gap-disposition', { issues: [{ ...issue, disposition: 'limit', reason: 'Deliver only a test-data interpretation; do not certify market cost' }] });
  const ready = summarizeResearch(config, sources, [authored, audit, limited, limitedReport]);
  expect(ready.blockers).toEqual([]);
  expect(ready.judgment!.stages[0]!.state).toBe('limited-delivery');
  const hiddenFinding = record('reviewer', 'contradictory-audit', { reviews: reviewed.payload.reviews,
    premiseReviews: [{ ...critique, classification: 'fact-error' }] });
  expect(summarizeResearch(config, sources, [authored, hiddenFinding, report]).blockers.join(' ')).toContain('same-line correction');
});
