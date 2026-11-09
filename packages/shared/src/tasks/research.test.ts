import { expect, test } from 'bun:test';
import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, validateResearchRecord, renderResearchReport, type ResearchRecord, type ResearchReadReceipt } from './research.ts';
import { addResearchTemplate } from './research-template.ts';
import { parseTaskSpec } from './schema.ts';
import { planProtectionErrors } from './plan.ts';
const config = ResearchConfigSchema.parse({ line: { id: 'L1', question: 'Compare cost and risk', premises: ['two years'] }, dimensions: [{ id: 'cost', requirement: 'Same cost basis' }, { id: 'risk', requirement: 'Risk evidence' }] });
const sources = [{ id: 's', ref: 'original', version: 'v1', acquiredAt: 'now', text: 'Title\nA two-year cost is 1,000,000 yuan.\nRisk evidence is missing.' }];
function record(role: ResearchRecord['role'], payload: unknown, sessionId: string = role): ResearchRecord { return { role, payload: ResearchPayloadSchema.parse(payload), producedBy: { runId: 'r', nodeId: sessionId, attempt: 1, revision: 0, artifactVersion: 'hash', sessionId } }; }
const researcher = record('researcher', { evidence: [{ id: 'e1', sourceId: 's', sourceVersion: 'v1', locator: { startLine: 2, endLine: 2 }, excerpt: 'A two-year cost is 1,000,000 yuan.' }], claims: [{ id: 'cost', version: 1, type: 'fact', text: 'Cost 100,000 yuan', critical: true, keyNumber: true, dimensionIds: ['cost'], evidenceIds: ['e1'] }] });
const reviewer = record('reviewer', { reviews: [{ claimRef: { id: 'cost', version: 1 }, citationExists: true, support: 'contradicted', finding: 'Source says 1,000,000' }], issues: [{ id: 'i1', claimRef: { id: 'cost', version: 1 }, finding: 'Wrong number', disposition: 'followup-task', reason: 'Correct and review again', followupTaskRef: 'correct-cost' }] });
const corrected = record('researcher', { claims: [{ ...researcher.payload.claims[0], version: 2, text: 'Cost 1,000,000 yuan' }], issues:[{...reviewer.payload.issues[0],disposition:'correct',revisedClaimRef:{id:'cost',version:2}}] },'correction');
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

test('source locators reject literal newline escapes and intervals extending beyond the original',()=>{
  const bad=structuredClone(researcher);
  bad.payload.evidence[0]!.locator={startLine:1,endLine:2};
  bad.payload.evidence[0]!.excerpt='Title\\nA two-year cost is 1,000,000 yuan.';
  expect(validateResearchRecord(config,sources,[],bad).join(' ')).toContain('copy the exact original text');
  bad.payload.evidence[0]!.excerpt='Title\nA two-year cost is 1,000,000 yuan.';
  expect(validateResearchRecord(config,sources,[],bad)).toEqual([]);
  bad.payload.evidence[0]!.locator.endLine=100;
  expect(validateResearchRecord(config,sources,[],bad).join(' ')).toContain('frozen source locator');
});

function receipt(producer: ResearchRecord['producedBy'], startLine = 2, endLine = 2): ResearchReadReceipt {
  return { id: `${producer.nodeId}-${startLine}-${endLine}`, toolUseId: 'read', sourceId: 's', sourceVersion: 'v1', path: '/source',
    contentHash: 'source-hash', returnedTextHash: 'text-hash', startLine, endLine, receivedAt: 'now', producedBy: { ...producer, generation: 0 } };
}

test('A1 requires exact author and independent reviewer read ranges without manufacturing legacy proof', () => {
  const authored = structuredClone(corrected), check = structuredClone(reviewed);
  const records = [researcher, authored, check];
  const strict = { ...config, assuranceVersion: 2 as const };
  const authorRead = receipt(authored.producedBy), reviewRead = receipt(check.producedBy);
  expect(summarizeResearch(config, sources, records).claims[0]!.review!.support).toBe('supported');
  expect(summarizeResearch(config, sources, records).sourceBundle.unrecorded).toEqual(['s']);
  for (const reads of [[], [authorRead], [reviewRead], [authorRead, { ...reviewRead, producedBy: { ...reviewRead.producedBy, revision: 1 } }],
    [authorRead, { ...reviewRead, startLine: 1, endLine: 1 }]]) {
    expect(summarizeResearch(strict, sources, records, reads).claims[0]!.review!.support).toBe('unverified');
  }
  const accepted = summarizeResearch(strict, sources, records, [authorRead, reviewRead]);
  expect(accepted.claims[0]!.review!.support).toBe('supported');
  expect(accepted.sourceBundle.cited[0]!.claimRefs).toEqual([{ id: 'cost', version: 2 }]);
  expect(accepted.sourceBundle.cited[0]!.readIds).toHaveLength(2);
})

test('A1 combines contiguous returned ranges, discloses uncited reads and propagates an unrecorded factual input', () => {
  const authored = record('researcher', { evidence: [{ ...researcher.payload.evidence[0], locator: { startLine: 1, endLine: 2 }, excerpt: sources[0]!.text.split('\n').slice(0, 2).join('\n') }],
    claims: [{ ...corrected.payload.claims[0], version: 2 }, { ...corrected.payload.claims[0], id: 'recommend', type: 'inference', inputClaimRefs: [{ id: 'cost', version: 2 }] }] }, 'author');
  const check = record('reviewer', { reviews: ['cost', 'recommend'].map(id => ({ ...reviewed.payload.reviews[0], claimRef: { id, version: 2 } })) }, 'audit');
  const reads = [receipt(authored.producedBy, 1, 1), receipt(authored.producedBy, 2, 2), receipt(check.producedBy, 1, 2), receipt(check.producedBy, 3, 3)];
  const strict = { ...config, assuranceVersion: 2 as const };
  const summary = summarizeResearch(strict, sources, [authored, check], reads);
  expect(summary.claims.every(claim => claim.review?.support === 'supported')).toBe(true);
  expect(summary.sourceBundle.readNotCited.map(read => read.startLine)).toEqual([3]);
  const another = record('researcher', { claims: [{ ...authored.payload.claims[0], version: 3 }] }, 'changed-author');
  const nextCheck = record('reviewer', { reviews: [{ ...check.payload.reviews[0], claimRef: { id: 'cost', version: 3 } }] }, 'next-audit');
  const dependent = record('researcher', { claims: [{ ...authored.payload.claims[1], version: 3, inputClaimRefs: [{ id: 'cost', version: 3 }] }] }, 'dependent');
  const dependentReview = record('reviewer', { reviews: [{ ...check.payload.reviews[1], claimRef: { id: 'recommend', version: 3 } }] }, 'dependent-audit');
  const dependentReads = [receipt(dependent.producedBy, 1, 2), receipt(dependentReview.producedBy, 1, 2)];
  const invalid = summarizeResearch(strict, sources, [authored, check, another, nextCheck, dependent, dependentReview], [...reads, ...dependentReads]);
  expect(invalid.claims.find(claim => claim.id === 'cost')!.review!.support).toBe('unverified');
  expect(invalid.claims.find(claim => claim.id === 'recommend')!.review!.support).toBe('unverified');
})
