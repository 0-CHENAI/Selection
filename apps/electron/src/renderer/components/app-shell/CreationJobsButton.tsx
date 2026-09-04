import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion, useReducedMotion } from 'motion/react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  ListChecks,
  MessageCircle,
  RotateCcw,
  X,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  creationJobsAtom,
  hasNewTerminalCreationOutput,
  isActiveCreationJob,
  patchCreationJobAtom,
  removeCreationJobAtom,
  shouldCancelCreationJob,
  shouldValidateCreationJob,
  type CreationJob,
} from '@/atoms/creation-jobs'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { refreshCreationConsumers, validateCreationJob } from '@/lib/creation-job-validation'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

const validationInFlight = new Set<string>()
const notifiedJobStates = new Map<string, string>()

function useCreationJobReconciler(
  workspaceId: string | null,
  onReopen: (contextKey: string) => void,
  onOpenResult?: (job: CreationJob, resultId: string) => void,
) {
  const { t } = useTranslation()
  const jobs = useAtomValue(creationJobsAtom)
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const patchJob = useSetAtom(patchCreationJobAtom)

  React.useEffect(() => {
    if (!workspaceId) return

    for (const job of jobs) {
      if (job.workspaceId !== workspaceId || !shouldValidateCreationJob(job)) continue
      const validationKey = `${job.id}:${job.attempt}`
      if (!job.sessionId || validationInFlight.has(validationKey)) continue

      const meta = sessionMeta.get(job.sessionId)
      if (!meta) continue
      if (meta.isProcessing) {
        if (!job.observedProcessing) {
          patchJob({
            id: job.id,
            expectedAttempt: job.attempt,
            expectedStatus: 'running',
            expectedPhase: 'running',
            patch: { observedProcessing: true },
          })
        }
        continue
      }
      if (!hasNewTerminalCreationOutput(job, meta)) continue

      validationInFlight.add(validationKey)
      const started = patchJob({
        id: job.id,
        expectedAttempt: job.attempt,
        expectedStatus: 'running',
        expectedPhase: 'running',
        patch: { phase: 'validating' },
      })
      if (!started) {
        validationInFlight.delete(validationKey)
        continue
      }

      void (async () => {
        try {
          if (meta.lastMessageRole === 'error') {
            throw new Error('The creation session ended with an error. Reopen it to review the details.')
          }
          const result = await validateCreationJob(job)
          if (result.reason === 'none') {
            patchJob({
              id: job.id,
              expectedAttempt: job.attempt,
              expectedStatus: 'running',
              expectedPhase: 'validating',
              patch: {
                status: 'waiting-input',
                phase: 'waiting-input',
                error: 'No new resource was found yet. Reopen this job to answer questions or continue.',
                baselineFinalMessageId: meta.lastFinalMessageId,
                baselineMessageRole: meta.lastMessageRole,
                observedProcessing: false,
              },
            })
            return
          }
          if (!result.id) throw new Error(result.error || 'Creation could not be verified.')
          await refreshCreationConsumers({
            workspaceId: job.workspaceId,
            kind: job.kind,
            id: result.id,
          })
          patchJob({
            id: job.id,
            expectedAttempt: job.attempt,
            expectedStatus: 'running',
            expectedPhase: 'validating',
            patch: {
              status: 'completed',
              phase: 'completed',
              result: { id: result.id },
              error: undefined,
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          patchJob({
            id: job.id,
            expectedAttempt: job.attempt,
            expectedStatus: 'running',
            expectedPhase: 'validating',
            patch: {
              status: 'failed',
              phase: 'failed',
              error: message,
              baselineFinalMessageId: meta.lastFinalMessageId,
              baselineMessageRole: meta.lastMessageRole,
              observedProcessing: false,
            },
          })
        } finally {
          validationInFlight.delete(validationKey)
        }
      })()
    }
  }, [jobs, patchJob, sessionMeta, workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    for (const job of jobs) {
      if (job.workspaceId !== workspaceId) continue
      if (job.status !== 'waiting-input' && job.status !== 'completed' && job.status !== 'failed') continue
      const notificationKey = `${job.status}:${job.attempt}`
      if (notifiedJobStates.get(job.id) === notificationKey) continue
      notifiedJobStates.set(job.id, notificationKey)
      if (notifiedJobStates.size > 200) {
        const oldestKey = notifiedJobStates.keys().next().value
        if (oldestKey) notifiedJobStates.delete(oldestKey)
      }

      const action = {
        label: t('common.open', 'Open'),
        onClick: () => job.status === 'completed' && job.result && onOpenResult
          ? onOpenResult(job, job.result.id)
          : onReopen(job.contextKey),
      }
      if (job.status === 'completed') {
        toast.success(t('creationJobs.completedNotification', '{{kind}} created', {
          kind: jobLabel(job, t),
        }), { description: job.result?.id, action })
      } else if (job.status === 'failed') {
        toast.error(t('creationJobs.failedNotification', '{{kind}} creation failed', {
          kind: jobLabel(job, t),
        }), { description: job.error, action })
      } else {
        toast.info(t('creationJobs.waitingNotification', 'Creation needs more information'), {
          description: t('creationJobs.waitingNotificationDescription', 'Reopen the job to answer questions or continue.'),
          action,
        })
      }
    }
  }, [jobs, onOpenResult, onReopen, t, workspaceId])
}

function jobLabel(job: CreationJob, t: ReturnType<typeof useTranslation>['t']): string {
  if (job.kind === 'source') return t('creationJobs.kindSource', 'Source / MCP')
  if (job.kind === 'skill') return t('creationJobs.kindSkill', 'Skill')
  return t('creationJobs.kindAutomation', 'Automation')
}

function phaseLabel(job: CreationJob, t: ReturnType<typeof useTranslation>['t']): string {
  switch (job.phase) {
    case 'preparing': return t('creationJobs.preparing', 'Preparing')
    case 'running': return t('creationJobs.running', 'Running')
    case 'validating': return t('creationJobs.validating', 'Verifying result')
    case 'waiting-input': return t('creationJobs.waitingInput', 'Waiting for input')
    case 'completed': return job.result?.id || t('creationJobs.completed', 'Completed')
    case 'failed': return t('creationJobs.failed', 'Needs attention')
    case 'cancelled': return t('creationJobs.cancelled', 'Cancelled')
  }
}

export interface CreationJobsControllerProps {
  workspaceId: string | null
  onReopen: (contextKey: string) => void
  onOpenResult?: (job: CreationJob, resultId: string) => void
}

export interface CreationJobsButtonProps extends CreationJobsControllerProps {
  className?: string
}

/** Always-mounted host: validates results and emits toasts without a top-bar button. */
export function CreationJobsHost({ workspaceId, onReopen, onOpenResult }: CreationJobsControllerProps) {
  useCreationJobReconciler(workspaceId, onReopen, onOpenResult)
  return null
}

export function CreationJobsButton({ workspaceId, onReopen, onOpenResult, className }: CreationJobsButtonProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const allJobs = useAtomValue(creationJobsAtom)
  const patchJob = useSetAtom(patchCreationJobAtom)
  const removeJob = useSetAtom(removeCreationJobAtom)
  const [open, setOpen] = React.useState(false)
  const [cancelTarget, setCancelTarget] = React.useState<CreationJob | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const jobs = React.useMemo(
    () => allJobs
      .filter((job) => job.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [allJobs, workspaceId],
  )
  const activeCount = jobs.filter(isActiveCreationJob).length
  const failedCount = jobs.filter((job) => job.status === 'failed').length
  const buttonLabel = [
    t('creationJobs.title', 'Creation jobs'),
    activeCount > 0 ? t('creationJobs.activeCount', '{{count}} active', { count: activeCount }) : null,
    failedCount > 0 ? t('creationJobs.failedCount', '{{count}} failed', { count: failedCount }) : null,
  ].filter(Boolean).join(', ')

  const reopen = (job: CreationJob) => {
    setOpen(false)
    triggerRef.current?.focus()
    onReopen(job.contextKey)
  }

  const openJob = (job: CreationJob) => {
    if (job.status === 'completed' && job.result && onOpenResult) {
      setOpen(false)
      triggerRef.current?.focus()
      onOpenResult(job, job.result.id)
      return
    }
    reopen(job)
  }

  const confirmCancel = async () => {
    const job = cancelTarget
    setCancelTarget(null)
    if (!job || !shouldCancelCreationJob('explicit-stop')) return
    if (job.status === 'waiting-input') {
      patchJob({
        id: job.id,
        expectedAttempt: job.attempt,
        expectedStatus: 'waiting-input',
        patch: { status: 'cancelled', phase: 'cancelled', error: undefined },
      })
      return
    }
    if (!job.sessionId) return
    try {
      await window.electronAPI.cancelProcessing(job.sessionId, false)
      patchJob({
        id: job.id,
        expectedAttempt: job.attempt,
        expectedStatus: 'running',
        patch: { status: 'cancelled', phase: 'cancelled', error: undefined },
      })
    } catch (error) {
      toast.error(t('creationJobs.stopFailed', 'Could not stop creation job'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <AlertDialog open={cancelTarget != null} onOpenChange={(next) => !next && setCancelTarget(null)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              'relative inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground',
              'transition-[color,filter,transform] duration-150 hover:text-foreground hover:brightness-125',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
              className,
            )}
            aria-label={buttonLabel}
            title={t('creationJobs.title', 'Creation jobs')}
          >
            <ListChecks className="h-4 w-4" />
            {failedCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-0 top-0 inline-flex h-3 w-3 items-center justify-center rounded-full bg-destructive text-[8px] font-bold leading-none text-destructive-foreground ring-1 ring-background"
              >
                !
              </span>
            ) : activeCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-info ring-2 ring-background"
              />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-labelledby="creation-jobs-title"
          className="flex w-[min(360px,calc(100vw-16px))] max-h-[calc(100vh-16px)] flex-col overflow-hidden p-0"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3.5 py-3">
            <div>
              <div id="creation-jobs-title" className="text-sm font-semibold">{t('creationJobs.title', 'Creation jobs')}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {activeCount > 0
                  ? t('creationJobs.activeCount', '{{count}} active', { count: activeCount })
                  : t('creationJobs.noneActive', 'No active creation jobs')}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {jobs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <ListChecks className="mx-auto h-5 w-5 text-muted-foreground/55" />
                <p className="mt-2 text-sm font-medium">{t('creationJobs.empty', 'Creation work will appear here')}</p>
                <p className="mx-auto mt-1 max-w-[30ch] text-xs leading-relaxed text-muted-foreground">
                  {t('creationJobs.emptyHint', 'You can close its window and keep working while it runs.')}
                </p>
              </div>
            ) : jobs.map((job) => {
              const running = job.status === 'running'
              const waiting = job.status === 'waiting-input'
              const failed = job.status === 'failed'
              const terminal = job.status === 'completed' || failed || job.status === 'cancelled'
              const requestLabel = job.request?.trim() || jobLabel(job, t)
              return (
                <motion.div
                  layout={!reduceMotion}
                  key={job.id}
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-foreground/[0.035]"
                >
                  <button
                    type="button"
                    onClick={() => openJob(job)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                      {running ? <Spinner className="text-info motion-reduce:[animation:none]" /> : waiting ? (
                        <MessageCircle className="h-4 w-4 text-warning" />
                      ) : failed ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : job.status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <CircleStop className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{requestLabel}</span>
                      <span className={cn('block truncate text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')}>
                        {jobLabel(job, t)} · {failed ? job.error : phaseLabel(job, t)}
                      </span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </button>

                  {((running && job.phase === 'running' && job.sessionId) || waiting) && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(job)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,filter] hover:text-destructive hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t('creationJobs.stop', 'Stop creation job')}
                      title={t('creationJobs.stop', 'Stop creation job')}
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {(failed || waiting) && (
                    <button
                      type="button"
                      onClick={() => reopen(job)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,filter,transform] hover:text-foreground hover:brightness-125 active:rotate-[-20deg] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:rotate-0"
                      aria-label={waiting ? t('common.continue', 'Continue') : t('creationJobs.openToRetry', 'Open to retry')}
                      title={waiting ? t('common.continue', 'Continue') : t('creationJobs.openToRetry', 'Open to retry')}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {terminal && (
                    <button
                      type="button"
                      onClick={() => {
                        notifiedJobStates.delete(job.id)
                        removeJob(job.id)
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,filter] hover:text-foreground hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t('common.dismiss', 'Dismiss')}
                      title={t('common.dismiss', 'Dismiss')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('creationJobs.stopTitle', 'Stop this creation job?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('creationJobs.stopDescription', 'Closing a creation window keeps it running. Stop is explicit and interrupts the current agent session.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmCancel}>
            {t('creationJobs.stopAction', 'Stop job')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
