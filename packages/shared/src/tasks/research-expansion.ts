import { ResearchConfigSchema, ResearchExpansionSchema, type ResearchConfig, type ResearchRecord, type ResearchSummary } from './research.ts';
import { planValueKey } from './plan.ts';

/** Append-only business identities travel in the existing atomic plan transaction. */
export function expandResearch(config: ResearchConfig | undefined, raw: unknown, tasks: ReadonlyMap<string, { researchRole?: string }>, records: ResearchRecord[] = []): ResearchConfig {
  if (!config) throw new Error('Research expansion requires configured research');
  const expansion = ResearchExpansionSchema.parse(raw);
  const lines = [...(config.lines ?? [])], questions = [...(config.questions ?? [])];
  for (const line of expansion.lines ?? []) {
    const old = [config.line, ...lines].find(old => old.id === line.id);
    if (old && planValueKey(old) !== planValueKey(line)) throw new Error(`Cannot change premises of existing research line ${line.id}`);
    if (!old) lines.push(line);
  }
  const claims = records.flatMap(record => record.payload.claims), evidence = records.flatMap(record => record.payload.evidence), issues = records.flatMap(record => record.payload.issues);
  for (const question of expansion.questions ?? []) {
    const registered = questions.find(old => old.id === question.id);
    if (tasks.get(question.sharedTaskRef)?.researchRole !== 'researcher' && !(registered?.sharedTaskRef === question.sharedTaskRef && records.some(record => record.role === 'researcher' && record.producedBy.nodeId === question.sharedTaskRef))) throw new Error(`Shared question requires canonical researcher task ${question.sharedTaskRef}`);
    if (new Set(question.parents.map(parent => parent.lineId)).size !== question.parents.length) throw new Error('Duplicate shared question parent');
    for (const parent of question.parents) {
      const line = [config.line, ...lines].find(line => line.id === parent.lineId);
      if (!line || planValueKey(parent.premises) !== planValueKey(line.premises)) throw new Error(`Shared question must preserve premises of ${parent.lineId}`);
      if (planValueKey(parent.inputScope) !== planValueKey(question.scope)) throw new Error(`Incompatible shared question input scope for ${parent.lineId}`);
      for (const ref of parent.claimRefs) if (!claims.some(claim => claim.id === ref.id && claim.version === ref.version && (claim.lineIds ?? [config.line.id]).includes(parent.lineId))) throw new Error(`Unknown parent claim ${ref.id}@${ref.version}`);
      if (parent.evidenceRefs.some(id => !evidence.some(value => value.id === id) || !claims.some(claim => parent.claimRefs.some(ref => ref.id === claim.id && ref.version === claim.version) && claim.evidenceIds.includes(id)))) throw new Error('Unknown parent evidence');
      if (parent.issueRefs.some(id => !issues.some(value => value.id === id && parent.claimRefs.some(ref => ref.id === value.claimRef.id && ref.version === value.claimRef.version)))) throw new Error('Unknown parent issue or affected claim');
      if (!registered?.parents.some(old => planValueKey(old) === planValueKey(parent)) && parent.path.some(id => !tasks.has(id) && !records.some(record => record.producedBy.nodeId === id))) throw new Error('Unknown parent execution path');
    }
    const index = questions.findIndex(old => old.id === question.id), old = questions[index];
    if (old) {
      if (planValueKey({ ...old, parents: undefined, compatibilityReason: undefined }) !== planValueKey({ ...question, parents: undefined, compatibilityReason: undefined })) throw new Error(`Question ${question.id} already registered; reuse canonical task ${old.sharedTaskRef} and identical scope`);
      for (const parent of old.parents) if (!question.parents.some(next => planValueKey(next) === planValueKey(parent))) throw new Error(`Cannot discard or change parent context of ${question.id}`);
      questions[index] = question;
    } else questions.push(question);
    if (questions.some(other => other.id !== question.id && other.sharedTaskRef === question.sharedTaskRef)) throw new Error('Different logical questions cannot share one task identity');
  }
  return ResearchConfigSchema.parse({ ...config, lines, questions });
}

/** Prompt projection retains exact parent references without concatenating history or source bytes. */
export function researchTaskContext(summary: ResearchSummary, nodeId?: string, lineIds?: string[]): unknown {
  const questions = summary.questions.filter(question => !nodeId || question.sharedTaskRef === nodeId);
  const selected = lineIds?.length ? lineIds : questions.length ? questions.flatMap(question => question.parents.map(parent => parent.lineId)) : summary.lines.map(line => line.id);
  const claims = summary.claims.filter(claim => (claim.lineIds ?? [summary.line.id]).some(id => selected.includes(id)));
  const parentRefs = questions.flatMap(question => question.parents.flatMap(parent => parent.claimRefs));
  const parentClaims = summary.records.flatMap(record => record.payload.claims.filter(claim => parentRefs.some(ref => ref.id === claim.id && ref.version === claim.version) && !claims.some(current => current.id === claim.id && current.version === claim.version)).map(claim => ({...claim,producedBy:record.producedBy})));
  const evidenceIds = new Set([...claims.flatMap(claim => claim.evidenceIds), ...questions.flatMap(question => question.parents.flatMap(parent => parent.evidenceRefs))]);
  return { assuranceVersion: summary.assuranceVersion, reads: summary.reads, sourceBundle: summary.sourceBundle, line: summary.line, lines: summary.lines.filter(line => selected.includes(line.id)), questions,
    sources: summary.sources.map(({ text: _text, ...source }) => source), dimensions: summary.dimensions.filter(dimension => selected.includes(dimension.lineId)),
    claims, parentClaims, evidence: summary.records.flatMap(record => record.payload.evidence).filter(evidence => evidenceIds.has(evidence.id)),
    issues: summary.issues.filter(issue => claims.some(claim => claim.id === issue.claimRef.id)), relations: summary.relations,
    report: summary.report, blockers: summary.blockers };
}
