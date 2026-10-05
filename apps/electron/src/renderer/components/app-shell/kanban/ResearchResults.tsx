import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ResearchSummary, ResearchProducer } from '@craft-agent/shared/tasks/research'

function Receipt({ producer, onOpenSession }: { producer: ResearchProducer; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  return <div className="mt-1 break-words font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
    <p>{producer.runId} · {producer.nodeId} · r{producer.revision} · {t('tasks.nodeAttempt')} {producer.attempt}</p>
    <p>{producer.artifactVersion}</p>
    {onOpenSession ? <button type="button" className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenSession(producer.sessionId)}>{t('tasks.openChildSession')}</button> : <p>{producer.sessionId}</p>}
  </div>
}

export function ResearchResults({ research, onOpenSession }: { research?: ResearchSummary; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  if (!research) return null
  const evidence = research.records.flatMap(record => record.payload.evidence)
  return <section aria-label={t('tasks.research.title')} className="min-w-0 space-y-3 rounded-lg border border-border p-3 text-xs [overflow-wrap:anywhere]">
    <h3 className="font-semibold">{t('tasks.research.title')}{research.lines.length === 1 && <> · {research.line.question}</>}</h3>
    <p className="text-muted-foreground">{t('tasks.research.coverageHint')}</p>
    <ResearchJudgment research={research} onOpenSession={onOpenSession} />
    <dl className="grid grid-cols-3 gap-2" aria-live="polite">{(['covered', 'limited', 'uncovered'] as const).map(state => <div key={state} className="rounded-md bg-foreground/[0.04] p-2"><dt>{t(`tasks.research.${state}`)}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{research.coverage[state]}<span className="text-xs font-normal text-muted-foreground"> / {research.coverage.total}</span></dd></div>)}</dl>
    <ul className="space-y-1">{research.dimensions.map(dimension => <li key={`${dimension.lineId}/${dimension.id}`}><span className="font-medium">{dimension.lineId}/{dimension.id} · {t(`tasks.research.${dimension.state}`)}</span> — {dimension.requirement}</li>)}</ul>
    {research.lines.length === 1 && !!research.line.premises.length && <p>{t('tasks.research.premises')}: {research.line.premises.join('；')}</p>}
    {research.lines.length > 1 && <details open><summary className="cursor-pointer font-medium">{t('tasks.research.lines')} ({research.lines.length})</summary><ul className="mt-2 space-y-2">{research.lines.map(line => <li key={line.id} className="rounded-md border border-border p-2"><p className="font-medium">{line.id} · {line.question}</p><p>{t('tasks.research.premises')}: {line.premises.join('；')}</p><p>{t('tasks.research.sources')}: {line.sourceIds.join(', ')}</p><p>{t('tasks.research.claims')}: {line.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p><p>{t('tasks.research.issues')}: {line.issueIds.join(', ')}</p><p>{t('tasks.research.tasks')}: {line.taskRefs.join(', ')}</p>{!!line.parentLineIds?.length && <p>{t('tasks.research.parents')}: {line.parentLineIds.join(', ')}</p>}</li>)}</ul></details>}
    {!!research.questions.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.sharedQuestions')} ({research.questions.length})</summary>{research.questions.map(question => <div key={question.id} className="mt-2 space-y-1 rounded-md border border-border p-2"><p className="font-medium">{question.id} · {question.question} → {question.sharedTaskRef}</p><p>{question.compatibilityReason}</p><p>{question.commonBackground.join('；')}</p><dl>{Object.entries(question.scope).map(([field,value]) => <div key={field} className="flex flex-wrap gap-1"><dt>{t(`tasks.research.scope.${field}`)}:</dt><dd>{value}</dd></div>)}</dl>{question.parents.map(parent => <details key={parent.lineId}><summary className="cursor-pointer">{t('tasks.research.parents')}: {parent.lineId} · {parent.premises.join('；')}</summary><p>{parent.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p><p>{parent.evidenceRefs.join(', ')} · {parent.issueRefs.join(', ')}</p><p>{parent.path.join(' → ')}</p></details>)}</div>)}</details>}
    <ResearchSourceBundle research={research} onOpenSession={onOpenSession} />
    {!!research.errata?.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.errata')} ({research.errata.length})</summary><ul className="mt-2 space-y-2">{research.errata.map(value => <li key={`${value.producedBy.runId}/${value.id}`} className="rounded-md border border-border p-2"><p className="font-medium">{value.id} · {t(`tasks.research.erratumState.${value.state}`)}</p><p>{value.reason}</p><p>{t('tasks.research.affectedClaims')}: {value.affectedClaimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p>{!!value.affectedReports.length && <p>{t('tasks.research.affectedReports')}: {value.affectedReports.map(report => `${report.runId}/${report.nodeId}@${report.artifactVersion}`).join(', ')}</p>}<Receipt producer={value.producedBy} onOpenSession={onOpenSession} /></li>)}</ul></details>}
    {!!research.relations.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.relations')} ({research.relations.length})</summary>{research.relations.map(relation => <div key={relation.id} className="mt-2 rounded-md border border-border p-2"><p>{relation.from.id}@{relation.from.version} · {t(`tasks.research.relation.${relation.type}`)} · {relation.to.id}@{relation.to.version}</p><p>{relation.reason}</p>{!relation.current && <p className="text-muted-foreground">{t('tasks.research.historicalRelation')}</p>}<Receipt producer={relation.producedBy} onOpenSession={onOpenSession} /></div>)}</details>}
    <details>
      <summary className="cursor-pointer font-medium">{t('tasks.research.claims')} ({research.claims.length})</summary>
      <ul className="mt-2 space-y-3">{research.claims.map(claim => <li key={claim.id} className="rounded-md border border-border p-2">
        <p className="font-medium">{claim.id}@{claim.version} · {t(`tasks.research.type.${claim.type}`)} · {t(`tasks.research.support.${claim.review?.support ?? 'unverified'}`)}</p>
        <p className="mt-1 whitespace-pre-wrap">{claim.text}</p>
        {!!claim.conditions.length && <p className="mt-1">{t('tasks.research.conditions')}: {claim.conditions.join('；')}</p>}
        <Receipt producer={claim.producedBy} onOpenSession={onOpenSession} />
        {claim.review && <div className="mt-2 border-t border-border pt-2"><p>{t('tasks.research.citation')}: {t(`tasks.research.${claim.review.citationExists ? 'located' : 'unlocated'}`)} · {claim.review.finding}</p>{claim.review.limitations.map((limit, index) => <p key={index}>{t('tasks.research.limits')}: {limit}</p>)}{claim.reviewer && <Receipt producer={claim.reviewer} onOpenSession={onOpenSession} />}</div>}
        {claim.evidenceIds.map(id => { const item = evidence.find(item => item.id === id), source = research.sources.find(source => source.id === item?.sourceId); return item && source ? <details key={id} className="mt-2"><summary className="cursor-pointer">{id} · {source.ref} · {item.locator.startLine}–{item.locator.endLine}</summary><p>{source.version} · {source.acquiredAt}</p><blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2">{item.excerpt}</blockquote>{source.unavailableReason && <p className="text-warning">{source.unavailableReason}</p>}</details> : <p key={id}>{id} · {t('tasks.research.unlocated')}</p> })}
      </li>)}</ul>
    </details>
    {!!research.issues.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.issues')} ({research.issues.length})</summary><ul className="mt-2 space-y-2">{research.issues.map(issue => <li key={issue.id} className="rounded-md border border-border p-2"><p className="font-medium">{issue.id} · {issue.claimRef.id}@{issue.claimRef.version} · {t(`tasks.research.issueState.${issue.state}`)}</p><p>{issue.finding}</p><p>{t(`tasks.research.disposition.${issue.disposition}`)} · {issue.reason}</p>{issue.revisedClaimRef && <p>→ {issue.revisedClaimRef.id}@{issue.revisedClaimRef.version}</p>}{issue.followupTaskRef && <p>→ {issue.followupTaskRef}</p>}<Receipt producer={issue.producedBy} onOpenSession={onOpenSession} /></li>)}</ul></details>}
    {research.report && <div className="space-y-1 border-t border-border pt-2"><p className="font-medium">{t('tasks.research.reportVersions')}: {research.report.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p>{research.report.limitations.map((limit, index) => <p key={index}>{t('tasks.research.limits')}: {limit}</p>)}{research.report.alternatives?.map((item,index) => <p key={`alternative-${index}`}>{t('tasks.research.alternatives')}: {item}</p>)}{research.report.changeEvidence?.map((item,index) => <p key={`change-${index}`}>{t('tasks.research.changeEvidence')}: {item}</p>)}{research.report.unresolved.map((item, index) => <p key={index}>{t('tasks.research.unresolved')}: {item}</p>)}<Receipt producer={research.report.producedBy} onOpenSession={onOpenSession} /></div>}
    {!!research.blockers.length && <details><summary className="cursor-pointer text-warning">{t('tasks.research.pendingDelivery')} ({research.blockers.length})</summary><ul className="mt-1 list-inside list-disc">{research.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></details>}
  </section>
}

function ResearchJudgment({ research, onOpenSession }: { research: ResearchSummary; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  const judgment = research.judgment
  if (!judgment) return <p className="text-muted-foreground">{t('tasks.research.judgment.unrecorded')}</p>
  return <div className="space-y-2 border-t border-border pt-2">
    <h4 className="font-medium">{t('tasks.research.judgment.title')}</h4>
    <p className="text-muted-foreground">{t('tasks.research.judgment.hint')}</p>
    <ul className="space-y-1">{judgment.stages.map(stage => <li key={stage.lineId} className="flex min-w-0 items-baseline justify-between gap-3"><span className="truncate">{research.lines.find(line => line.id === stage.lineId)?.question ?? stage.lineId}</span><span className="shrink-0 text-muted-foreground">{t(`tasks.research.judgment.stage.${stage.state}`)}</span></li>)}</ul>
    <details><summary className="cursor-pointer font-medium">{t('tasks.research.judgment.falsification')}</summary><ul className="mt-2 space-y-2">{research.claims.map(claim => <li key={`${claim.id}@${claim.version}`}><p>{claim.id}@{claim.version}</p>{claim.falsificationConditions?.length ? claim.falsificationConditions.map((condition, index) => <p key={index} className="text-muted-foreground">{condition}</p>) : <p className="text-muted-foreground">{t('tasks.research.judgment.unrecorded')}</p>}</li>)}</ul></details>
    {!!judgment.critiques.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.judgment.critique')} ({judgment.critiques.length})</summary><ul className="mt-2 space-y-2">{judgment.critiques.map(critique => <li key={critique.id} className="rounded-md border border-border p-2"><p>{critique.lineId} · {critique.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p><p className="text-muted-foreground">{t(`tasks.research.judgment.${critique.current ? 'current' : 'superseded'}`)}</p><p>{critique.finding}</p>{critique.changeEvidence.map((item, index) => <p key={index} className="text-muted-foreground">{item}</p>)}<Receipt producer={critique.producedBy} onOpenSession={onOpenSession} /></li>)}</ul></details>}
    {!!judgment.candidates.length && <details><summary className="cursor-pointer font-medium">{t('tasks.research.judgment.candidates')} ({judgment.candidates.length})</summary><ul className="mt-2 space-y-2">{judgment.candidates.map(candidate => <li key={candidate.id} className="rounded-md border border-border p-2"><p className="font-medium">{candidate.question}</p><p>{candidate.premises.join('；')}</p><p className="text-muted-foreground">{candidate.disposition ? t(`tasks.research.judgment.${candidate.disposition.action}`) : t('tasks.research.judgment.undecided')} · {candidate.disposition?.reason ?? candidate.reason}</p><Receipt producer={candidate.producedBy} onOpenSession={onOpenSession} /></li>)}</ul></details>}
  </div>
}

function ResearchSourceBundle({ research, onOpenSession }: { research: ResearchSummary; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  const bundle = research.sourceBundle
  if (!bundle) return null
  const read = (receipt: ResearchSummary['reads'][number]) => <li key={receipt.id} className="space-y-1 border-l border-border pl-2">
    <p>{receipt.sourceId} · {t('tasks.research.readRange', { start: receipt.startLine, end: receipt.endLine })}</p>
    <p className="font-mono text-muted-foreground">{receipt.producedBy.runId} / {receipt.producedBy.nodeId} · r{receipt.producedBy.revision} · {t('tasks.nodeAttempt')} {receipt.producedBy.attempt}</p>
    <p className="text-muted-foreground">{receipt.receivedAt}</p>
    {onOpenSession && <button type="button" className="text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenSession(receipt.producedBy.sessionId)}>{t('tasks.openChildSession')}</button>}
  </li>
  return <details>
    <summary className="cursor-pointer font-medium">{t('tasks.research.sourceBundle')} ({bundle.cited.length})</summary>
    <div className="mt-2 space-y-3">
      <p className="text-muted-foreground">{t('tasks.research.readReceiptHint')}</p>
      <p className="font-medium">{t('tasks.research.citedSources')}</p>
      {bundle.cited.map(source => <details key={`${source.sourceId}@${source.sourceVersion}`} className="rounded-md border border-border p-2">
        <summary className="cursor-pointer">{research.sources.find(item => item.id === source.sourceId && item.version === source.sourceVersion)?.ref ?? source.sourceId} · {source.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</summary>
        <p className="mt-1 font-mono text-muted-foreground">{source.sourceVersion}</p>
        {source.readIds.length ? <ul className="mt-2 space-y-2">{research.reads.filter(receipt => source.readIds.includes(receipt.id)).map(read)}</ul> : <p>{t('tasks.research.unrecordedReads')}</p>}
      </details>)}
      {!!bundle.readNotCited.length && <details><summary className="cursor-pointer">{t('tasks.research.readNotCited')} ({bundle.readNotCited.length})</summary><ul className="mt-2 space-y-2">{bundle.readNotCited.map(read)}</ul></details>}
      {!!bundle.unresolved.length && <details><summary className="cursor-pointer text-warning">{t('tasks.research.unresolvedReferences')} ({bundle.unresolved.length})</summary><ul className="mt-1 space-y-1">{bundle.unresolved.map((item, index) => <li key={index}>{item.claimRef.id}@{item.claimRef.version} · {item.evidenceId} · {item.reason}</li>)}</ul></details>}
      {!!bundle.unrecorded.length && <p className="text-muted-foreground">{t('tasks.research.unrecordedReads')}: {bundle.unrecorded.join(', ')}</p>}
    </div>
  </details>
}
