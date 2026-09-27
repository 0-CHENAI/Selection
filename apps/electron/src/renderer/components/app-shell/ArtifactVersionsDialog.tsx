import * as React from 'react'
import { GitCommitHorizontal, Eye, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ManagedArtifact } from '@craft-agent/shared/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** File changes are requested in chat; this view only browses immutable snapshots. */
export function ArtifactVersionsDialog({ path, alternativePaths, onClose, onPreview }: {
  path: string | null; alternativePaths?: string[]
  onClose: () => void; onPreview: (path: string) => void | Promise<boolean | void>
}) {
  const { t } = useTranslation()
  const [record, setRecord] = React.useState<ManagedArtifact>()
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const [previewing, setPreviewing] = React.useState<string>()
  const [retry, setRetry] = React.useState(0)
  const sequence = React.useRef(0)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    const request = ++sequence.current
    setRecord(undefined); setError(undefined); setPreviewing(undefined); setLoading(!!path)
    if (!path) return
    void window.electronAPI.manageArtifact({ type: 'register', path, alternativePaths })
      .then(value => { if (request === sequence.current) setRecord(value) })
      .catch(e => { if (request === sequence.current) setError(String(e)) })
      .finally(() => { if (request === sequence.current) setLoading(false) })
    return () => { sequence.current++ }
  }, [path, alternativePaths, retry])
  const fileName = (record?.path ?? path)?.split(/[/\\]/).pop()
  return <Dialog open={path !== null} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-[560px] max-h-[85vh] gap-0 overflow-hidden p-0"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
      <DialogHeader className="px-5 pb-4 pt-5">
        <DialogTitle className="text-sm font-semibold">{t('chat.artifactVersions.title')}</DialogTitle>
        <DialogDescription className="truncate text-xs" title={record?.path ?? path ?? undefined}>{fileName}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto border-t border-border/50 px-5 pb-3">
        {loading && <p role="status" className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />{t('chat.artifactVersions.loading')}</p>}
        {error && <div role="alert" className="space-y-2 py-3 text-xs text-destructive"><p className="break-words">{error}</p><Button size="sm" variant="outline" disabled={loading || !!previewing} onClick={() => setRetry(value => value + 1)}>{t('chat.bodyFeedback.retry')}</Button></div>}
        {record && <ol aria-label={t('chat.artifactVersions.history')} className="divide-y divide-border/50">
          {[...record.versions].reverse().map((version, index) => <li key={version.id} className="flex min-w-0 items-start gap-3 py-3.5">
            <GitCommitHorizontal aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium">v{version.ordinal ?? record.versions.length - index}</span>
                <code title={version.id} className="text-muted-foreground">{version.id.slice(0, 8)}</code>
                {version.id === record.currentVersion && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{t('chat.artifactVersions.current')}</span>}
              </div>
              <p className="break-words text-xs leading-relaxed">{version.summary ?? t(version.ordinal === 1 ? 'chat.artifactVersions.initialVersion' : 'chat.artifactVersions.fileUpdated')}</p>
              <time dateTime={new Date(version.createdAt).toISOString()} className="block text-[11px] text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</time>
            </div>
            {window.electronAPI.isChannelAvailable('artifacts:preview') && <button type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={!!previewing} aria-label={`${t('chat.artifactVersions.previewVersion')} v${version.ordinal ?? record.versions.length - index}`}
              onClick={() => {
                const request = sequence.current
                setPreviewing(version.id); setError(undefined)
                void window.electronAPI.previewArtifactVersion(record.id, version.id)
                  .then(async file => { if (request === sequence.current && await onPreview(file) === false) throw new Error(t('toast.failedToOpenFile')) })
                  .catch(e => { if (request === sequence.current) setError(String(e)) })
                  .finally(() => { if (request === sequence.current) setPreviewing(undefined) })
              }}>
              {previewing === version.id ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <Eye aria-hidden="true" className="size-3" />}
              {t('chat.artifactVersions.previewShort')}
            </button>}
          </li>)}
        </ol>}
      </div>
    </DialogContent>
  </Dialog>
}
