import * as React from 'react'
import { Layers3, Eye, LoaderCircle, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ManagedArtifact } from '@craft-agent/shared/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** File changes are requested in chat; this view only browses immutable snapshots. */
export function ArtifactVersionsDialog({ open, path, record, error, onRetry, onClose, onPreview, onRestore }: {
  open: boolean; path: string; record?: ManagedArtifact; error?: string
  onRetry: () => Promise<void>; onClose: () => void; onPreview: (path: string) => void | Promise<boolean | void>
  onRestore?: (record: ManagedArtifact, versionId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [previewError, setPreviewError] = React.useState<string>()
  const [retrying, setRetrying] = React.useState(false)
  const [previewing, setPreviewing] = React.useState<string>()
  const [restoring, setRestoring] = React.useState<string>()
  const sequence = React.useRef(0)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => () => { sequence.current++ }, [])
  React.useLayoutEffect(() => {
    if (open) {
      setPreviewError(undefined)
      setPreviewing(undefined)
      setRestoring(undefined)
      setRetrying(false)
    }
  }, [open, path])
  const fileName = (record?.path ?? path).split(/[/\\]/).pop()
  const visibleError = error ?? previewError
  return <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) { sequence.current++; onClose() } }}>
    <DialogContent className="artifact-versions-dialog sm:max-w-[560px] max-h-[85vh] gap-0 overflow-hidden p-0" overlayClassName="artifact-versions-overlay"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
      <DialogHeader className="px-5 pb-4 pt-5">
        <DialogTitle className="text-sm font-semibold">{t('chat.artifactVersions.title')}</DialogTitle>
        <DialogDescription className="truncate text-xs" title={record?.path ?? path ?? undefined}>{fileName}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto border-t border-border/50 px-5 pb-3">
        {visibleError && <div role="alert" className="space-y-2 py-3 text-xs text-destructive"><p className="break-words">{visibleError}</p><Button size="sm" variant="outline" disabled={retrying || !!previewing} onClick={() => { setRetrying(true); void onRetry().finally(() => { setRetrying(false); setPreviewError(undefined) }) }}>{retrying && <LoaderCircle aria-hidden="true" className="mr-1 size-3 animate-spin motion-reduce:animate-none" />}{t('chat.bodyFeedback.retry')}</Button></div>}
        {record && <ol aria-label={t('chat.artifactVersions.history')} className="divide-y divide-border/50">
          {[...record.versions].reverse().map((version, index) => <li key={version.id} className="flex min-w-0 items-start gap-3 py-3.5">
            <Layers3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium">{t('chat.artifactVersions.version', { number: version.ordinal ?? record.versions.length - index })}</span>
                {version.restoredFrom && <span className="text-muted-foreground">↩ {t('chat.artifactVersions.version', { number: record.versions.find(item => item.id === version.restoredFrom)?.ordinal ?? '?' })}</span>}
                {version.id === record.currentVersion && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{t('chat.artifactVersions.current')}</span>}
              </div>
              <p className="truncate text-xs leading-relaxed" title={version.summaryOrigin === 'assistant' ? version.summary : undefined}>
                {version.summaryOrigin === 'assistant' && version.summary
                  ? version.summary
                  : t(version.ordinal === 1 ? 'chat.artifactVersions.initialVersion' : 'chat.artifactVersions.fileUpdated')}
              </p>
              <time dateTime={new Date(version.createdAt).toISOString()} className="block text-[11px] text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</time>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {onRestore && version.id !== record.currentVersion && <button type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={!!previewing || !!restoring} aria-busy={restoring === version.id} aria-label={`${t('chat.artifactVersions.restore')} ${t('chat.artifactVersions.version', { number: version.ordinal ?? record.versions.length - index })}`}
                onClick={() => {
                  const request = sequence.current
                  setRestoring(version.id); setPreviewError(undefined)
                  void onRestore(record, version.id)
                    .catch(e => { if (request === sequence.current) setPreviewError(String(e)) })
                    .finally(() => { if (request === sequence.current) setRestoring(undefined) })
                }}>
                {restoring === version.id ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden="true" className="size-3" />}
                {t('chat.artifactVersions.restore')}
              </button>}
              {window.electronAPI.isChannelAvailable('artifacts:preview') && <button type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                disabled={!!previewing || !!restoring} aria-label={`${t('chat.artifactVersions.previewVersion')} ${t('chat.artifactVersions.version', { number: version.ordinal ?? record.versions.length - index })}`}
                onClick={() => {
                  const request = sequence.current
                  setPreviewing(version.id); setPreviewError(undefined)
                  void window.electronAPI.previewArtifactVersion(record.id, version.id)
                    .then(async file => { if (request === sequence.current && await onPreview(file) === false) throw new Error(t('toast.failedToOpenFile')) })
                    .catch(e => { if (request === sequence.current) setPreviewError(String(e)) })
                    .finally(() => { if (request === sequence.current) setPreviewing(undefined) })
                }}>
                {previewing === version.id ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <Eye aria-hidden="true" className="size-3" />}
                {t('chat.artifactVersions.previewShort')}
              </button>}
            </div>
          </li>)}
        </ol>}
      </div>
    </DialogContent>
  </Dialog>
}
