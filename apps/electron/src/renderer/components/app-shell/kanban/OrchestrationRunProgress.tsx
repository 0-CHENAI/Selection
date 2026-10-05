import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, CircleAlert, CircleCheck, ChevronDown, LoaderCircle, Pause, ShieldAlert } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
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
  runningHint = false, liveRun, rows, onPreviewSession,
  runs = [], onSelectRun, onRetry, retrying = false, error,
}: OrchestrationRunProgressViewProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const controlsId = React.useId()
  const reducedMotion = useReducedMotion()
  const status = liveRun?.status ?? (runningHint ? 'running' : undefined)
  const statusKey = runStatusLabelKey(status)
  const finished = countFinishedProgressRows(rows)
  const statusLabel = statusKey ? t(statusKey) : t('tasks.starting')
  const heading = t(isActiveTaskRunStatus(status) ? 'tasks.tabLiveRun' : 'tasks.runHistory')
  const activeRow = rows.find(row => row.state === 'running')
    ?? rows.flatMap(row => row.children ?? []).find(row => row.state === 'running')

  const renderRow = (row: OrchestrationProgressRow): React.ReactNode => {
    const labelKey = resolveNodeStatePill(row.state).labelKey
    const label = labelKey ? t(labelKey) : row.state
    const className = 'flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-xs'
    const content = <><ProgressStateIcon state={row.state} /><span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>{row.attempt && <span className="shrink-0 text-foreground/60">{t('tasks.runAttempt', { number: row.attempt })}</span>}<span className="shrink-0 text-foreground/60">{label}</span></>
    return (
      <div key={row.id}>
        {row.sessionId && onPreviewSession ? (
          <button type="button" className={cn(className, 'transition-colors hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring')} title={`${row.title} · ${t('tasks.openSession')}`}
            data-session-id={row.sessionId} onClick={() => onPreviewSession(row.sessionId!)}>{content}</button>
        ) : <span className={className} title={row.title}>{content}</span>}
        {!!row.attempts?.some(attempt => attempt.sessionId !== row.sessionId) && (
          <details className="ml-8 text-xs text-foreground/60">
            <summary className="w-fit cursor-pointer py-1 hover:text-foreground">{t('tasks.attemptHistory')}</summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.attempts.filter(attempt => attempt.sessionId !== row.sessionId).map(attempt => (
                <button key={attempt.sessionId} type="button" className="rounded px-2 py-1 hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  disabled={!onPreviewSession} data-session-id={attempt.sessionId}
                  onClick={() => onPreviewSession?.(attempt.sessionId)}>
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
    <div className="shrink-0 border-b border-border/60 px-4 py-1.5"
      data-testid="orchestration-run-progress" aria-label={heading}>
      <button type="button" aria-expanded={expanded} aria-controls={controlsId} onClick={() => setExpanded(value => !value)}
        className="flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-md text-left text-xs text-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {status === 'completed' ? <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" /> : <ProgressStateIcon state={status} />}
        <span className="shrink-0 font-medium text-foreground">{heading}</span>
        <span className="min-w-0 max-w-[40%] truncate" role="status" aria-live="polite" title={statusLabel}>{statusLabel}</span>
        <span className="min-w-0 flex-1 truncate" title={activeRow?.title}>{activeRow?.title}</span>
        {rows.length > 0 && <span className="shrink-0 tabular-nums">{finished}/{rows.length}</span>}
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
      </button>
      <motion.div id={controlsId} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})} className="overflow-hidden">
        <div className="max-h-52 overflow-y-auto pb-1 pt-1">
          {runs.length > 1 && onSelectRun && (
            <select aria-label={t('tasks.runHistory')} value={liveRun?.runId ?? ''}
              className="mb-1 max-w-full rounded bg-background px-2 py-1 text-xs text-foreground/60"
              onChange={event => onSelectRun(event.target.value)}>
              {[...runs].reverse().map(run => <option key={run.runId} value={run.runId}>{run.runId} · {t(runStatusLabelKey(run.status) ?? 'tasks.starting')}</option>)}
            </select>
          )}
          {rows.map(renderRow)}
        </div>
      </motion.div>
      {onRetry && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={retrying} className="rounded border border-border px-2 py-1 disabled:opacity-50" onClick={onRetry}>{t('tasks.retryFailedNodes')}</button>
        <span className="text-foreground/60">{t('tasks.retryFailedNodesHint')}</span>
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
