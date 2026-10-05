/** Research business records reference execution receipts; they never schedule work. */
import { z } from 'zod';
const id = z.string().min(1);
const version = z.number().int().positive();
export const ResearchLineSchema = z.object({ id, question: id, premises: z.array(id).default([]),
  parentLineIds: z.array(id).optional(), sourceIds: z.array(id).optional() }).strict();
export const ResearchScopeSchema = z.object({ region: id, year: id, currency: id, tax: id, basis: id, requirements: id }).strict();
const claimRef = z.object({ id, version }).strict();
export const ResearchQuestionSchema = z.object({ id, question: id, sharedTaskRef: id,
  scope: ResearchScopeSchema, commonBackground: z.array(id), compatibilityReason: id,
  parents: z.array(z.object({ lineId: id, premises: z.array(id), inputScope: ResearchScopeSchema,
    claimRefs: z.array(claimRef), evidenceRefs: z.array(id), issueRefs: z.array(id), path: z.array(id) }).strict()).min(1),
}).strict();
export const ResearchExpansionSchema = z.object({ lines: z.array(ResearchLineSchema).optional(), questions: z.array(ResearchQuestionSchema).optional() }).strict();
export type ResearchExpansion = z.infer<typeof ResearchExpansionSchema>;
export const ResearchConfigSchema = z.object({
  /** Absent in legacy records: never retroactively invent read receipts. */
  assuranceVersion: z.literal(2).optional(),
  line: ResearchLineSchema,
  lines: z.array(ResearchLineSchema).optional(), questions: z.array(ResearchQuestionSchema).optional(),
  dimensions: z.array(z.object({ id, requirement: id, required: z.boolean().default(true) }).strict()).min(1),
  sources: z.array(z.object({ id, path: id, ref: id.optional() }).strict()).default([]),
}).strict().superRefine((config, ctx) => {
  for (const field of ['dimensions', 'sources'] as const) {
    if (new Set(config[field].map(item => item.id)).size !== config[field].length) ctx.addIssue({ code: 'custom', path: [field], message: `Duplicate ${field} identity` });
  }
  const lines = [config.line, ...(config.lines ?? [])];
  if (new Set(lines.map(line => line.id)).size !== lines.length) ctx.addIssue({ code: 'custom', message: 'Duplicate research line identity' });
  if (new Set((config.questions ?? []).map(question => question.id)).size !== (config.questions ?? []).length) ctx.addIssue({ code: 'custom', message: 'Duplicate shared question identity' });
  const byId = new Map(lines.map(line => [line.id, line]));
  const visit = (lineId: string, path: Set<string>): boolean => {
    if (path.has(lineId)) return false;
    const line = byId.get(lineId); if (!line) return false;
    return (line.parentLineIds ?? []).every(parent => visit(parent, new Set([...path, lineId])));
  };
  for (const question of config.questions ?? []) {
    if (new Set(question.parents.map(parent => parent.lineId)).size !== question.parents.length) ctx.addIssue({ code: 'custom', message: 'Duplicate shared question parent' });
    for (const parent of question.parents) {
      const line = byId.get(parent.lineId);
      if (!line || JSON.stringify(line.premises) !== JSON.stringify(parent.premises)) ctx.addIssue({ code: 'custom', message: `Shared question must preserve premises of ${parent.lineId}` });
      if (Object.keys(question.scope).some(key => question.scope[key as keyof typeof question.scope] !== parent.inputScope[key as keyof typeof parent.inputScope])) ctx.addIssue({ code: 'custom', message: `Incompatible shared question input scope for ${parent.lineId}` });
    }
    if ((config.questions ?? []).some(other => other.id !== question.id && other.sharedTaskRef === question.sharedTaskRef)) ctx.addIssue({ code: 'custom', message: 'Different logical questions cannot share one task identity' });
  }
  for (const line of lines) {
    if (!visit(line.id, new Set())) ctx.addIssue({ code: 'custom', message: `Unknown or cyclic parent research line ${line.id}` });
    if (line.sourceIds?.some(id => !config.sources.some(source => source.id === id))) ctx.addIssue({ code: 'custom', message: `Unknown source in research line ${line.id}` });
  }
});
export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
export interface ResearchSource {
  id: string; ref: string; version: string; hash?: string; acquiredAt: string;
  originalPath?: string; snapshotPath?: string; text?: string; unavailableReason?: string;
}
export const ResearchReadReceiptSchema = z.object({ id, sourceId: id, sourceVersion: id, toolUseId: id,
  path: id, contentHash: id, startLine: version, endLine: version, returnedTextHash: id,
  producedBy: z.object({ runId: id, nodeId: id, attempt: version, revision: z.number().int().nonnegative(),
    sessionId: id, generation: z.number().int().nonnegative() }).strict(), receivedAt: id,
}).strict();
export type ResearchReadReceipt = z.infer<typeof ResearchReadReceiptSchema>;
const evidence = z.object({ id, sourceId: id, sourceVersion: id,
  locator: z.object({ startLine: version, endLine: version }).strict(), excerpt: id }).strict();
const claim = z.object({ id, version, type: z.enum(['fact', 'inference', 'explanation', 'value']), text: id,
  inputClaimRefs: z.array(claimRef).optional(), lineIds: z.array(id).min(1).optional(), dimensionIds: z.array(id).min(1), evidenceIds: z.array(id), critical: z.boolean(),
  recommendation: z.boolean().default(false), keyNumber: z.boolean().default(false), conditions: z.array(id).default([]) }).strict();
const review = z.object({ claimRef, citationExists: z.boolean(), support: z.enum(['supported', 'partial', 'contradicted', 'unverified']),
  finding: id, limitations: z.array(id).default([]) }).strict();
const issue = z.object({ id, claimRef, finding: id, disposition: z.enum(['correct', 'add-evidence', 'respond', 'limit', 'followup-task', 'defer']),
  reason: id, revisedClaimRef: claimRef.optional(), followupTaskRef: id.optional() }).strict();
const erratum = z.object({ id, reason: z.string().trim().min(1), target: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), claimRef }).strict(),
  z.object({ kind: z.literal('source'), sourceId: id, sourceVersion: id }).strict(),
]) }).strict();
export const ResearchPayloadSchema = z.object({
  evidence: z.array(evidence).default([]), claims: z.array(claim).default([]), reviews: z.array(review).default([]), issues: z.array(issue).default([]),
  errata: z.array(erratum).optional(),
  relations: z.array(z.object({ id, type: z.enum(['supports', 'refutes', 'converges']), from: claimRef, to: claimRef, reason: id }).strict()).optional(),
  report: z.object({ claimRefs: z.array(claimRef), limitations: z.array(id), unresolved: z.array(id),
    alternatives: z.array(id).optional(), changeEvidence: z.array(id).optional(), erratumIds: z.array(id).optional() }).strict().optional(),
}).strict().superRefine((payload, ctx) => {
  for (const field of ['evidence', 'claims', 'issues', 'relations', 'errata'] as const) {
    const identities = (payload[field] ?? []).map(item => item.id);
    if (new Set(identities).size !== identities.length) ctx.addIssue({ code: 'custom', path: [field], message: `Duplicate ${field} identity` });
  }
  if (new Set(payload.reviews.map(review => `${review.claimRef.id}@${review.claimRef.version}`)).size !== payload.reviews.length) ctx.addIssue({code:'custom',path:['reviews'],message:'Duplicate review target in one submission'});
});
export type ResearchPayload = z.infer<typeof ResearchPayloadSchema>;
export type ResearchRole = 'researcher' | 'reviewer' | 'reporter';
export interface ResearchProducer {
  runId: string; nodeId: string; attempt: number; revision: number; artifactVersion: string; sessionId: string;
}
export interface ResearchRecord { role: ResearchRole; producedBy: ResearchProducer; payload: ResearchPayload }
export const ResearchRecordSchema = z.object({ role: z.enum(['researcher', 'reviewer', 'reporter']),
  producedBy: z.object({ runId: id, nodeId: id, attempt: version, revision: z.number().int().nonnegative(), artifactVersion: id, sessionId: id }).strict(),
  payload: ResearchPayloadSchema }).strict();
export interface ResearchSummary {
  assuranceVersion?: 2;
  reads: ResearchReadReceipt[];
  sourceBundle: { cited: Array<{ sourceId: string; sourceVersion: string; claimRefs: Array<{ id: string; version: number }>; readIds: string[] }>;
    readNotCited: ResearchReadReceipt[]; unresolved: Array<{ claimRef: { id: string; version: number }; evidenceId: string; reason: string }>;
    unrecorded: string[] };
  errata: Array<NonNullable<ResearchPayload['errata']>[number] & { producedBy: ResearchProducer;
    affectedClaimRefs: Array<{ id: string; version: number }>; affectedReports: ResearchProducer[]; state: 'pending' | 'resolved' }>;
  line: ResearchConfig['line']; lines: Array<ResearchConfig['line'] & { claimRefs: Array<{id: string; version: number}>; issueIds: string[]; taskRefs: string[]; sourceIds: string[] }> ; questions: NonNullable<ResearchConfig['questions']>;
  relations: Array<NonNullable<ResearchPayload['relations']>[number] & { producedBy: ResearchProducer; current: boolean }>; sources: ResearchSource[]; records: ResearchRecord[];
  dimensions: Array<ResearchConfig['dimensions'][number] & { lineId: string; state: 'covered' | 'limited' | 'uncovered'; claimRefs: Array<{ id: string; version: number }> }>;
  coverage: { covered: number; limited: number; uncovered: number; total: number };
  claims: Array<ResearchPayload['claims'][number] & { producedBy: ResearchProducer; review?: ResearchPayload['reviews'][number]; reviewer?: ResearchProducer }>;
  issues: Array<ResearchPayload['issues'][number] & { producedBy: ResearchProducer; state: 'resolved' | 'limited' | 'pending' }>;
  report?: ResearchPayload['report'] & { producedBy: ResearchProducer };
  blockers: string[];
}
const key = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;

/** Version identity is immutable; reviews never approve a different claim version. */
export function validateResearchRecord(config: ResearchConfig, sources: ResearchSource[], previous: ResearchRecord[], record: ResearchRecord, taskIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const { payload, role } = record;
  if (role !== 'reviewer' && payload.reviews.length) errors.push('Independent review requires a reviewer node');
  if (role === 'reviewer' && payload.claims.length) errors.push('Reviewers must request correction instead of authoring their own reviewed claims');
  if (role !== 'reporter' && payload.report) errors.push('Report requires a reporter node');
  const knownClaims = previous.flatMap(entry => entry.payload.claims.map(value => ({ ...value, producer: entry.producedBy })));
  const knownEvidence = previous.flatMap(entry => entry.payload.evidence);
  for (const value of payload.errata ?? []) {
    const target = value.target;
    if (previous.some(entry => entry.payload.errata?.some(old => old.id === value.id))) errors.push(`Erratum ${value.id} is immutable; append a new identity`);
    if (target.kind === 'claim') {
      if (![...knownClaims, ...payload.claims].some(claim => key(claim) === key(target.claimRef))) errors.push(`Unknown erratum claim ${key(target.claimRef)}`);
    } else if (![...sources.map(source => ({ sourceId: source.id, sourceVersion: source.version })), ...knownEvidence, ...payload.evidence]
      .some(source => source.sourceId === target.sourceId && source.sourceVersion === target.sourceVersion)) errors.push(`Unknown erratum source ${target.sourceId}@${target.sourceVersion}`);
  }
  for (const value of payload.evidence) {
    if (knownEvidence.some(old => old.id === value.id)) errors.push(`Evidence identity ${value.id} already exists; use a new evidence version identity`);
    const source = sources.find(source => source.id === value.sourceId && source.version === value.sourceVersion);
    if (source?.text !== undefined && !source.unavailableReason && !evidenceExists(value,sources)) errors.push(`Evidence ${value.id} excerpt is not present at its frozen source locator; read and copy the exact original text, including real newlines`);
    if (!sources.some(source => source.id === value.sourceId && source.version === value.sourceVersion)) errors.push(`Unknown source version ${value.sourceId}@${value.sourceVersion}`);
  }
  const lines = [config.line, ...(config.lines ?? [])];
  for (const value of payload.claims) {
    if (lines.length > 1 && !value.lineIds?.length) errors.push(`Claim ${value.id} must identify its research lines`);
    if (value.lineIds?.some(id => !lines.some(line => line.id === id))) errors.push(`Unknown claim research line for ${value.id}`);
    const old = knownClaims.filter(old => old.id === value.id).at(-1);
    if (old && keyLines(old,config) !== keyLines(value,config)) errors.push(`Cannot move claim ${value.id} to different research premises`);
    if (old && old.inputClaimRefs?.some(ref => !value.inputClaimRefs?.some(next => next.id === ref.id && next.version >= ref.version))) errors.push(`Cannot remove or regress factual inputs from ${value.id}`);
    if (old && value.version <= old.version) errors.push(`Claim ${value.id} requires a new version after ${old.version}`);
    if (old && (old.critical && !value.critical || old.recommendation && !value.recommendation || old.keyNumber && !value.keyNumber)) errors.push(`Cannot remove importance from ${value.id}`);
    if (old && old.type === 'fact' && value.type !== 'fact') errors.push(`Cannot evade fact review by reclassifying ${value.id}`);
    if (old && old.dimensionIds.some(dimension => config.dimensions.some(item => item.id === dimension && item.required) && !value.dimensionIds.includes(dimension))) errors.push(`Cannot remove required dimensions from ${value.id}`);
    if (value.dimensionIds.some(dimension => !config.dimensions.some(item => item.id === dimension))) errors.push(`Unknown claim dimension for ${value.id}`);
    for (const ref of value.inputClaimRefs ?? []) {
      if (![...knownClaims, ...payload.claims].some(claim => key(claim) === key(ref))) errors.push(`Unknown input claim ${key(ref)}`);
      const byVersion = new Map([...knownClaims,...payload.claims].map(claim => [key(claim),claim]));
      const visit = (target: string, seen: Set<string>): boolean => !seen.has(target) && (byVersion.get(target)?.inputClaimRefs ?? []).every(input => visit(key(input),new Set([...seen,target])));
      if (!visit(key(value),new Set())) errors.push(`Cyclic claim reasoning ${key(value)}`);
    }
    if (value.evidenceIds.some(evidenceId => ![...knownEvidence, ...payload.evidence].some(item => item.id === evidenceId))) errors.push(`Missing claim evidence for ${value.id}`);
  }
  for (const value of payload.reviews) {
    const target = knownClaims.find(claim => key(claim) === key(value.claimRef));
    if (!target) errors.push(`Unknown reviewed claim ${key(value.claimRef)}`);
    else if (target.producer.sessionId === record.producedBy.sessionId) errors.push('Review context is not independent');
  }
  for (const value of payload.issues) {
    if (![...knownClaims, ...payload.claims].some(claim => key(claim) === key(value.claimRef))) errors.push(`Unknown issue claim ${key(value.claimRef)}`);
    if (value.disposition === 'followup-task' && !value.followupTaskRef) errors.push('Followup disposition requires the canonical task reference');
    if (['correct', 'add-evidence'].includes(value.disposition) && !value.revisedClaimRef && !value.followupTaskRef) errors.push('Correction/evidence disposition requires a revision or canonical followup task');
    if (value.followupTaskRef && taskIds && !taskIds.has(value.followupTaskRef)) errors.push(`Unknown canonical followup task ${value.followupTaskRef}`);
    if (value.revisedClaimRef && ![...knownClaims, ...payload.claims].some(claim => key(claim) === key(value.revisedClaimRef!))) errors.push(`Unknown revised claim ${key(value.revisedClaimRef)}`);
    if (value.revisedClaimRef && (value.revisedClaimRef.id !== value.claimRef.id || value.revisedClaimRef.version <= value.claimRef.version)) errors.push('Correction must link a newer version of the affected claim');
    const prior = previous.flatMap(entry => entry.payload.issues).find(issue => issue.id === value.id);
    if (prior && key(prior.claimRef) !== key(value.claimRef)) errors.push(`Issue ${value.id} cannot change its target version`);
  }
  for (const relation of payload.relations ?? []) {
    if (previous.flatMap(record => record.payload.relations ?? []).some(old => old.id === relation.id)) errors.push(`Relation ${relation.id} already exists`);
    for (const ref of [relation.from, relation.to]) if (![...knownClaims, ...payload.claims].some(claim => key(claim) === key(ref))) errors.push(`Unknown relation claim ${key(ref)}`);
    if (key(relation.from) === key(relation.to)) errors.push('Research relations require distinct conclusions');
  }
  const knownErrata = [...previous.flatMap(entry => entry.payload.errata ?? []), ...(payload.errata ?? [])];
  for (const ref of payload.report?.erratumIds ?? []) if (!knownErrata.some(value => value.id === ref)) errors.push(`Unknown report erratum ${ref}`);
  if (payload.report?.erratumIds && new Set(payload.report.erratumIds).size !== payload.report.erratumIds.length) errors.push('Duplicate report erratum identity');
  return errors;
}
const keyLines = (claim: {lineIds?: string[]}, config: ResearchConfig) => [...(claim.lineIds ?? [config.line.id])].sort().join('\n');

/** Locator existence and semantic support are separate. Hash only identifies bytes. */
export function evidenceExists(value: ResearchPayload['evidence'][number], sources: ResearchSource[]): boolean {
  const source = sources.find(source => source.id === value.sourceId && source.version === value.sourceVersion);
  return source?.text !== undefined && !source.unavailableReason && value.locator.endLine >= value.locator.startLine && value.locator.endLine <= source.text.split('\n').length
    && source.text.split('\n').slice(value.locator.startLine - 1, value.locator.endLine).join('\n').includes(value.excerpt);
}

/** The SDK counts content lines but retains a terminal newline in its delivered text. */
export function researchReadRangeTexts(source: ResearchSource, range: { startLine: number; endLine: number }): string[] {
  if (source.text === undefined || source.unavailableReason || !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)
    || range.startLine < 1 || range.endLine < range.startLine) return [];
  const lines = source.text.split('\n');
  if (range.endLine > lines.length) return [];
  const text = lines.slice(range.startLine - 1, range.endLine).join('\n');
  if (!text) return [];
  return range.endLine === lines.length - 1 && lines.at(-1) === '' ? [text, text + '\n'] : [text];
}

export function summarizeResearch(config: ResearchConfig, sources: ResearchSource[], records: ResearchRecord[], reads: ResearchReadReceipt[] = []): ResearchSummary {
  const current = new Map<string, ResearchSummary['claims'][number]>();
  const allEvidence = records.flatMap(record => record.payload.evidence);
  const latestIssues = new Map<string, ResearchSummary['issues'][number]>();
  for (const record of records) for (const issue of record.payload.issues) latestIssues.set(issue.id, { ...issue, producedBy: record.producedBy, state: 'pending' });
  const issues = [...latestIssues.values()];
  for (const record of records) for (const value of record.payload.claims) {
    if (!current.has(value.id) || current.get(value.id)!.version < value.version) current.set(value.id, { ...value, producedBy: record.producedBy });
  }
  for (const value of current.values()) {
    const latest = records.filter(record => record.role === 'reviewer' && record.producedBy.sessionId !== value.producedBy.sessionId)
      .flatMap(record => record.payload.reviews.map(review => ({ review, producer: record.producedBy })))
      .filter(entry => key(entry.review.claimRef) === key(value)).at(-1);
    if (latest) {
      const citationExists = value.evidenceIds.length > 0 && value.evidenceIds.every(id => {
        const evidence = allEvidence.find(item => item.id === id); return evidence && evidenceExists(evidence, sources);
      });
      value.review = { ...latest.review, citationExists: latest.review.citationExists && citationExists,
        support: citationExists ? latest.review.support : 'unverified' };
      value.reviewer = latest.producer;
    }
  }
  const claims = [...current.values()];
  const historicalClaims = records.flatMap(record => record.payload.claims);
  const errata: ResearchSummary['errata'] = records.flatMap(record => (record.payload.errata ?? []).map(value => {
    const affected = new Map<string, { id: string; version: number }>();
    for (const claim of historicalClaims) {
      const direct = value.target.kind === 'claim' ? key(claim) === key(value.target.claimRef)
        : claim.evidenceIds.some(id => allEvidence.some(evidence => evidence.id === id && value.target.kind === 'source'
          && evidence.sourceId === value.target.sourceId && evidence.sourceVersion === value.target.sourceVersion));
      if (direct) affected.set(key(claim), { id: claim.id, version: claim.version });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const claim of historicalClaims) if (!affected.has(key(claim)) && claim.inputClaimRefs?.some(ref => affected.has(key(ref)))) {
        affected.set(key(claim), { id: claim.id, version: claim.version }); changed = true;
      }
    }
    return { ...value, producedBy: record.producedBy, affectedClaimRefs: [...affected.values()], state: 'pending' as const,
      affectedReports: records.filter(record => record.payload.report?.claimRefs.some(ref => affected.has(key(ref)))).map(record => record.producedBy) };
  }));
  const invalidated = new Set(errata.flatMap(value => value.affectedClaimRefs.map(key)));
  for (const value of claims) if (value.review && invalidated.has(key(value))) value.review = { ...value.review, support: 'unverified', finding: `${value.review.finding}; append-only erratum invalidates this exact conclusion version` };
  const cited = new Map<string, ResearchSummary['sourceBundle']['cited'][number]>();
  const unresolved: ResearchSummary['sourceBundle']['unresolved'] = [];
  for (const value of claims) for (const evidenceId of value.evidenceIds) {
    const item = allEvidence.find(evidence => evidence.id === evidenceId);
    if (!item || !evidenceExists(item, sources)) {
      unresolved.push({ claimRef: { id: value.id, version: value.version }, evidenceId, reason: 'Original source or exact locator is unavailable' }); continue;
    }
    const identity = `${item.sourceId}@${item.sourceVersion}`;
    const entry = cited.get(identity) ?? { sourceId: item.sourceId, sourceVersion: item.sourceVersion, claimRefs: [], readIds: [] };
    if (!entry.claimRefs.some(ref => key(ref) === key(value))) entry.claimRefs.push({ id: value.id, version: value.version });
    entry.readIds = [...new Set([...entry.readIds, ...reads.filter(read => read.sourceId === item.sourceId && read.sourceVersion === item.sourceVersion
      && read.startLine <= item.locator.endLine && read.endLine >= item.locator.startLine).map(read => read.id)])];
    cited.set(identity, entry);
  }
  const sourceBundle: ResearchSummary['sourceBundle'] = { cited: [...cited.values()],
    readNotCited: reads.filter(read => ![...cited.values()].some(source => source.readIds.includes(read.id))), unresolved,
    unrecorded: sources.filter(source => !reads.some(read => read.sourceId === source.id && read.sourceVersion === source.version)).map(source => source.id) };
  if (config.assuranceVersion === 2) for (const value of current.values()) {
    const hasReads = (producer?: ResearchProducer) => !!producer && value.evidenceIds.every(evidenceId => {
      const evidence = allEvidence.find(item => item.id === evidenceId);
      if (!evidence) return false;
      const ranges = reads.filter(read => read.producedBy.runId === producer.runId && read.producedBy.nodeId === producer.nodeId
        && read.producedBy.revision === producer.revision && read.producedBy.sessionId === producer.sessionId
        && read.producedBy.attempt === producer.attempt && read.sourceId === evidence.sourceId && read.sourceVersion === evidence.sourceVersion)
        .sort((a, b) => a.startLine - b.startLine);
      let nextLine = evidence.locator.startLine;
      for (const range of ranges) if (range.startLine <= nextLine) nextLine = Math.max(nextLine, range.endLine + 1);
      return nextLine > evidence.locator.endLine;
    });
    if (value.review && (!hasReads(value.producedBy) || !hasReads(value.reviewer))) value.review = { ...value.review, support: 'unverified', finding: `${value.review.finding}; successful original read range has not been recorded for this author/reviewer attempt` };
  }
  // A review cannot remain current when one of its exact numerical/factual inputs changes.
  const staleInput = (value: ResearchSummary['claims'][number], seen = new Set<string>()): boolean => {
    if (seen.has(key(value))) return true;
    return (value.inputClaimRefs ?? []).some(ref => {
      const input = current.get(ref.id);
      return !input || input.version !== ref.version || !input.review?.citationExists || input.review.support !== 'supported'
        || staleInput(input,new Set([...seen,key(value)]));
    });
  };
  for (const value of current.values()) if (value.review && staleInput(value)) value.review = { ...value.review, support:'unverified', finding:`${value.review.finding}; exact input claim changed or unsupported` };
  const isSupported = (value: ResearchSummary['claims'][number]) => value.review?.citationExists && value.review.support === 'supported';
  for (const value of errata) value.state = value.affectedClaimRefs.every(ref => {
    const next = current.get(ref.id);
    return !!next && !invalidated.has(key(next)) && isSupported(next);
  }) ? 'resolved' : 'pending';
  for (const issue of issues) {
    const correction = issue.revisedClaimRef ? current.get(issue.revisedClaimRef.id) : undefined;
    const corrected = issue.disposition === 'correct' && correction && correction.version > issue.claimRef.version && isSupported(correction)
      && key(correction) === key(issue.revisedClaimRef!);
    issue.state = corrected ? 'resolved' : ['limit', 'defer', 'respond'].includes(issue.disposition) ? 'limited' : 'pending';
  }
  const lines = [config.line, ...(config.lines ?? [])].map(line => {
    const relevant = claims.filter(claim => (claim.lineIds ?? [config.line.id]).includes(line.id));
    const evidenceIds = relevant.flatMap(claim => claim.evidenceIds);
    return { ...line, claimRefs: relevant.map(claim => ({id:claim.id,version:claim.version})),
      issueIds: issues.filter(issue => relevant.some(claim => claim.id === issue.claimRef.id)).map(issue => issue.id),
      taskRefs: [...new Set(records.filter(record => record.payload.claims.some(claim => (claim.lineIds ?? [config.line.id]).includes(line.id)) || [...record.payload.reviews.map(review => review.claimRef), ...record.payload.issues.map(issue => issue.claimRef), ...(record.payload.report?.claimRefs ?? [])].some(ref => relevant.some(claim => claim.id === ref.id))).map(record => record.producedBy.nodeId))],
      sourceIds: [...new Set([...(line.sourceIds ?? []), ...allEvidence.filter(evidence => evidenceIds.includes(evidence.id)).map(evidence => evidence.sourceId)])] };
  });
  const dimensions = lines.flatMap(line => config.dimensions.map(dimension => {
    const relevant = claims.filter(value => value.dimensionIds.includes(dimension.id) && (value.lineIds ?? [config.line.id]).includes(line.id));
    return { ...dimension, lineId: line.id, state: relevant.length && relevant.every(isSupported) ? 'covered' as const : relevant.length ? 'limited' as const : 'uncovered' as const,
      claimRefs: relevant.map(value => ({ id: value.id, version: value.version })) };
  }));
  const relations = records.flatMap(record => (record.payload.relations ?? []).map(relation => ({...relation,producedBy:record.producedBy,current:[relation.from,relation.to].every(ref => current.get(ref.id)?.version === ref.version && !invalidated.has(key(ref)))})));
  const reportRecord = [...records].reverse().find(record => record.payload.report);
  const report = reportRecord?.payload.report ? { ...reportRecord.payload.report, producedBy: reportRecord.producedBy } : undefined;
  const blockers: string[] = [];
  for (const value of claims) {
    const mandatory = value.critical || value.recommendation || value.keyNumber || config.dimensions.some(dimension => dimension.required && value.dimensionIds.includes(dimension.id));
    if (mandatory && !value.review) blockers.push(`Claim ${key(value)} requires independent review`);
    if (mandatory && value.review && !isSupported(value) && !issues.some(issue => key(issue.claimRef) === key(value) && issue.reason.trim())) blockers.push(`Claim ${key(value)} requires explicit issue disposition`);
  }
  if (report) {
    if (errata.length && !report.changeEvidence?.length) blockers.push('Report must disclose append-only errata and affected historical conclusions/reports');
    for (const value of errata) if (!report.erratumIds?.includes(value.id)) blockers.push(`Report must cite appended erratum ${value.id}`);
    if (lines.length > 1 && (!report.alternatives?.length || !report.changeEvidence?.length)) blockers.push('Conditional report must describe alternatives and evidence that could change the conclusions');
    for (const ref of report.claimRefs) {
      const value = current.get(ref.id);
      if (!value || value.version !== ref.version || !isSupported(value)) blockers.push(`Report cites an outdated or unsupported claim ${key(ref)}`);
    }
    if (dimensions.some(dimension => dimension.required && dimension.state !== 'covered') && !report.limitations.length) blockers.push('Report must disclose dimensions without evidence coverage');
    if (claims.some(value => !isSupported(value)) && !report.unresolved.length) blockers.push('Report must disclose unresolved research');
    if (issues.some(issue => issue.state !== 'resolved') && !report.unresolved.length) blockers.push('Report must disclose unresolved issue dispositions');
    for (const value of claims.filter(value => value.critical || value.recommendation || value.keyNumber)) {
      if (isSupported(value) && !report.claimRefs.some(ref => key(ref) === key(value))) blockers.push(`Report omits current critical conclusion ${key(value)}`);
    }
  } else blockers.push('Research report has not been produced');
  return { assuranceVersion: config.assuranceVersion, line: config.line, lines, questions: config.questions ?? [], relations, sources, records, reads, sourceBundle, dimensions,
    coverage: { covered: dimensions.filter(dimension => dimension.state === 'covered').length,
      limited: dimensions.filter(dimension => dimension.state === 'limited').length, uncovered: dimensions.filter(dimension => dimension.state === 'uncovered').length, total: dimensions.length },
    claims, issues, errata, report, blockers };
}

/** Visible report is rendered from the same approved versions used by the gate. */
export function renderResearchReport(summary: ResearchSummary): string {
  const refs = summary.report?.claimRefs ?? [];
  const claims = summary.claims.filter(claim => refs.some(ref => key(ref) === key(claim)));
  const evidence = summary.records.flatMap(record => record.payload.evidence);
  return [summary.lines.length > 1 ? '条件式研究报告' : summary.line.question, ...(summary.lines.length === 1 ? summary.line.premises.map(premise => `成立前提：${premise}`) : []), '',
    ...claims.flatMap(claim => [...summary.lines.filter(line => (claim.lineIds ?? [summary.line.id]).includes(line.id)).flatMap(line => [`研究线：${line.id} · ${line.question}`, ...line.premises.map(premise => `成立前提：${premise}`)]), claim.text, ...claim.conditions.map(condition => `适用条件：${condition}`),
      ...claim.evidenceIds.flatMap(id => { const item = evidence.find(value => value.id === id); const source = summary.sources.find(source => source.id === item?.sourceId);
        return item && source ? [`来源：${source.ref} @ ${source.version}，行 ${item.locator.startLine}–${item.locator.endLine}：${item.excerpt}`] : []; }),
      ...(claim.inputClaimRefs?.length ? [`依据结论版本：${claim.inputClaimRefs.map(key).join(', ')}`] : []),
      ...(claim.review && claim.reviewer ? [`独立审查：${key(claim)} · ${claim.review.finding}；记录 ${claim.reviewer.runId}/${claim.reviewer.nodeId}@${claim.reviewer.artifactVersion}`] : []),
      ...(claim.review?.limitations ?? []).map(limit => `来源限制：${limit}`), '']),
    ...summary.dimensions.map(dimension => `${dimension.lineId}/${dimension.id}：${dimension.state}`),
    ...(summary.report?.limitations ?? []).map(limit => `限制：${limit}`),
    ...(summary.report?.alternatives ?? []).map(item => `替代解释：${item}`),
    ...(summary.report?.changeEvidence ?? []).map(item => `可能改变结论的证据：${item}`),
    ...summary.relations.filter(relation => relation.current).map(relation => `研究关系：${key(relation.from)} ${relation.type} ${key(relation.to)}；${relation.reason}`),
    ...summary.errata.map(value => `追加勘误：${value.id} · ${value.target.kind === 'claim' ? key(value.target.claimRef) : `${value.target.sourceId}@${value.target.sourceVersion}`} · ${value.reason}；影响 ${value.affectedClaimRefs.map(key).join(', ')}；${value.state}`),
    ...(summary.report?.unresolved ?? []).map(item => `未决问题：${item}`),
    `可追溯版本：${refs.map(key).join(', ')}`].join('\n');
}
