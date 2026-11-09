import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskRunSnapshotDto, TaskResultNodeDto } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'

export function TaskApproval({ workspaceId, run, nodeId, onChange }: {
  workspaceId: string; run: TaskRunSnapshotDto; nodeId: string;
  onChange: (run: TaskRunSnapshotDto) => void;
}) {
  const { t } = useTranslation()
  const node = run.nodes.find(n => n.id === nodeId)
  const [feedback, setFeedback] = React.useState(node?.approvalFeedback ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [context, setContext] = React.useState<TaskResultNodeDto[]>([])
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    setFeedback(node?.approvalFeedback ?? '')
  }, [node?.approvalFeedback])
  React.useEffect(() => {
    let active = true
    void window.electronAPI.getTaskResults(workspaceId, run.slug, run.runId).then(result => {
      if (active) setContext(result.nodes)
    }).catch(err => { if (active) setError(String(err)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, run.slug, run.runId])
  const definition = node?.approvalDefinition
  const prompt = definition?.prompt.replace(/\$\{nodes\.([\w-]+)\.output\}/g, (ref, id: string) => context.find(n => n.id === id)?.output ?? ref)
  const lock = React.useRef(false)
  async function respond(approved: boolean, feedbackOnly = false) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const res = await window.electronAPI.respondTaskApproval(workspaceId, {
        slug: run.slug, runId: run.runId, nodeId, approved, feedback, feedbackOnly,
      })
      onChange(res.snapshot)
      if (res.conflict) setError(res.conflict.message)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="space-y-2 rounded-lg border p-3" aria-busy={busy}>
    <p className="text-sm font-medium">{definition?.title || nodeId}</p>
    {prompt && <p className="whitespace-pre-wrap text-sm">{prompt}</p>}
    <details><summary>{t('tasks.approvalUpstream')}</summary>{context.filter(n => definition?.dependsOn.includes(n.id)).map(n =>
      <div key={n.id} className="py-2"><p className="font-medium">{n.title}</p><p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{n.output}</p></div>
    )}</details>
    <p className="text-xs text-muted-foreground">{t('tasks.approvalPending')}</p>
    {node?.blocker?.startsWith('feedback-delivery-') && <p role="alert" className="text-sm text-destructive">{t('tasks.feedbackRetry')}</p>}
    {node?.approvalFeedback && <p className="whitespace-pre-wrap text-sm">{node.approvalFeedback}</p>}
    <textarea aria-label={t('tasks.approvalFeedback')} value={feedback} onChange={e => setFeedback(e.target.value)}
      maxLength={4000} rows={2} disabled={busy} className="w-full rounded-md border bg-background p-2 text-sm" />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || loading} onClick={() => void respond(true)}>{t('tasks.approveNode', { id: nodeId })}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void respond(false)}>{t('tasks.rejectNode', { id: nodeId })}</Button>
      <Button variant="ghost" disabled={busy || !feedback.trim()} onClick={() => void respond(false, true)}>{t('tasks.approvalRequestChanges')}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>
}
