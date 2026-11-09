import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BodyFeedbackRevision } from '@craft-agent/shared/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Markdown, CollapsibleMarkdownProvider } from '@/components/markdown'

export type BodyFeedbackTarget = { sessionId: string; sourceMessageId: string; annotationId: string; resultMessageId?: string; requestMessageId?: string }

export function BodyFeedbackDialog({ target, onClose, onRestoreFocus, onOpenFile, onOpenUrl, refreshKey }: {
  target: BodyFeedbackTarget | null
  refreshKey?: string
  onClose: () => void
  onRestoreFocus: () => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
}) {
  const { t } = useTranslation()
  const [revisions, setRevisions] = React.useState<BodyFeedbackRevision[]>([])
  const [selected, setSelected] = React.useState('')
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    setRevisions([]); setError(undefined); setLoading(!!target)
    if (!target) return
    let disposed = false
    void window.electronAPI.getBodyFeedbackDetails(target.sessionId, target.sourceMessageId, target.annotationId)
      .then(items => {
        if (disposed) return
        setRevisions(items)
        setSelected((items.find(item => target.requestMessageId ? item.requestMessageId === target.requestMessageId : target.resultMessageId && item.result?.messageId === target.resultMessageId) ?? items.at(-1))?.requestMessageId ?? '')
      })
      .catch(e => { if (!disposed) setError(String(e)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [target, retry, refreshKey])
  const revision = revisions.find(item => item.requestMessageId === selected)
  return <Dialog open={!!target} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-[960px] max-h-[85vh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus() }}>
      <DialogHeader>
        <DialogTitle>{t('chat.bodyFeedback.title')}</DialogTitle>
        <DialogDescription>{t('chat.bodyFeedback.description')}</DialogDescription>
      </DialogHeader>
      {loading && <p role="status">{t('chat.artifactVersions.loading')}</p>}
      {error && <div role="alert" className="space-y-2 text-destructive"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('chat.bodyFeedback.retry')}</Button></div>}
      {!loading && !error && !revision && <p>{t('chat.bodyFeedback.unavailable')}</p>}
      {revision && <>
        <label className="text-sm font-medium" htmlFor="body-feedback-revision">{t('chat.artifactVersions.history')}</label>
        <select id="body-feedback-revision" value={selected} onChange={event => setSelected(event.target.value)} className="rounded-md border bg-background p-2 text-sm">
          {revisions.map((item, index) => <option key={item.requestMessageId} value={item.requestMessageId}>{t('chat.artifactVersions.version', { number: index + 1 })} · {new Date(item.createdAt).toLocaleString()}</option>)}
        </select>
        <section className="space-y-2"><h3 className="text-sm font-medium">{t('chat.artifactVersions.feedback')}</h3><p className="whitespace-pre-wrap break-words text-sm">{revision.instruction}</p></section>
        {revision.userResolvedAt && <p className="text-sm text-muted-foreground">{t('chat.annotationFeedbackResolved')} · {new Date(revision.userResolvedAt).toLocaleString()}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {([{ title: t('chat.bodyFeedback.original'), content: revision.original }, { title: revision.result?.salvaged ? t('chat.followUpRecoveredResult') : t('chat.bodyFeedback.modified'), content: revision.result?.content }]).map((item, index) => <section key={index} className="min-w-0 space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-medium">{item.title}</h3>
            {item.content === undefined ? <p className="text-sm text-muted-foreground">{t('chat.bodyFeedback.unavailable')}</p> : <CollapsibleMarkdownProvider><Markdown onFileClick={onOpenFile} onUrlClick={onOpenUrl} className="break-words text-sm">{item.content}</Markdown></CollapsibleMarkdownProvider>}
          </section>)}
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
