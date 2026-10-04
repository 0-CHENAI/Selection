import { expect, test } from 'bun:test';
import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, validateResearchRecord, renderResearchReport, type ResearchRecord } from './research.ts';
import { addResearchTemplate } from './research-template.ts';
import { parseTaskSpec } from './schema.ts';
import { planProtectionErrors } from './plan.ts';
const config = ResearchConfigSchema.parse({ line: { id: 'L1', question: 'Compare cost and risk', premises: ['two years'] }, dimensions: [{ id: 'cost', requirement: 'Same cost basis' }, { id: 'risk', requirement: 'Risk evidence' }] });
const sources = [{ id: 's', ref: 'original', version: 'v1', acquiredAt: 'now', text: 'Title\nA two-year cost is 1,000,000 yuan.\nRisk evidence is missing.' }];
function record(role: ResearchRecord['role'], payload: unknown, sessionId: string = role): ResearchRecord { return { role, payload: ResearchPayloadSchema.parse(payload), producedBy: { runId: 'r', nodeId: sessionId, attempt: 1, revision: 0, artifactVersion: 'hash', sessionId } }; }
const researcher = record('researcher', { evidence: [{ id: 'e1', sourceId: 's', sourceVersion: 'v1', locator: { startLine: 2, endLine: 2 }, excerpt: 'A two-year cost is 1,000,000 yuan.' }], claims: [{ id: 'cost', version: 1, type: 'fact', text: 'Cost 100,000 yuan', critical: true, keyNumber: true, dimensionIds: ['cost'], evidenceIds: ['e1'] }] });
const reviewer = record('reviewer', { reviews: [{ claimRef: { id: 'cost', version: 1 }, citationExists: true, support: 'contradicted', finding: 'Source says 1,000,000' }], issues: [{ id: 'i1', claimRef: { id: 'cost', version: 1 }, finding: 'Wrong number', disposition: 'followup-task', reason: 'Correct and review again', followupTaskRef: 'correct-cost' }] });
const corrected = record('researcher', { claims: [{ ...researcher.payload.claims[0], version: 2, text: 'Cost 1,000,000 yuan' }] },'correction');
const reviewed = record('reviewer', { reviews: [{ claimRef: { id: 'cost', version: 2 }, citationExists: true, support: 'supported', finding: 'Original number supports this value', limitations: ['Tax unverified'] }] },'review2');
const report = record('reporter', { report: { claimRefs: [{ id: 'cost', version: 2 }], limitations: ['Risk evidence is missing'], unresolved: ['Risk requires more original material'] } });

test('F5-a/b corrects a contradicted critical number and reports partial dimension coverage', () => {
  expect(validateResearchRecord(config,sources,[researcher],reviewer)).toEqual([]);
  expect(validateResearchRecord(config,sources,[researcher,reviewer],corrected)).toEqual([]);
  const summary = summarizeResearch(config,sources,[researcher,reviewer,corrected,reviewed,report]);
  expect(summary.claims[0]?.text).toBe('Cost 1,000,000 yuan');
  expect(summary.coverage).toEqual({covered:1,limited:0,uncovered:1,total:2});
  expect(summary.blockers).toEqual([]);
  expect(summary.report?.claimRefs).toEqual([{id:'cost',version:2}]);
  expect(summary.issues[0]?.state).toBe('resolved');
  expect(renderResearchReport(summary)).toContain('Cost 1,000,000 yuan');
  expect(renderResearchReport(summary)).not.toContain('Cost 100,000 yuan');
});

test('native template preserves existing work and ordinary tasks have no research configuration', () => {
  const parsed = parseTaskSpec({ schema_version: 3, id:'ordinary',title:'Ordinary',goal:'simple',nodes:[{id:'research',prompt:'existing work'}] });
  expect(parsed.success).toBe(true); if (!parsed.success) return;
  expect(parsed.data.research).toBeUndefined();
  const template = addResearchTemplate(parsed.data,config);
  expect(parseTaskSpec(template).success).toBe(true);
  expect(template.nodes[0]).toEqual(parsed.data.nodes[0]);
  expect(template.nodes.map(node => node.id)).toEqual(['research','research-2','review','research-report']);
  expect(addResearchTemplate(template,config).nodes).toHaveLength(4);
  expect(parseTaskSpec({...template,schema_version:2}).success).toBe(false);
  expect(parseTaskSpec({...template,research:undefined}).success).toBe(false);
  expect(planProtectionErrors(template,{...template,research:{...config,dimensions:[config.dimensions[0]!]}})[0]).toContain('cannot be changed');
});

test('fake revision, unknown followup and duplicate claim ids cannot masquerade as correction', () => {
  const fake = record('reviewer',{issues:[{...reviewer.payload.issues[0],revisedClaimRef:{id:'cost',version:9}}]});
  expect(validateResearchRecord(config,sources,[researcher],fake,new Set(['review']))).toEqual(expect.arrayContaining(['Unknown revised claim cost@9','Unknown canonical followup task correct-cost']));
  expect(ResearchPayloadSchema.safeParse({claims:[researcher.payload.claims[0],corrected.payload.claims[0]]}).success).toBe(false);
  const pending = summarizeResearch(config,sources,[researcher,reviewer,corrected]);
  expect(pending.issues[0]?.state).toBe('pending');
  const limited = record('reviewer',{issues:[{...reviewer.payload.issues[0],disposition:'defer',followupTaskRef:undefined}]});
  expect(summarizeResearch(config,sources,[researcher,limited]).issues[0]?.state).toBe('limited');
});

test('F5-d an old review does not approve a new claim or stale final report after reload', () => {
  const records = JSON.parse(JSON.stringify([researcher,reviewer,corrected]));
  const summary = summarizeResearch(config,sources,records);
  expect(summary.claims[0]?.review).toBeUndefined();
  expect(summary.blockers).toContain('Claim cost@2 requires independent review');
  const stale = record('reporter',{ report: { claimRefs: [{id:'cost',version:1}], limitations:['risk'],unresolved:['cost'] } });
  expect(summarizeResearch(config,sources,[...records,stale]).blockers).toContain('Report cites an outdated or unsupported claim cost@1');
});

for (const changed of ['missing','bad-locator','partial'] as const) test(`F5-c cannot pass from author/hash assertion (${changed})`, () => {
  const producer = structuredClone(researcher);
  const original = changed === 'missing' ? [{ ...sources[0]!, text: undefined, unavailableReason: 'Cannot read source' }] : sources;
  if (changed === 'bad-locator') producer.payload.evidence[0]!.locator = {startLine:9,endLine:9};
  const check = record('reviewer',{ reviews:[{claimRef:{id:'cost',version:1},citationExists:true,support:changed==='partial'?'partial':'supported',finding:'Reviewer finding'}] });
  const summary = summarizeResearch(config,original,[producer,check]);
  expect(summary.coverage.covered).toBe(0);
  expect(summary.claims[0]!.review!.support).toBe(changed==='partial'?'partial':'unverified');
  expect(summary.blockers).toContain('Claim cost@1 requires explicit issue disposition');
});

test('review must be independent and importance or fact type cannot be removed to evade review', () => {
  const same = { ...reviewer, producedBy: researcher.producedBy };
  expect(validateResearchRecord(config,sources,[researcher],same)).toContain('Review context is not independent');
  const evade = structuredClone(corrected); Object.assign(evade.payload.claims[0]!,{ critical:false,keyNumber:false,type:'inference' });
  const errors = validateResearchRecord(config,sources,[researcher],evade);
  expect(errors).toContain('Cannot remove importance from cost');
  expect(errors).toContain('Cannot evade fact review by reclassifying cost');
});
