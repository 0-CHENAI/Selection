import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
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
  onPreviewSession?: (sessionId: string) => void
  runs?: TaskRunSnapshotDto[]
  onSelectRun?: (runId: string) => void
  onRetry?: () => void
  retrying?: boolean
  error?: string
}

export function OrchestrationRunProgressView({
  runningHint = false, liveRun, rows, onPreviewSession,
  runs = [], onSelectRun, onRetry, retrying = false, error,
}: OrchestrationRunProgressViewProps) {
  const { t } = useTranslation()
  const status = liveRun?.status ?? (runningHint ? 'running' : undefined)
  const statusKey = runStatusLabelKey(status)
  const finished = countFinishedProgressRows(rows)
  const pulse = status === 'running' || status === 'verifying' || status === 'repairing' || status === 'pausing'
  const statusLabel = statusKey ? t(statusKey) : t('tasks.starting')
  const heading = t(isActiveTaskRunStatus(status) ? 'tasks.tabLiveRun' : 'tasks.runHistory')

  const renderRow = (row: OrchestrationProgressRow): React.ReactNode => {
    const pill = resolveNodeStatePill(row.state)
    const label = pill.labelKey ? t(pill.labelKey) : row.state
    const className = cn('inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[12px] leading-none', pill.className)
    const content = <><span className="min-w-0 truncate">{row.title}</span><span className="shrink-0 opacity-80">{label}</span>{row.attempt && <span>{t('tasks.runAttempt', { number: row.attempt })}</span>}</>
    return (
      <div key={row.id} className={row.children?.length ? 'w-full' : undefined}>
        {row.sessionId && onPreviewSession ? (
          <button type="button" className={cn(className, 'hover:brightness-95')} title={t('tasks.openSession')}
            data-session-id={row.sessionId} onClick={() => onPreviewSession(row.sessionId!)}>{content}</button>
        ) : <span className={className}>{content}</span>}
        {!!row.attempts?.some(attempt => attempt.sessionId !== row.sessionId) && (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('tasks.attemptHistory')}</summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.attempts.filter(attempt => attempt.sessionId !== row.sessionId).map(attempt => (
                <button key={attempt.sessionId} type="button" className="rounded px-2 py-1 hover:bg-foreground/5"
                  disabled={!onPreviewSession} data-session-id={attempt.sessionId}
                  onClick={() => onPreviewSession?.(attempt.sessionId)}>
                  {t('tasks.runAttempt', { number: attempt.attempt })} · {t(resolveNodeStatePill(attempt.state).labelKey ?? 'tasks.nodeStateInterrupted')}
                </button>
              ))}
            </div>
          </details>
        )}
        {!!row.children?.length && <div className="ml-3 mt-1 flex flex-wrap gap-1.5 border-l border-border pl-2">{row.children.map(renderRow)}</div>}
      </div>
    )
  }

  return (
    <div className="shrink-0 border-b border-border/80 bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground))] px-4 py-2.5"
      data-testid="orchestration-run-progress" aria-label={heading}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground/70">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          {pulse && <span className="absolute inline-flex size-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />}
          <span className={cn('relative inline-flex size-2 rounded-full', pulse ? 'bg-indigo-500' : 'bg-foreground/35')} />
        </span>
        <span className="font-medium text-foreground/85">{heading}</span>
        <span role="status" aria-live="polite">{statusLabel}</span>
        {runs.length > 1 && onSelectRun && (
          <select aria-label={t('tasks.runHistory')} value={liveRun?.runId ?? ''}
            className="min-w-0 max-w-64 rounded bg-background px-1 py-0.5 text-xs"
            onChange={event => onSelectRun(event.target.value)}>
            {[...runs].reverse().map(run => <option key={run.runId} value={run.runId}>{run.runId} · {t(runStatusLabelKey(run.status) ?? 'tasks.starting')}</option>)}
          </select>
        )}
        {rows.length > 0 && <span className="ml-auto tabular-nums text-foreground/45">{finished}/{rows.length}</span>}
      </div>
      {rows.length > 0 && <div className="mt-2 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">{rows.map(renderRow)}</div>}
      {onRetry && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={retrying} className="rounded border border-border px-2 py-1 disabled:opacity-50" onClick={onRetry}>{t('tasks.retryFailedNodes')}</button>
        <span className="text-muted-foreground">{t('tasks.retryFailedNodesHint')}</span>
      </div>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface OrchestrationRunProgressProps {
  workspaceId: string
  taskSlug: string
  sessionId?: string
  runningHint?: boolean
  onPreviewSession?: (sessionId: string) => void
}

export function OrchestrationRunProgress(props: OrchestrationRunProgressProps) {
  return <OrchestrationRunProgressContent key={`${props.workspaceId}:${props.taskSlug}:${props.sessionId}`} {...props} />
}

function OrchestrationRunProgressContent({ workspaceId, taskSlug, sessionId, runningHint = false, onPreviewSession }: OrchestrationRunProgressProps) {
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
    onSelectRun={setSelected} onPreviewSession={onPreviewSession} onRetry={canRetry ? retry : undefined} retrying={retrying} error={error} />
}
