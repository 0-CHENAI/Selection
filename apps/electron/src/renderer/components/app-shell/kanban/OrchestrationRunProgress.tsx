import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { resolveNodeStatePill } from './node-state-pill'
import {
  buildOrchestrationProgressRows,
  countFinishedProgressRows,
  isActiveTaskRunStatus,
  shouldShowOrchestrationRunProgress,
  type OrchestrationProgressRow,
  type SpecProgressNode,
} from './orchestration-run-progress'
import { runStatusLabelKey } from './task-labels'

export interface OrchestrationRunProgressViewProps {
  runningHint?: boolean
  liveRun?: TaskRunSnapshotDto | null
  rows: OrchestrationProgressRow[]
  onPreviewSession?: (sessionId: string) => void
}

export function OrchestrationRunProgressView({
  runningHint = false,
  liveRun,
  rows,
  onPreviewSession,
}: OrchestrationRunProgressViewProps) {
  const { t } = useTranslation()
  const status = isActiveTaskRunStatus(liveRun?.status) ? liveRun?.status : runningHint ? 'running' : liveRun?.status
  const statusKey = runStatusLabelKey(status)
  const finished = countFinishedProgressRows(rows)
  const pulse = status === 'running' || status === 'verifying' || status === 'repairing' || status === 'pausing'

  return (
    <div
      className="shrink-0 border-b border-border/80 bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground))] px-4 py-2.5"
      data-testid="orchestration-run-progress"
      role="status"
      aria-live="polite"
      aria-label={t('tasks.tabLiveRun')}
    >
      <div className="flex items-center gap-2 text-[12.5px] text-foreground/70">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          {pulse && (
            <span className="absolute inline-flex size-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
          )}
          <span className={cn('relative inline-flex size-2 rounded-full', pulse ? 'bg-indigo-500' : 'bg-foreground/35')} />
        </span>
        <span className="font-medium text-foreground/85">{t('tasks.tabLiveRun')}</span>
        <span>{statusKey ? t(statusKey) : status === 'running' ? t('tasks.starting') : (status ?? t('tasks.starting'))}</span>
        {rows.length > 0 && (
          <span className="ml-auto tabular-nums text-foreground/45">
            {finished}/{rows.length}
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {rows.map((row) => {
            const pill = resolveNodeStatePill(row.state)
            const label = pill.labelKey ? t(pill.labelKey) : row.state
            const className = cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[12px] leading-none',
              pill.className,
              row.sessionId && onPreviewSession ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
            )
            const content = (
              <>
                <span className="min-w-0 truncate">{row.title}</span>
                <span className="shrink-0 opacity-80">{label}</span>
              </>
            )
            if (row.sessionId && onPreviewSession) {
              return (
                <button
                  key={row.id}
                  type="button"
                  className={className}
                  title={t('tasks.openSession')}
                  onClick={() => onPreviewSession(row.sessionId!)}
                >
                  {content}
                </button>
              )
            }
            return (
              <span key={row.id} className={className}>
                {content}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface OrchestrationRunProgressProps {
  workspaceId: string
  taskSlug: string
  runningHint?: boolean
  onPreviewSession?: (sessionId: string) => void
}

export function OrchestrationRunProgress({
  workspaceId,
  taskSlug,
  runningHint = false,
  onPreviewSession,
}: OrchestrationRunProgressProps) {
  const [specNodes, setSpecNodes] = React.useState<SpecProgressNode[] | undefined>()
  const [liveRun, setLiveRun] = React.useState<TaskRunSnapshotDto | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setSpecNodes(undefined)
    setLiveRun(null)
    void window.electronAPI
      .getTask(workspaceId, taskSlug)
      .then((res) => {
        if (cancelled) return
        const spec = res.spec as { nodes?: SpecProgressNode[] } | undefined
        setSpecNodes(spec?.nodes)
        setLiveRun(res.latestRun ?? res.run ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId, taskSlug])

  React.useEffect(() => {
    return window.electronAPI.onTaskRunChanged((_ws, snapshot) => {
      if (snapshot.slug !== taskSlug) return
      setLiveRun(snapshot)
    })
  }, [taskSlug])

  const rows = React.useMemo(
    () => buildOrchestrationProgressRows(specNodes, liveRun),
    [specNodes, liveRun],
  )

  if (!shouldShowOrchestrationRunProgress({
    isTaskOrchestrator: true,
    orchestrationStatus: runningHint ? 'running' : undefined,
    runStatus: liveRun?.status,
  })) {
    return null
  }

  return (
    <OrchestrationRunProgressView
      runningHint={runningHint}
      liveRun={liveRun}
      rows={rows}
      onPreviewSession={onPreviewSession}
    />
  )
}
