import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ThoughtGenerationOutput } from './ThoughtGenerationOutput'
import type { ThoughtGeneration, WorkbenchRequest, WorkbenchResult } from '@craft-agent/shared/thought-workbench/types'

const labels = { running: 'tasks.runStatusRunning', completed: 'tasks.runStatusCompleted', failed: 'tasks.runStatusFailed', interrupted: 'tasks.runStatusInterrupted' } as const

/** Receipts are inspectable, never replayed implicitly by opening history. */
export function ThoughtGenerationHistory({ documentId, nodeId, revision, request, onOpenSession }: {
  documentId: string
  nodeId: string
  revision: string
  request: (input: WorkbenchRequest) => Promise<WorkbenchResult>
  onOpenSession?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [records, setRecords] = React.useState<ThoughtGeneration[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(''); setRecords([])
    void request({ action: 'generations', id: documentId, nodeId }).then(result => {
      if (active) setRecords((result.generations ?? []).filter(item => item.documentId === documentId && item.nodeId === nodeId).reverse())
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, documentId, nodeId, revision, refresh, request])
  return <details className="space-y-2 border-t pt-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm">{t('tasks.runHistory')}</summary>
    {open && <>
      <Button variant="ghost" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{t('common.refresh')}</Button>
      {loading && <p role="status" className="text-sm">{t('common.loading')}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <ol className="space-y-3">{records.map(record => <li key={record.id} className="space-y-1 border-t pt-2 text-sm">
        <p>{t(labels[record.status])}{record.createdAt && <> · <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></>}</p>
        <p className="break-all font-mono text-xs">{record.id}</p>
        {record.error && <p className="whitespace-pre-wrap break-words text-destructive">{record.error}</p>}
        <ThoughtGenerationOutput generation={record} />
        {record.answer && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">{record.answer}</pre>}
        {onOpenSession && record.mode === 'agent' && !record.detached && <Button variant="ghost" onClick={() => onOpenSession(record.sessionId)}>{t('tasks.openSession')}</Button>}
      </li>)}</ol>
    </>}
  </details>
}
