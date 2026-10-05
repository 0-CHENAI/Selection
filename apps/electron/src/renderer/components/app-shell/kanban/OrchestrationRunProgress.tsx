import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, CircleAlert, LoaderCircle, Pause, ShieldAlert, UsersRound, X } from 'lucide-react'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { resolveNodeStatePill } from './node-state-pill'
import {
  buildOrchestrationProgressRows,
  countFinishedProgressRows,
  isActiveTaskRunStatus,
  isTaskRunEventForProgress,
  shouldShowOrchestrationRunProgress,
  type OrchestrationProgressRow,
} from './orchestration-run-progress'
import { runStatusLabelKey } from './task-labels'

export interface OrchestrationRunProgressViewProps {
  runningHint?: boolean
  liveRun?: TaskRunSnapshotDto | null
  rows: OrchestrationProgressRow[]
  renderPreviewSession?: (sessionId: string) => React.ReactNode
  runs?: TaskRunSnapshotDto[]
  onSelectRun?: (runId: string) => void
  onRetry?: () => void
  retrying?: boolean
  error?: string
}

function ProgressStateIcon({ state }: { state?: string }) {
  const className = 'size-3.5 shrink-0'
  if (state === 'done' || state === 'completed') return <Check className={cn(className, 'text-success')} aria-hidden="true" />
  if (state === 'failed' || state === 'invalid') return <CircleAlert className={cn(className, 'text-destructive')} aria-hidden="true" />
  if (state === 'running' || state === 'verifying' || state === 'repairing') return <LoaderCircle className={cn(className, 'text-accent motion-safe:animate-spin')} aria-hidden="true" />
  if (state === 'waiting-approval' || state === 'waiting-help') return <ShieldAlert className={cn(className, 'text-info')} aria-hidden="true" />
  if (state === 'paused' || state === 'pausing' || state === 'interrupted' || state === 'stopped') return <Pause className={cn(className, 'text-foreground/60')} aria-hidden="true" />
  return <Circle className={cn(className, 'text-foreground/60')} aria-hidden="true" />
}

export function OrchestrationRunProgressView({
  runningHint = false, liveRun, rows, renderPreviewSession,
  runs = [], onSelectRun, onRetry, retrying = false, error,
}: OrchestrationRunProgressViewProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const headingId = React.useId()
  const status = liveRun?.status ?? (runningHint ? 'running' : undefined)
  const statusKey = runStatusLabelKey(status)
  const finished = countFinishedProgressRows(rows)
  const statusLabel = statusKey ? t(statusKey) : t('tasks.starting')
  const heading = t(isActiveTaskRunStatus(status) ? 'tasks.tabLiveRun' : 'tasks.runHistory')
  const allRows = React.useMemo(() => {
    const flatten = (items: OrchestrationProgressRow[]): OrchestrationProgressRow[] => items.flatMap(row => [row, ...flatten(row.children ?? [])])
    return flatten(rows)
  }, [rows])
  const selectedRow = allRows.find(row => row.sessionId === selectedSessionId || row.attempts?.some(attempt => attempt.sessionId === selectedSessionId))
  const defaultRow = allRows.find(row => row.state === 'running' && row.sessionId) ?? allRows.find(row => row.sessionId)
  const previewSessionId = selectedRow ? selectedSessionId : defaultRow?.sessionId
  const previewTitle = (selectedRow ?? defaultRow)?.title
  const agentsLabel = t('session.executionChildren', { count: rows.length })

  React.useEffect(() => { setSelectedSessionId(null) }, [liveRun?.runId])

  const renderRow = (row: OrchestrationProgressRow): React.ReactNode => {
    const labelKey = resolveNodeStatePill(row.state).labelKey
    const label = labelKey ? t(labelKey) : row.state
    const className = 'flex min-h-12 w-full min-w-0 items-start gap-2.5 rounded-md px-3 py-2.5 text-left text-xs'
    const content = <><span className="pt-0.5"><ProgressStateIcon state={row.state} /></span><span className="min-w-0 flex-1"><span className="block truncate text-foreground">{row.title}</span><span className="mt-1 block text-foreground/60">{label}{row.attempt && <> · {t('tasks.runAttempt', { number: row.attempt })}</>}</span></span></>
    return (
      <div key={row.id}>
        {row.sessionId && renderPreviewSession ? (
          <button type="button" className={cn(className, 'transition-colors hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring', row.sessionId === previewSessionId && 'bg-foreground/5')}
            title={`${row.title} · ${t('chat.viewOutput')}`} aria-pressed={row.sessionId === previewSessionId}
            data-session-id={row.sessionId} onClick={() => setSelectedSessionId(row.sessionId!)}>{content}</button>
        ) : <span className={className} title={row.title}>{content}</span>}
        {!!row.attempts?.some(attempt => attempt.sessionId !== row.sessionId) && (
          <details className="ml-8 text-xs text-foreground/60">
            <summary className="w-fit cursor-pointer py-1 hover:text-foreground">{t('tasks.attemptHistory')}</summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.attempts.filter(attempt => attempt.sessionId !== row.sessionId).map(attempt => (
                <button key={attempt.sessionId} type="button" className="rounded px-2 py-1 hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  disabled={!renderPreviewSession} data-session-id={attempt.sessionId} aria-pressed={attempt.sessionId === previewSessionId}
                  onClick={() => setSelectedSessionId(attempt.sessionId)}>
                  {t('tasks.runAttempt', { number: attempt.attempt })} · {t(resolveNodeStatePill(attempt.state).labelKey ?? 'tasks.nodeStateInterrupted')}
                </button>
              ))}
            </div>
          </details>
        )}
        {!!row.children?.length && <div className="ml-3 border-l border-border/60 pl-2">{row.children.map(renderRow)}</div>}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="orchestration-run-progress" title={`${heading} · ${statusLabel}`}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-xs text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {isActiveTaskRunStatus(status) || error ? <ProgressStateIcon state={error ? 'failed' : status} /> : <UsersRound className="size-3.5" aria-hidden="true" />}
          <span>{agentsLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={10} collisionPadding={16} aria-labelledby={headingId}
        onEscapeKeyDown={event => event.stopPropagation()}
        style={{ '--accent': 'var(--pro-accent)', '--accent-rgb': 'var(--pro-accent-rgb)' } as React.CSSProperties}
        className="@container flex h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(52rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100">
        <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-3">
          <h2 id={headingId} className="text-sm font-medium">{agentsLabel}</h2>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground/60" role="status" aria-live="polite">
            <ProgressStateIcon state={status} /><span className="truncate">{statusLabel}</span>
          </span>
          {rows.length > 0 && <span className="text-xs tabular-nums text-foreground/60">{finished}/{rows.length}</span>}
          <button type="button" aria-label={t('common.close')} onClick={() => setOpen(false)}
            className="flex size-7 shrink-0 items-center justify-center text-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col @min-[600px]:flex-row">
          <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border/50 p-2 @min-[600px]:max-h-none @min-[600px]:w-60 @min-[600px]:border-b-0 @min-[600px]:border-r">
            {runs.length > 1 && onSelectRun && (
              <select aria-label={t('tasks.runHistory')} value={liveRun?.runId ?? ''}
                className="mb-1 max-w-full rounded bg-background px-2 py-1 text-xs text-foreground/60"
                onChange={event => onSelectRun(event.target.value)}>
                {[...runs].reverse().map(run => <option key={run.runId} value={run.runId}>{run.runId} · {t(runStatusLabelKey(run.status) ?? 'tasks.starting')}</option>)}
              </select>
            )}
            {rows.map(renderRow)}
          </div>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('chat.viewOutput')}>
            {previewTitle && <h3 className="shrink-0 truncate px-5 pb-1 pt-4 text-xs font-medium" title={previewTitle}>{previewTitle}</h3>}
            <div className="min-h-0 flex-1">
              {previewSessionId && renderPreviewSession ? renderPreviewSession(previewSessionId) : (
                <div className="flex h-full items-center justify-center text-sm text-foreground/60">{t('tasks.starting')}</div>
              )}
            </div>
          </section>
        </div>
        {(onRetry || error) && <footer className="shrink-0 border-t border-border/50 px-4 py-3 text-xs">
          {onRetry && <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={retrying} className="rounded border border-border px-2 py-1 disabled:opacity-50" onClick={onRetry}>{t('tasks.retryFailedNodes')}</button>
            <span className="text-foreground/60">{t('tasks.retryFailedNodesHint')}</span>
          </div>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </footer>}
      </PopoverContent>
    </Popover>
  )
}

interface OrchestrationRunProgressProps {
  workspaceId: string
  taskSlug: string
  sessionId?: string
  runningHint?: boolean
  renderPreviewSession?: (sessionId: string) => React.ReactNode
  onLatestRunChange?: (run: TaskRunSnapshotDto | null) => void
}

export function OrchestrationRunProgress(props: OrchestrationRunProgressProps) {
  return <OrchestrationRunProgressContent key={`${props.workspaceId}:${props.taskSlug}:${props.sessionId}`} {...props} />
}

function OrchestrationRunProgressContent({ workspaceId, taskSlug, sessionId, runningHint = false, renderPreviewSession, onLatestRunChange }: OrchestrationRunProgressProps) {
  const { t } = useTranslation()
  const [runs, setRuns] = React.useState<TaskRunSnapshotDto[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string>()
  const [retrying, setRetrying] = React.useState(false)
  const retryInFlight = React.useRef(false)

  React.useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    // Subscribe first and retain newer events while the durable history request is in flight.
    const received = new Map<string, TaskRunSnapshotDto>()
    const unsubscribe = window.electronAPI.onTaskRunChanged((ws, snapshot) => {
      if (!isTaskRunEventForProgress(workspaceId, taskSlug, sessionId, ws, snapshot) || snapshot.orchestratorSessionId !== sessionId) return
      received.set(snapshot.runId, snapshot)
      setRuns(previous => previous.some(run => run.runId === snapshot.runId)
        ? previous.map(run => run.runId === snapshot.runId ? snapshot : run)
        : [...previous, snapshot])
    })
    void window.electronAPI.getTask(workspaceId, taskSlug, undefined, sessionId).then(result => {
      if (cancelled) return
      const history = result.runHistory ?? []
      const merged = history.map(run => received.get(run.runId) ?? run)
      for (const run of received.values()) if (!merged.some(item => item.runId === run.runId)) merged.push(run)
      setRuns(merged)
    }).catch(() => { if (!cancelled) setError(t('tasks.toastLoadFailed')) })
    return () => { cancelled = true; unsubscribe() }
  }, [workspaceId, taskSlug, sessionId, t])

  const liveRun = runs.find(run => run.runId === selected) ?? runs.at(-1) ?? null
  // Transcript progress always follows the latest run, independently of the popup's history selection.
  const latestRun = runs.at(-1) ?? null
  React.useEffect(() => { onLatestRunChange?.(latestRun) }, [latestRun, onLatestRunChange])
  const rows = React.useMemo(() => buildOrchestrationProgressRows(undefined, liveRun), [liveRun])
  const canRetry = liveRun?.status === 'failed' && liveRun.canRetryFailedNodes
    && liveRun.runId === runs.at(-1)?.runId && !runs.some(run => isActiveTaskRunStatus(run.status))
  const retry = async () => {
    if (!canRetry || !liveRun || retryInFlight.current) return
    retryInFlight.current = true
    setRetrying(true)
    setError(undefined)
    try {
      const result = await window.electronAPI.continueTask(workspaceId, taskSlug, liveRun.runId)
      setRuns(previous => previous.map(run => run.runId === result.snapshot.runId ? result.snapshot : run))
      if (result.conflict) setError(t('tasks.toastControlConflict'))
    } catch { setError(t('tasks.toastRunFailed')) }
    finally { retryInFlight.current = false; setRetrying(false) }
  }

  if (!error && !shouldShowOrchestrationRunProgress({ isTaskOrchestrator: true, orchestrationStatus: runningHint ? 'running' : undefined, runStatus: liveRun?.status })) return null
  return <OrchestrationRunProgressView runningHint={runningHint} liveRun={liveRun} rows={rows} runs={runs}
    onSelectRun={setSelected} renderPreviewSession={renderPreviewSession} onRetry={canRetry ? retry : undefined} retrying={retrying} error={error} />
}
