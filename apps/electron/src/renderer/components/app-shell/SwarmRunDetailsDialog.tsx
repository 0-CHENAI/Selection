import * as React from 'react'
import { ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SwarmRunDetailsDto, SwarmRunNodeDto } from '@craft-agent/shared/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePlatform } from '@craft-agent/ui/context'
import { cn } from '@/lib/utils'

interface SwarmRunDetailsDialogProps {
  sessionId: string
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenWorker: (sessionId: string) => void
  onStop?: () => Promise<void>
  refreshKey?: string
}

export function formatSwarmElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function statusClass(status: string): string {
  if (status === 'completed') return 'text-emerald-600 dark:text-emerald-300'
  if (status === 'running') return 'text-indigo-600 dark:text-indigo-300'
  return 'text-amber-600 dark:text-amber-300'
}

function nodeRoleLabel(node: SwarmRunNodeDto, t: (key: string) => string): string {
  if (node.role === 'coordinator') return t('swarm.roleCoordinator')
  if (node.role === 'reviewer') return t('swarm.roleReviewer')
  return t('swarm.roleWorker')
}

export function SwarmRunDetailsDialog({
  sessionId,
  workspaceId,
  open,
  onOpenChange,
  onOpenWorker,
  onStop,
  refreshKey,
}: SwarmRunDetailsDialogProps) {
  const { t } = useTranslation()
  const { onOpenFile } = usePlatform()
  const [details, setDetails] = React.useState<SwarmRunDetailsDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const requestSequence = React.useRef(0)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const openingWorker = React.useRef(false)

  const load = React.useCallback(async (background = false) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    if (!background) setDetails(null)
    try {
      const next = await window.electronAPI.getSessionSwarmRunDetails(sessionId, workspaceId)
      if (sequence !== requestSequence.current) return
      if (next && next.coordinatorSessionId !== sessionId) {
        setError(t('swarm.detailsIdentityMismatch'))
        return
      }
      setDetails(next)
    } catch (err) {
      if (sequence !== requestSequence.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [sessionId, t, workspaceId])

  React.useEffect(() => () => {
    requestSequence.current += 1
  }, [sessionId, workspaceId, open])

  React.useEffect(() => {
    if (open) void load()
  }, [open, load, refreshKey])

  React.useEffect(() => {
    if (!open || !details?.nodes.some(node => node.status === 'running')) return
    const timer = window.setTimeout(() => { void load(true) }, 1500)
    return () => window.clearTimeout(timer)
  }, [open, details, load])

  const stop = React.useCallback(async () => {
    if (!onStop || pending) return
    setPending(true)
    try {
      await onStop()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [load, onStop, pending])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden"
        onOpenAutoFocus={() => {
          openingWorker.current = false
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!openingWorker.current && returnFocus.current?.isConnected) returnFocus.current.focus()
        }}>
        <DialogHeader>
          <DialogTitle>{t('swarm.detailsTitle')}</DialogTitle>
          <DialogDescription>{t('swarm.detailsDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
            <span>
              {details
                ? details.tokenBudget === undefined
                  ? t('swarm.tokensUnlimited', { used: details.tokensUsed })
                  : details.tokenBudgetScope === 'agent'
                    ? t('swarm.perAgentTokensBudgeted', { used: details.tokensUsed, budget: details.tokenBudget })
                    : t('swarm.tokensBudgeted', { used: details.tokensUsed, budget: details.tokenBudget })
                : t('common.loading')}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </button>
          </div>

          {error && <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-600">{error}</div>}
          {!loading && !error && !details && (
            <div className="rounded-lg bg-foreground/[0.04] px-3 py-4 text-center text-[12px] text-muted-foreground">
              {t('swarm.noRunDetails')}
            </div>
          )}

          {details?.blocker && (
            <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px]">
              <div className="font-semibold text-amber-700 dark:text-amber-300">{t('swarm.blockerTitle')}</div>
              <p className="mt-1 whitespace-pre-wrap text-foreground/75">{details.blocker}</p>
            </div>
          )}

          {details?.nodes.map((node) => (
            <div
              key={node.sessionId}
              className="rounded-lg border border-border bg-card px-3 py-2.5"
              style={{ marginLeft: Math.min(node.depth, 2) * 12 }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{node.name}</span>
                <span className="text-[10.5px] text-muted-foreground">{nodeRoleLabel(node, t)}</span>
                <span className={cn('text-[10.5px] font-medium', statusClass(node.status))}>{node.status}</span>
                {node.role !== 'coordinator' && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[10.5px] font-medium text-indigo-500 hover:underline"
                    onClick={() => {
                      openingWorker.current = true
                      onOpenChange(false)
                      onOpenWorker(node.sessionId)
                    }}
                  >
                    <ExternalLink className="h-3 w-3" /> {t('swarm.openWorker')}
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                {node.model && <span>{node.model}</span>}
                <span>{formatSwarmElapsed(node.elapsedSeconds)}</span>
                <span>
                  {node.tokenBudget === undefined
                    ? t('tasks.tokensUsed', { count: node.tokensUsed })
                    : t('swarm.tokensBudgeted', { used: node.tokensUsed, budget: node.tokenBudget })}
                </span>
                <span>{node.lifecycle === 'detached' ? t('swarm.lifecycleDetached') : t('swarm.lifecycleManaged')}</span>
              </div>
              {node.lifecycle === 'detached' && (
                <p className="mt-1 text-[10.5px] text-muted-foreground">{t('swarm.detachedHint')}</p>
              )}
              {node.artifactDelivery && (() => {
                const delivery = node.artifactDelivery
                const attention = ['conflict', 'validation-failed', 'needs-attention'].includes(delivery.phase)
                const complete = delivery.phase === 'integrated'
                const Icon = complete ? CheckCircle2 : attention ? AlertTriangle : Loader2
                return (
                  <details className="mt-2 border-t border-border pt-2 text-[12px]" open={attention || undefined}>
                    <summary className={cn('cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring', attention ? 'text-amber-700 dark:text-amber-300' : complete ? 'text-emerald-700 dark:text-emerald-300' : 'text-accent')}>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon aria-hidden="true" className={cn('h-3.5 w-3.5', !complete && !attention && 'animate-spin motion-reduce:animate-none')} />
                        {t(`swarm.delivery.${delivery.phase}`)}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 text-foreground">
                      <div>
                        <p className="font-medium">{t('swarm.delivery.outputs')}</p>
                        <ul className="mt-1 space-y-1">
                          {Object.entries(delivery.outputs).map(([name, path]) => <li key={name} className="break-all font-mono text-[11px]">{path}</li>)}
                        </ul>
                      </div>
                      {delivery.checks.length > 0 && <div>
                        <p className="font-medium">{t('swarm.delivery.checks')}</p>
                        <ul className="mt-1 list-inside list-disc break-words">{delivery.checks.map((check, index) => <li key={index}>{check}</li>)}</ul>
                      </div>}
                      {delivery.conflicts.length > 0 && <div>
                        <p className="font-medium">{t('swarm.delivery.conflicts')}</p>
                        <ul className="mt-1 space-y-2">{delivery.conflicts.map(path => <li key={path} className="break-all text-[11px]">
                          <span className="font-mono">{path}</span>
                          {onOpenFile && delivery.candidateDirectory && <button type="button" className="ml-2 text-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-ring" onClick={() => {
                            setFileError(null)
                            const directory = delivery.candidateDirectory!
                            Promise.resolve(onOpenFile(`${directory.replace(/[\\/]$/, '')}/${path}`)).catch(error => setFileError(error instanceof Error ? error.message : t('swarm.delivery.openFailed')))
                          }}>{t('swarm.delivery.inspectCandidate')}</button>}
                        </li>)}</ul>
                        <p className="mt-2 text-muted-foreground">{t('swarm.delivery.repairHint')}</p>
                      </div>}
                    </div>
                  </details>
                )
              })()}
              {node.blocker && <p className="mt-1 whitespace-pre-wrap text-[11px] text-amber-700 dark:text-amber-300">{node.blocker}</p>}
              {node.summary && <p className="mt-1 whitespace-pre-wrap text-[11px] text-foreground/70">{node.summary}</p>}
            </div>
          ))}
        </div>

        {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
        {details && (
          <div className="flex items-center gap-2 border-t border-border pt-3">
            {details.status === 'running' && onStop && (
              <button type="button" className="ml-auto text-[12px] font-medium text-destructive hover:underline disabled:opacity-50" disabled={pending} onClick={() => void stop()}>
                {t('swarm.stopRun')}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
