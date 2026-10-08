import type { ResearchConfig, ResearchRecord, ResearchSummary, ResearchProducer, ResearchPayload } from './research';
import { planValueKey } from './plan';

type Critique = NonNullable<ResearchPayload['premiseReviews']>[number];
type Candidate = NonNullable<ResearchPayload['branchCandidates']>[number];
const refKey = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
const linesOf = (claim: { lineIds?: string[] }, config: ResearchConfig) => claim.lineIds ?? [config.line.id];
const important = (claim: ResearchPayload['claims'][number], config: ResearchConfig) => claim.critical || claim.keyNumber || claim.recommendation
  || claim.dimensionIds.some(id => config.dimensions.some(dimension => dimension.id === id && dimension.required));

/** Model judgments remain semantic judgments; the host checks identity, independence and disposition. */
export function validateResearchJudgment(config: ResearchConfig, previous: ResearchRecord[], record: ResearchRecord, tasks?: ReadonlySet<string>): string[] {
  const errors: string[] = [], lines = [config.line, ...(config.lines ?? [])];
  const authored = previous.flatMap(record => record.payload.claims.map(claim => ({ ...claim, producer: record.producedBy })));
  const oldCritiques = previous.flatMap(record => record.payload.premiseReviews ?? []);
  const oldCandidates = previous.flatMap(record => record.payload.branchCandidates ?? []);
  const { payload } = record;
  if (record.role !== 'reviewer' && (payload.premiseReviews?.length || payload.branchCandidates?.length)) errors.push('Premise critique and alternative candidates require an independent reviewer');
  for (const critique of payload.premiseReviews ?? []) {
    if (oldCritiques.some(old => old.id === critique.id)) errors.push(`Premise critique ${critique.id} is immutable`);
    const line = lines.find(line => line.id === critique.lineId);
    if (!line) errors.push(`Unknown premise line ${critique.lineId}`);
    else if (planValueKey(line.premises) !== planValueKey(critique.premises)) {
      const index = Array.from({ length: Math.max(line.premises.length, critique.premises.length) }, (_, i) => i)
        .find(i => line.premises[i] !== critique.premises[i])!;
      errors.push(`Premise critique must preserve the exact premises of ${critique.lineId}; premises[${index}] received ${JSON.stringify(critique.premises[index] ?? null)}; expected ${JSON.stringify(line.premises[index] ?? null)}. Replace this exact entry with the canonical text; do not paraphrase it.`);
    }
    for (const ref of critique.claimRefs) {
      const target = authored.find(claim => refKey(claim) === refKey(ref));
      if (!target || !linesOf(target, config).includes(critique.lineId)) errors.push(`Unknown premise input ${refKey(ref)} in ${critique.lineId}`);
      else if (target.producer.sessionId === record.producedBy.sessionId) errors.push('Premise critique context is not independent');
    }
    if (critique.classification === 'alternative-premise' && ![...oldCandidates, ...(payload.branchCandidates ?? [])].some(candidate => candidate.critiqueId === critique.id)) errors.push(`Alternative premise critique ${critique.id} requires an explicit branch candidate`);
  }
  for (const candidate of payload.branchCandidates ?? []) {
    if (oldCandidates.some(old => old.id === candidate.id)) errors.push(`Branch candidate ${candidate.id} is immutable`);
    const critique = [...oldCritiques, ...(payload.premiseReviews ?? [])].find(item => item.id === candidate.critiqueId);
    const parent = lines.find(line => line.id === candidate.parentLineId);
    if (!parent || !critique || critique.lineId !== parent.id || critique.classification !== 'alternative-premise') errors.push(`Branch candidate ${candidate.id} requires a matching alternative-premise critique`);
    if (parent && planValueKey([...parent.premises].sort()) === planValueKey([...candidate.premises].sort())) errors.push('Factual repair or evidence gaps cannot create an identical-premise branch');
    if ([...oldCandidates, ...(payload.branchCandidates ?? [])].some(other => other.id !== candidate.id && other.critiqueId === candidate.critiqueId)) errors.push('Each alternative-premise critique must identify one canonical candidate');
  }
  if (payload.report) {
    const selected = payload.report.lineIds ?? lines.map(line => line.id);
    if (new Set(selected).size !== selected.length || selected.some(id => !lines.some(line => line.id === id))) errors.push('Report has duplicate or unknown research lines');
    if (payload.report.claimRefs.some(ref => {
      const claim = authored.find(claim => refKey(claim) === refKey(ref));
      return claim && !linesOf(claim, config).some(id => selected.includes(id));
    })) errors.push('Local report cites a conclusion outside its selected research lines');
    const ids = payload.report.branchCandidateIds ?? [];
    if (new Set(ids).size !== ids.length || ids.some(id => !oldCandidates.some(candidate => candidate.id === id))) errors.push('Report has duplicate or unknown branch candidates');
  }
  for (const disposition of config.branchDispositions ?? []) {
    if (![...oldCandidates, ...(payload.branchCandidates ?? [])].some(candidate => candidate.id === disposition.candidateId)) errors.push(`Unknown configured branch candidate ${disposition.candidateId}`);
    if (disposition.taskRef && tasks && !tasks.has(disposition.taskRef)
      && !previous.some(record => record.producedBy.nodeId === disposition.taskRef)) errors.push(`Unknown canonical branch task ${disposition.taskRef}`);
  }
  return errors;
}

export function summarizeResearchJudgment(config: ResearchConfig, records: ResearchRecord[], claims: ResearchSummary['claims'], issues: ResearchSummary['issues'], report: ResearchSummary['report'], selected: string[]) {
  const lines = [config.line, ...(config.lines ?? [])];
  const critiques: Array<Critique & { producedBy: ResearchProducer; current: boolean }> = records.flatMap(record => (record.payload.premiseReviews ?? []).map(value => ({
    ...value, producedBy: record.producedBy, current: planValueKey(lines.find(line => line.id === value.lineId)?.premises) === planValueKey(value.premises)
      && value.claimRefs.every(ref => claims.some(claim => refKey(claim) === refKey(ref) && claim.producedBy.sessionId !== record.producedBy.sessionId)),
  })));
  const candidates: Array<Candidate & { producedBy: ResearchProducer; disposition?: NonNullable<ResearchConfig['branchDispositions']>[number] }> = records.flatMap(record => (record.payload.branchCandidates ?? []).map(value => ({
    ...value, producedBy: record.producedBy, disposition: config.branchDispositions?.find(disposition => disposition.candidateId === value.id),
  })));
  const blockers: string[] = [];
  const stages = lines.map(line => {
    const relevant = claims.filter(claim => linesOf(claim, config).includes(line.id));
    const mandatory = relevant.filter(claim => important(claim, config));
    const pendingReviews = mandatory.filter(claim => !claim.review || !critiques.some(critique => critique.current && critique.lineId === line.id && critique.claimRefs.some(ref => refKey(ref) === refKey(claim))));
    const unresolved = issues.filter(issue => issue.state === 'pending' && relevant.some(claim => claim.id === issue.claimRef.id));
    const pendingCandidates = candidates.filter(candidate => candidate.parentLineId === line.id && !candidate.disposition);
    const missingConditions = mandatory.filter(claim => !claim.falsificationConditions?.length);
    const undisposedCritiques = critiques.filter(critique => critique.current && critique.lineId === line.id
      && ['fact-error', 'evidence-gap'].includes(critique.classification)
      && critique.claimRefs.some(ref => !issues.some(issue => refKey(issue.claimRef) === refKey(ref) && issue.state !== 'pending')));
    if (selected.includes(line.id)) {
      for (const claim of pendingReviews) blockers.push(`Claim ${refKey(claim)} requires current independent premise critique for ${line.id}`);
      for (const claim of missingConditions) blockers.push(`Claim ${refKey(claim)} requires explicit falsification conditions`);
      for (const candidate of pendingCandidates) blockers.push(`Branch candidate ${candidate.id} requires an open or not-adopt disposition`);
      for (const issue of unresolved) blockers.push(`Research stage ${line.id} still requires correction or an explicit limited disposition for ${issue.id}`);
      for (const critique of undisposedCritiques) blockers.push(`Premise critique ${critique.id} requires same-line correction or an explicit limited disposition`);
      for (const candidate of candidates.filter(candidate => candidate.parentLineId === line.id)) if (report && !report.branchCandidateIds?.includes(candidate.id)) blockers.push(`Report must disclose branch candidate ${candidate.id} and its disposition`);
    }
    const isSupported = (claim: typeof mandatory[number]) => claim.review?.citationExists && claim.review.support === 'supported';
    const cited = mandatory.filter(isSupported).every(claim => report?.claimRefs.some(ref => refKey(ref) === refKey(claim)));
    const supported = mandatory.every(claim => claim.review?.citationExists && claim.review.support === 'supported');
    const reported = !!report && cited && (!report.lineIds || report.lineIds.includes(line.id));
    const state = !relevant.length ? 'draft' : pendingReviews.length ? 'pending-review'
      : unresolved.length || pendingCandidates.length || missingConditions.length || undisposedCritiques.length ? 'needs-work'
      : reported && supported ? 'deliverable'
      : reported && report!.limitations.length && report!.unresolved.length ? 'limited-delivery'
      : supported ? 'reviewed' : 'needs-work';
    return { lineId: line.id, state, pendingClaimRefs: pendingReviews.map(claim => ({ id: claim.id, version: claim.version })),
      pendingCandidateIds: pendingCandidates.map(candidate => candidate.id), issueIds: unresolved.map(issue => issue.id) };
  });
  return { version: 1 as const, critiques, candidates, stages, blockers };
}
