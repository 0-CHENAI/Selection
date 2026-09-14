import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { WorkbenchResult } from '@craft-agent/shared/thought-workbench/types'

/** Historical proposal context, not a claim that later manual edits share that origin. */
export function ExecutionThoughtSources({ workspaceId, documentId, nodeId, onLocate }: {
  workspaceId: string
  documentId: string
  nodeId: string
  onLocate: (documentId: string, nodeId: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [records, setRecords] = React.useState<WorkbenchResult['executionSources']>()
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (!open) return
    let active = true
    setRecords(undefined); setError('')
    void window.electronAPI.thoughtWorkbench(workspaceId, { action: 'executionSources', id: documentId, nodeId }).then(result => {
      if (active) setRecords(result.executionSources ?? [])
    }).catch(reason => { if (active) setError(String(reason instanceof Error ? reason.message : reason)) })
    return () => { active = false }
  }, [open, workspaceId, documentId, nodeId])
  return <details className="border-t border-border pt-2" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">{t('thought.source')} · {t('thought.proposalHistory')}</summary>
    {open && <div className="mt-2 space-y-2">
      {error ? <p role="alert" className="break-words text-destructive">{error}</p> : !records ? <p role="status">{t('common.loading')}</p> : records.length === 0 ? <p>{t('tasks.notAvailable')}</p> :
        <ol className="space-y-3">{records.map(record => <li key={record.proposalId}>
          <p className="break-all font-mono text-xs">{record.proposalId} · v{record.appliedRevision}</p>
          <ul>{record.thoughtNodeIds.map(id => <li key={id}><Button variant="ghost" size="sm" className="h-auto max-w-full whitespace-normal break-all text-left" onClick={() => {
            try { onLocate(documentId, id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
          }}>{id}</Button></li>)}</ul>
        </li>)}</ol>}
    </div>}
  </details>
}
