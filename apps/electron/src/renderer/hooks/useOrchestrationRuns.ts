import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { isActiveTaskRunStatus, isTaskRunEventForProgress } from '@/components/app-shell/kanban/orchestration-run-progress'

/** Feed the transcript's work chains without adding a second navigation surface. */
export function useOrchestrationRuns(workspaceId?: string | null, taskSlug?: string, sessionId?: string | null) {
  const { t } = useTranslation()
  const key = JSON.stringify([workspaceId, taskSlug, sessionId])
  const [state, setState] = React.useState<{ key: string; runs: TaskRunSnapshotDto[] }>({ key, runs: [] })
  const [retrying, setRetrying] = React.useState(false)
  const retryInFlight = React.useRef(false)
  const runs = state.key === key ? state.runs : []

  React.useEffect(() => {
    setState({ key, runs: [] })
    if (!workspaceId || !taskSlug || !sessionId) return
    let cancelled = false
    // Subscribe first so a slow history response cannot overwrite newer live events.
    const received = new Map<string, TaskRunSnapshotDto>()
    const unsubscribe = window.electronAPI.onTaskRunChanged((ws, snapshot) => {
      if (cancelled || !isTaskRunEventForProgress(workspaceId, taskSlug, sessionId, ws, snapshot) || snapshot.orchestratorSessionId !== sessionId) return
      received.set(snapshot.runId, snapshot)
      setState(previous => previous.key !== key ? previous : { key, runs: previous.runs.some(run => run.runId === snapshot.runId)
        ? previous.runs.map(run => run.runId === snapshot.runId ? snapshot : run)
        : [...previous.runs, snapshot] })
    })
    void window.electronAPI.getTask(workspaceId, taskSlug, undefined, sessionId).then(result => {
      if (cancelled) return
      const history = (result.runHistory ?? []).map(run => received.get(run.runId) ?? run)
      for (const run of received.values()) if (!history.some(item => item.runId === run.runId)) history.push(run)
      setState({ key, runs: history })
    }).catch(() => { if (!cancelled) toast.error(t('tasks.toastLoadFailed')) })
    return () => { cancelled = true; unsubscribe() }
  }, [key, workspaceId, taskSlug, sessionId, t])

  const latestRun = runs.at(-1)
  const canRetry = latestRun?.status === 'failed' && latestRun.canRetryFailedNodes
    && !runs.some(run => isActiveTaskRunStatus(run.status))
  const retry = async () => {
    if (!canRetry || !latestRun || !workspaceId || !taskSlug || retryInFlight.current) return
    retryInFlight.current = true
    setRetrying(true)
    try {
      const result = await window.electronAPI.continueTask(workspaceId, taskSlug, latestRun.runId)
      setState(previous => previous.key !== key ? previous : { key, runs: previous.runs.map(run => run.runId === result.snapshot.runId ? result.snapshot : run) })
      if (result.conflict) toast.error(t('tasks.toastControlConflict'))
    } catch { toast.error(t('tasks.toastRunFailed')) }
    finally { retryInFlight.current = false; setRetrying(false) }
  }
  return { runs, retry: canRetry ? retry : undefined, retrying }
}
