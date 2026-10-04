/** Research business records reference execution receipts; they never schedule work. */
import { z } from 'zod';
const id = z.string().min(1);
const version = z.number().int().positive();
export const ResearchConfigSchema = z.object({
  line: z.object({ id, question: id, premises: z.array(id).default([]) }).strict(),
  dimensions: z.array(z.object({ id, requirement: id, required: z.boolean().default(true) }).strict()).min(1),
  sources: z.array(z.object({ id, path: id, ref: id.optional() }).strict()).default([]),
}).strict().superRefine((config, ctx) => {
  for (const field of ['dimensions', 'sources'] as const) {
    if (new Set(config[field].map(item => item.id)).size !== config[field].length) ctx.addIssue({ code: 'custom', path: [field], message: `Duplicate ${field} identity` });
  }
});
export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
export interface ResearchSource {
  id: string; ref: string; version: string; hash?: string; acquiredAt: string;
  snapshotPath?: string; text?: string; unavailableReason?: string;
}
const claimRef = z.object({ id, version }).strict();
const evidence = z.object({ id, sourceId: id, sourceVersion: id,
  locator: z.object({ startLine: version, endLine: version }).strict(), excerpt: id }).strict();
const claim = z.object({ id, version, type: z.enum(['fact', 'inference', 'explanation', 'value']), text: id,
  dimensionIds: z.array(id).min(1), evidenceIds: z.array(id), critical: z.boolean(),
  recommendation: z.boolean().default(false), keyNumber: z.boolean().default(false), conditions: z.array(id).default([]) }).strict();
const review = z.object({ claimRef, citationExists: z.boolean(), support: z.enum(['supported', 'partial', 'contradicted', 'unverified']),
  finding: id, limitations: z.array(id).default([]) }).strict();
const issue = z.object({ id, claimRef, finding: id, disposition: z.enum(['correct', 'add-evidence', 'respond', 'limit', 'followup-task', 'defer']),
  reason: id, revisedClaimRef: claimRef.optional(), followupTaskRef: id.optional() }).strict();
export const ResearchPayloadSchema = z.object({
  evidence: z.array(evidence).default([]), claims: z.array(claim).default([]), reviews: z.array(review).default([]), issues: z.array(issue).default([]),
  report: z.object({ claimRefs: z.array(claimRef), limitations: z.array(id), unresolved: z.array(id) }).strict().optional(),
}).strict().superRefine((payload, ctx) => {
  for (const field of ['evidence', 'claims', 'issues'] as const) {
    const identities = payload[field].map(item => item.id);
    if (new Set(identities).size !== identities.length) ctx.addIssue({ code: 'custom', path: [field], message: `Duplicate ${field} identity` });
  }
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
  line: ResearchConfig['line']; sources: ResearchSource[]; records: ResearchRecord[];
  dimensions: Array<ResearchConfig['dimensions'][number] & { state: 'covered' | 'limited' | 'uncovered'; claimRefs: Array<{ id: string; version: number }> }>;
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
  for (const value of payload.evidence) {
    if (knownEvidence.some(old => old.id === value.id)) errors.push(`Evidence identity ${value.id} already exists; use a new evidence version identity`);
    if (!sources.some(source => source.id === value.sourceId && source.version === value.sourceVersion)) errors.push(`Unknown source version ${value.sourceId}@${value.sourceVersion}`);
  }
  for (const value of payload.claims) {
    const old = knownClaims.filter(old => old.id === value.id).at(-1);
    if (old && value.version <= old.version) errors.push(`Claim ${value.id} requires a new version after ${old.version}`);
    if (old && (old.critical && !value.critical || old.recommendation && !value.recommendation || old.keyNumber && !value.keyNumber)) errors.push(`Cannot remove importance from ${value.id}`);
    if (old && old.type === 'fact' && value.type !== 'fact') errors.push(`Cannot evade fact review by reclassifying ${value.id}`);
    if (old && old.dimensionIds.some(dimension => config.dimensions.some(item => item.id === dimension && item.required) && !value.dimensionIds.includes(dimension))) errors.push(`Cannot remove required dimensions from ${value.id}`);
    if (value.dimensionIds.some(dimension => !config.dimensions.some(item => item.id === dimension))) errors.push(`Unknown claim dimension for ${value.id}`);
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
  return errors;
}

/** Locator existence and semantic support are separate. Hash only identifies bytes. */
export function evidenceExists(value: ResearchPayload['evidence'][number], sources: ResearchSource[]): boolean {
  const source = sources.find(source => source.id === value.sourceId && source.version === value.sourceVersion);
  return source?.text !== undefined && !source.unavailableReason && value.locator.endLine >= value.locator.startLine
    && source.text.split('\n').slice(value.locator.startLine - 1, value.locator.endLine).join('\n').includes(value.excerpt);
}

export function summarizeResearch(config: ResearchConfig, sources: ResearchSource[], records: ResearchRecord[]): ResearchSummary {
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
  const isSupported = (value: ResearchSummary['claims'][number]) => value.review?.citationExists && value.review.support === 'supported';
  for (const issue of issues) {
    const target = current.get(issue.claimRef.id);
    const correction = issue.revisedClaimRef ? current.get(issue.revisedClaimRef.id) : target;
    const corrected = correction && correction.version > issue.claimRef.version && isSupported(correction)
      && (!issue.revisedClaimRef || key(correction) === key(issue.revisedClaimRef));
    issue.state = corrected ? 'resolved' : ['limit', 'defer', 'respond'].includes(issue.disposition) ? 'limited' : 'pending';
  }
  const dimensions = config.dimensions.map(dimension => {
    const relevant = claims.filter(value => value.dimensionIds.includes(dimension.id));
    return { ...dimension, state: relevant.length && relevant.every(isSupported) ? 'covered' as const : relevant.length ? 'limited' as const : 'uncovered' as const,
      claimRefs: relevant.map(value => ({ id: value.id, version: value.version })) };
  });
  const reportRecord = records.findLast(record => record.payload.report);
  const report = reportRecord?.payload.report ? { ...reportRecord.payload.report, producedBy: reportRecord.producedBy } : undefined;
  const blockers: string[] = [];
  for (const value of claims) {
    const mandatory = value.critical || value.recommendation || value.keyNumber || config.dimensions.some(dimension => dimension.required && value.dimensionIds.includes(dimension.id));
    if (mandatory && !value.review) blockers.push(`Claim ${key(value)} requires independent review`);
    if (mandatory && value.review && !isSupported(value) && !issues.some(issue => key(issue.claimRef) === key(value) && issue.reason.trim())) blockers.push(`Claim ${key(value)} requires explicit issue disposition`);
  }
  if (report) {
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
  return { line: config.line, sources, records, dimensions,
    coverage: { covered: dimensions.filter(dimension => dimension.state === 'covered').length,
      limited: dimensions.filter(dimension => dimension.state === 'limited').length, uncovered: dimensions.filter(dimension => dimension.state === 'uncovered').length, total: dimensions.length },
    claims, issues, report, blockers };
}

/** Visible report is rendered from the same approved versions used by the gate. */
export function renderResearchReport(summary: ResearchSummary): string {
  const refs = summary.report?.claimRefs ?? [];
  const claims = summary.claims.filter(claim => refs.some(ref => key(ref) === key(claim)));
  const evidence = summary.records.flatMap(record => record.payload.evidence);
  return [summary.line.question, ...summary.line.premises.map(premise => `成立前提：${premise}`), '',
    ...claims.flatMap(claim => [claim.text, ...claim.conditions.map(condition => `适用条件：${condition}`),
      ...claim.evidenceIds.flatMap(id => { const item = evidence.find(value => value.id === id); const source = summary.sources.find(source => source.id === item?.sourceId);
        return item && source ? [`来源：${source.ref} @ ${source.version}，行 ${item.locator.startLine}–${item.locator.endLine}：${item.excerpt}`] : []; }),
      ...(claim.review?.limitations ?? []).map(limit => `来源限制：${limit}`), '']),
    ...summary.dimensions.map(dimension => `${dimension.id}：${dimension.state}`),
    ...(summary.report?.limitations ?? []).map(limit => `限制：${limit}`),
    ...(summary.report?.unresolved ?? []).map(item => `未决问题：${item}`),
    `可追溯版本：${refs.map(key).join(', ')}`].join('\n');
}
