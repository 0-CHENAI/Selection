import { useTranslation } from 'react-i18next'
import type { TaskHelpRecord } from '@craft-agent/shared/tasks'

export function TaskHelpHistory({ records, onOpenSession }: { records?: TaskHelpRecord[]; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation()
  if (!records?.length) return null
  return <details className="rounded-lg border border-border p-3 text-xs">
    <summary className="cursor-pointer font-medium">{t('tasks.help.history')} ({records.length})</summary>
    <ul className="mt-3 space-y-3">{records.map(record => <li key={record.id} className="space-y-1 break-words [overflow-wrap:anywhere]">
      <p className="font-medium">{record.nodeId} · {t(`tasks.help.${record.state}`)}</p>
      <p>{record.problem}</p>
      <p className="text-muted-foreground">{t('tasks.help.tried')}: {record.tried.join('；')}</p>
      <p>{t('tasks.help.needed')}: {record.needed}</p>
      <p className="font-mono text-muted-foreground">{record.runId} · r{record.revision} · {t('tasks.nodeAttempt')} {record.attempt} · g{record.generation}</p>
      <p className="font-mono text-muted-foreground">{[...record.claimRefs.map(ref => `${ref.id}@${ref.version}`), ...record.sourceRefs.map(ref => `${ref.id}@${ref.version}`)].join(', ')}</p>
      {record.responses.map(response => <p key={response.id}>{response.text}</p>)}
      {record.cancellationReason && <p className="text-muted-foreground">{record.cancellationReason}</p>}
      {onOpenSession && <button type="button" onClick={() => onOpenSession(record.sessionId)} className="text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('tasks.openChildSession')}</button>}
    </li>)}</ul>
  </details>
}
