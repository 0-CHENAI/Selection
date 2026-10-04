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
    <h3 className="font-semibold">{t('tasks.research.title')} · {research.line.question}</h3>
    <p className="text-muted-foreground">{t('tasks.research.coverageHint')}</p>
    <dl className="grid grid-cols-3 gap-2" aria-live="polite">{(['covered', 'limited', 'uncovered'] as const).map(state => <div key={state} className="rounded-md bg-foreground/[0.04] p-2"><dt>{t(`tasks.research.${state}`)}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{research.coverage[state]}<span className="text-xs font-normal text-muted-foreground"> / {research.coverage.total}</span></dd></div>)}</dl>
    <ul className="space-y-1">{research.dimensions.map(dimension => <li key={dimension.id}><span className="font-medium">{dimension.id} · {t(`tasks.research.${dimension.state}`)}</span> — {dimension.requirement}</li>)}</ul>
    {!!research.line.premises.length && <p>{t('tasks.research.premises')}: {research.line.premises.join('；')}</p>}
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
    {research.report && <div className="space-y-1 border-t border-border pt-2"><p className="font-medium">{t('tasks.research.reportVersions')}: {research.report.claimRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}</p>{research.report.limitations.map((limit, index) => <p key={index}>{t('tasks.research.limits')}: {limit}</p>)}{research.report.unresolved.map((item, index) => <p key={index}>{t('tasks.research.unresolved')}: {item}</p>)}<Receipt producer={research.report.producedBy} onOpenSession={onOpenSession} /></div>}
    {!!research.blockers.length && <details><summary className="cursor-pointer text-warning">{t('tasks.research.pendingDelivery')} ({research.blockers.length})</summary><ul className="mt-1 list-inside list-disc">{research.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></details>}
  </section>
}
