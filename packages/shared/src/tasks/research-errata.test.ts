import { expect, test } from 'bun:test';
import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, validateResearchRecord, renderResearchReport, type ResearchRecord } from './research';

const config = ResearchConfigSchema.parse({ line: { id: 'main', question: 'Costs', premises: ['two years'] }, dimensions: [{ id: 'cost', requirement: 'cost evidence' }] });
const sources = [{ id: 'cost-source', ref: 'costs', version: 'original', acquiredAt: 'now', text: 'Cost is 1,000,000' }];
const make = (role: ResearchRecord['role'], nodeId: string, payload: unknown): ResearchRecord => ({ role, payload: ResearchPayloadSchema.parse(payload),
  producedBy: { runId: 'run', nodeId, attempt: 1, revision: 0, sessionId: nodeId, artifactVersion: nodeId } });
const claim = { id: 'cost', version: 1, type: 'fact', text: 'Cost is 100,000', dimensionIds: ['cost'], evidenceIds: ['cost-evidence'], critical: true };
const authored = make('researcher', 'author', { evidence: [{ id: 'cost-evidence', sourceId: 'cost-source', sourceVersion: 'original', locator: { startLine: 1, endLine: 1 }, excerpt: 'Cost is 1,000,000' }],
  claims: [claim, { ...claim, id: 'decision', type: 'inference', inputClaimRefs: [{ id: 'cost', version: 1 }] }, { ...claim, id: 'unrelated', text: 'Source supplies a total' }] });
const reviewed = make('reviewer', 'review', { reviews: ['cost', 'decision', 'unrelated'].map(id => ({ claimRef: { id, version: 1 }, citationExists: true, support: 'supported', finding: 'Original reviewed' })) });
const report = make('reporter', 'report', { report: { claimRefs: ['cost', 'decision', 'unrelated'].map(id => ({ id, version: 1 })), limitations: [], unresolved: [] } });
const correction = make('reviewer', 'critique', { errata: [{ id: 'wrong-number', target: { kind: 'claim', claimRef: { id: 'cost', version: 1 } }, reason: 'Original is ten times higher' }] });

test('A3 invalidates exact erroneous claim, transitive reasoning and historical report while preserving unrelated review and premises', () => {
  const history = [authored, reviewed, report], bytes = JSON.stringify(history);
  expect(validateResearchRecord(config, sources, history, correction)).toEqual([]);
  const summary = summarizeResearch(config, sources, [...history, correction]);
  expect(summary.claims.filter(claim => claim.id !== 'unrelated').every(claim => claim.review?.support === 'unverified')).toBe(true);
  expect(summary.claims.find(claim => claim.id === 'unrelated')?.review?.support).toBe('supported');
  expect(summary.errata[0]!.affectedClaimRefs).toEqual([{ id: 'cost', version: 1 }, { id: 'decision', version: 1 }]);
  expect(summary.errata[0]!.affectedReports).toEqual([report.producedBy]);
  expect(summary.errata[0]!.state).toBe('pending');
  expect(summary.blockers).toContain('Report cites an outdated or unsupported claim cost@1');
  expect(summary.lines.map(line => line.premises)).toEqual([['two years']]);
  expect(JSON.stringify(history)).toBe(bytes);
});

test('A3 resolves only after new exact versions and independent review; old report stays invalid and correction remains disclosed', () => {
  const history = [authored, reviewed, report, correction];
  const fixed = make('researcher', 'fix', { claims: [{ ...claim, version: 2, text: 'Cost is 1,000,000' },
    { ...claim, id: 'decision', version: 2, text: 'Decision uses the corrected total', type: 'inference', inputClaimRefs: [{ id: 'cost', version: 2 }] }] });
  expect(summarizeResearch(config, sources, [...history, fixed]).errata[0]!.state).toBe('pending');
  const audit = make('reviewer', 'fresh-review', { reviews: ['cost', 'decision'].map(id => ({ claimRef: { id, version: 2 }, citationExists: true, support: 'supported', finding: 'Corrected version reviewed' })) });
  const current = [...history, fixed, audit];
  expect(summarizeResearch(config, sources, current).blockers).toContain('Report cites an outdated or unsupported claim cost@1');
  const delivered = make('reporter', 'new-report', { report: { claimRefs: [{ id: 'cost', version: 2 }, { id: 'decision', version: 2 }, { id: 'unrelated', version: 1 }], limitations: [], unresolved: [], erratumIds: ['wrong-number'], changeEvidence: ['Corrected the tenfold numerical error; historical report is invalid'] } });
  const summary = summarizeResearch(config, sources, [...current, delivered]);
  expect(summary.errata[0]!.state).toBe('resolved');
  expect(summary.blockers).toEqual([]);
  expect(renderResearchReport(summary)).toContain('追加勘误：wrong-number');
  expect(renderResearchReport(summary)).not.toContain('Cost is 100,000');
  expect(summarizeResearch(config, sources, [...current, make('reporter', 'no-ref', { report: { ...delivered.payload.report, erratumIds: [] } })]).blockers).toContain('Report must cite appended erratum wrong-number');
  expect(validateResearchRecord(config, sources, current, make('reporter', 'unknown-ref', { report: { ...delivered.payload.report, erratumIds: ['unknown'] } }))).toContain('Unknown report erratum unknown');
});

test('A3 source erratum targets its precise version, including later claims still relying on that source', () => {
  const errata = make('reviewer', 'source-review', { errata: [{ id: 'bad-source', target: { kind: 'source', sourceId: 'cost-source', sourceVersion: 'original' }, reason: 'Source data needs correction' }] });
  const fixed = make('researcher', 'same-source', { claims: [{ ...claim, version: 2, text: 'Reworded but same source' }] });
  const summary = summarizeResearch(config, sources, [authored, reviewed, errata, fixed]);
  expect(summary.errata[0]!.affectedClaimRefs).toContainEqual({ id: 'cost', version: 2 });
  expect(summary.errata[0]!.state).toBe('pending');
  const other = make('reviewer', 'unknown-source', { errata: [{ id: 'unknown', target: { kind: 'source', sourceId: 'cost-source', sourceVersion: 'new-unseen-version' }, reason: 'Unknown version' }] });
  expect(validateResearchRecord(config, sources, [authored], other)).toContain('Unknown erratum source cost-source@new-unseen-version');
});

test('A3 rejects unknown references, overwritten errata and blank reasons without changing legacy records', () => {
  const duplicate = make('reviewer', 'overwrite', { errata: [{ ...correction.payload.errata![0], reason: 'Overwrite prior reason' }] });
  expect(validateResearchRecord(config, sources, [authored, correction], duplicate)).toContain('Erratum wrong-number is immutable; append a new identity');
  const unknown = make('reviewer', 'unknown', { errata: [{ id: 'unknown', target: { kind: 'claim', claimRef: { id: 'cost', version: 9 } }, reason: 'Unseen version' }] });
  expect(validateResearchRecord(config, sources, [authored], unknown)).toContain('Unknown erratum claim cost@9');
  expect(ResearchPayloadSchema.safeParse({ errata: [{ ...correction.payload.errata![0], reason: '  ' }] }).success).toBe(false);
  expect(summarizeResearch(config, sources, [authored, reviewed, report]).errata).toEqual([]);
});
