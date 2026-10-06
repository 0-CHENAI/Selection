import * as React from 'react'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TaskRunSnapshotDto } from '@craft-agent/shared/protocol'
import { collectOrchestrationResearchSources, isActiveTaskRunStatus, isTaskRunEventForProgress } from '@/components/app-shell/kanban/orchestration-run-progress'
import { ensureSessionMessagesLoadedAtom, sessionAtomFamily } from '@/atoms/sessions'

/** Feed the transcript's work chains without adding a second navigation surface. */
export function useOrchestrationRuns(workspaceId?: string | null, taskSlug?: string, sessionId?: string | null) {
  const { t } = useTranslation()
  const key = JSON.stringify([workspaceId, taskSlug, sessionId])
  const [state, setState] = React.useState<{ key: string; runs: TaskRunSnapshotDto[] }>({ key, runs: [] })
  const [retrying, setRetrying] = React.useState(false)
  const retryInFlight = React.useRef(false)
  const runs = state.key === key ? state.runs : []
  const workerIdsKey = JSON.stringify([...new Set(runs.flatMap(run => run.nodes.flatMap(node => node.sessionId ? [node.sessionId] : [])))])
  const workerIds: string[] = React.useMemo(() => JSON.parse(workerIdsKey), [workerIdsKey])
  const workerSessionsAtom = React.useMemo(() => atom(get => workerIds.map(id => get(sessionAtomFamily(id)))), [workerIds])
  const workers = useAtomValue(workerSessionsAtom)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  React.useEffect(() => {
    for (const id of workerIds) void ensureMessagesLoaded(id).catch(error => console.warn('[Sources] Failed to load worker sources:', error))
  }, [workerIds, ensureMessagesLoaded])
  const sourcesByRun = React.useMemo(() => new Map(runs.map(run => [run.runId, collectOrchestrationResearchSources(run, workers, runs)])), [runs, workers])

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
  return { runs, sourcesByRun, retry: canRetry ? retry : undefined, retrying }
}
