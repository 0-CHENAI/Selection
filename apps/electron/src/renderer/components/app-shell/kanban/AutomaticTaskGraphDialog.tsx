import * as React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { isMac, isWindows, isWebUI } from '@/lib/platform'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import { automaticTaskGraphKey, readAutomaticTaskGraph } from './automatic-task-graph'
import { runStatusLabelKey } from './task-labels'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  run: TaskRunSnapshotDto | null
  onOpenChildSession?: (sessionId: string) => void
  triggerRef?: React.RefObject<HTMLButtonElement>
}

export function AutomaticTaskGraphDialog({ open, onOpenChange, workspaceId, run, onOpenChildSession, triggerRef }: Props) {
  const { t } = useTranslation()
  const nativeCaption = (isMac || isWindows) && !isWebUI
  const key = automaticTaskGraphKey(workspaceId, run)
  const [loaded, setLoaded] = React.useState<{ key: string; spec?: WorkbenchSpec; error?: string }>()
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    if (!open || !workspaceId || !run) return
    let cancelled = false
    setLoaded(undefined)
    void readAutomaticTaskGraph((...args) => window.electronAPI.inspectTaskRun(...args), workspaceId, run)
      .then(spec => { if (!cancelled) setLoaded({ key, spec }) })
      .catch(error => { if (!cancelled) setLoaded({ key, error: String(error) }) })
    return () => { cancelled = true }
    // Run events update the overlay immediately; re-read the definition only at a revision boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, reload])
  const value = loaded?.key === key ? loaded : undefined
  const runStatusKey = runStatusLabelKey(run?.status)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="automatic-task-graph-dialog flex flex-col gap-0 p-0 sm:max-w-none"
      overlayClassName="automatic-task-graph-overlay bg-black/25 backdrop-blur-sm"
      data-native-caption={nativeCaption} showCloseButton={false}
      onCloseAutoFocus={event => {
        if (triggerRef?.current) { event.preventDefault(); triggerRef.current.focus() }
      }}>
      <header className="titlebar-no-drag flex shrink-0 items-center gap-3 border-b border-border px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <DialogTitle className="min-w-0 truncate text-base leading-normal">{value?.spec?.title ?? t('tasks.graphTitle')}</DialogTitle>
          {run && <span className="task-graph-run-status shrink-0 text-xs" aria-live="polite">{runStatusKey ? t(runStatusKey) : run.status}</span>}
        </div>
        <DialogDescription className="sr-only">{t('tasks.graphDescription')}</DialogDescription>
        <DialogClose className="task-graph-close titlebar-no-drag" aria-label={t('common.close')}>
          <X className="size-5" aria-hidden="true" />
        </DialogClose>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {!run || !workspaceId ? <p role="status" className="m-auto text-sm text-muted-foreground">{t('tasks.graphEmpty')}</p>
          : value?.error ? <div role="alert" className="m-auto max-w-sm space-y-3 text-center">
            <p className="text-sm">{t('tasks.graphLoadError')}</p>
            <button type="button" onClick={() => setReload(value => value + 1)} className="rounded-lg bg-foreground/5 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-ring">{t('common.retry')}</button>
            <details className="text-left text-xs text-muted-foreground"><summary className="cursor-pointer">{t('chat.showTechnicalDetails')}</summary><p className="mt-2 break-words">{value.error}</p></details>
          </div>
          : !value?.spec ? <p role="status" className="m-auto text-sm text-muted-foreground">{t('tasks.graphLoading')}</p>
          : !value.spec.nodes.length ? <p role="status" className="m-auto text-sm text-muted-foreground">{t('tasks.graphEmpty')}</p>
          : <ConductorWorkbench key={run.runId} spec={value.spec} liveRun={run} workspaceId={workspaceId} onOpenChildSession={onOpenChildSession} />}
      </div>
    </DialogContent>
  </Dialog>
}
