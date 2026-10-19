import * as React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '../../lib/utils'
import { TodoList } from './TodoList'
import type { TodoItem } from './TurnCard'
import {
  EMPTY_TASK_CARD_MEMORY,
  isTaskCardDocked,
  readTaskCardMemory,
  reduceTaskCardMemory,
  taskStepProgress,
  writeTaskCardMemory,
  type TaskCardEvent,
  type TaskCardMemory,
} from './task-progress'

const PRESENCE = { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const }

function TaskMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  )
}

export function TaskProgressSummary({
  todos,
  expanded,
  onToggle,
  trailing,
  className,
  controls,
}: {
  todos: TodoItem[]
  expanded: boolean
  onToggle: () => void
  trailing?: React.ReactNode
  className?: string
  controls?: string
}) {
  const { t } = useTranslation()
  const progress = taskStepProgress(todos)
  const label = progress.allCompleted
    ? t('taskCard.completed', { current: progress.current, total: progress.total })
    : progress.title
  return (
    <div className={cn('flex items-center gap-1.5 px-3 py-2', className)} data-task-card-summary="">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={expanded}
        aria-controls={controls}
        title={expanded ? t('taskCard.collapse') : t('taskCard.expand')}
        onClick={onToggle}
      >
        {progress.allCompleted ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
        ) : (
          <TaskMark className="-ml-0.5 size-3.5 shrink-0 text-foreground/70" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={label}>
          {label}
        </span>
        {!progress.allCompleted && (
          <span className="shrink-0 text-xs tabular-nums text-foreground/50" data-task-card-progress="">
            {t('taskCard.progress', { current: progress.current, total: progress.total })}
          </span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-foreground/50 transition-transform duration-200 motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {trailing}
    </div>
  )
}

export function TaskTurnSummary({
  todos,
  defaultExpanded = false,
}: {
  todos: TodoItem[]
  defaultExpanded?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const reduceMotion = !!useReducedMotion()
  if (todos.length === 0) return null
  return (
    <div className="mt-3" role="group" aria-label={t('taskCard.review')} data-task-turn-summary="">
      <TaskProgressSummary todos={todos} expanded={expanded} onToggle={() => setExpanded(open => !open)} className="px-0 py-0.5" />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            data-task-turn-summary-panel=""
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : PRESENCE.duration, ease: PRESENCE.ease }}
            className="overflow-hidden"
          >
            <TodoList todos={todos} className="mt-2" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function TaskProgressCard({
  todos,
  expanded,
  onExpandedChange,
  onDismiss,
  showScrollToBottom = false,
  onScrollToBottom,
  compact = false,
  docked = true,
}: {
  todos: TodoItem[]
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onDismiss?: () => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  compact?: boolean
  /** False plays the height/opacity exit, then the slot collapses. */
  docked?: boolean
}) {
  const { t } = useTranslation()
  const reduceMotion = !!useReducedMotion()
  const panelId = useId()
  const progress = taskStepProgress(todos)
  const [mounted, setMounted] = useState(docked)
  const [revealed, setRevealed] = useState(reduceMotion ? docked : false)
  const [clip, setClip] = useState(!reduceMotion)

  useEffect(() => {
    if (docked) setMounted(true)
    else if (reduceMotion) {
      setMounted(false)
      setRevealed(false)
    }
  }, [docked, reduceMotion])

  useEffect(() => {
    if (!mounted || reduceMotion) return
    const frame = requestAnimationFrame(() => setRevealed(docked))
    return () => cancelAnimationFrame(frame)
  }, [docked, mounted, reduceMotion])

  if (todos.length === 0 || !mounted) return null

  const open = reduceMotion ? docked : revealed
  const scrollLabel = t('chat.scrollToBottom')

  return (
    <motion.div
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: reduceMotion ? 0 : PRESENCE.duration, ease: PRESENCE.ease }}
      className={cn(!reduceMotion && clip ? 'overflow-hidden' : 'overflow-visible')}
      onAnimationStart={() => setClip(true)}
      onAnimationComplete={() => {
        if (!docked) setMounted(false)
        else setClip(false)
      }}
      data-task-card-presence=""
    >
      <div className="pb-2">
        <section
          data-task-card=""
          data-task-card-state={progress.allCompleted ? 'complete' : 'active'}
          data-task-card-expanded={expanded ? 'true' : 'false'}
          aria-label={t('taskCard.label')}
          className={cn(
            'bg-background shadow-minimal',
            compact ? 'rounded-[12px]' : 'rounded-[16px]',
          )}
        >
          <TaskProgressSummary
            todos={todos}
            expanded={expanded}
            controls={panelId}
            onToggle={() => onExpandedChange(!expanded)}
            trailing={(
              <>
                {showScrollToBottom && onScrollToBottom && (
                  <button
                    type="button"
                    data-testid="chat-scroll-to-bottom"
                    onClick={onScrollToBottom}
                    aria-label={scrollLabel}
                    title={scrollLabel}
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
                      'border border-foreground/10 bg-background text-foreground/70 shadow-minimal',
                      'transition-colors hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    )}
                  >
                    <ChevronDown className="size-4" />
                  </button>
                )}
                {progress.allCompleted && onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t('taskCard.dismiss')}
                    title={t('taskCard.dismiss')}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </>
            )}
          />
          <div
            id={panelId}
            className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
            style={{
              gridTemplateRows: expanded ? '1fr' : '0fr',
              opacity: expanded ? 1 : 0,
            }}
          >
            <div className={cn('min-h-0', expanded ? 'overflow-visible' : 'overflow-hidden')} aria-hidden={expanded ? undefined : true}>
              <div className="max-h-[40vh] overflow-y-auto overscroll-contain px-3 pb-3">
                <TodoList todos={todos} className="mt-0" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  )
}

export function useSessionTaskCard(
  sessionId: string | null,
  listKey: string | null,
  allCompleted: boolean,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
) {
  const [memory, setMemory] = useState<TaskCardMemory>(() => reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
    type: 'hydrate',
    memory: readTaskCardMemory(sessionId, storage),
    allCompleted,
  }))
  const previous = useRef({ sessionId, listKey, allCompleted, ready: false })

  const commit = React.useCallback((event: TaskCardEvent) => {
    setMemory(current => {
      const next = reduceTaskCardMemory(current, event)
      writeTaskCardMemory(sessionId, next, storage)
      return next
    })
  }, [sessionId, storage])

  useEffect(() => {
    const prior = previous.current
    previous.current = { sessionId, listKey, allCompleted, ready: true }
    if (!prior.ready) return
    if (prior.sessionId !== sessionId) {
      setMemory(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
        type: 'session',
        memory: readTaskCardMemory(sessionId, storage),
        allCompleted,
      }))
      return
    }
    if (!listKey || prior.listKey !== listKey) {
      // A list that is already finished when it first appears starts collapsed,
      // unless this session already has a saved preference.
      if (listKey && allCompleted && !readTaskCardMemory(sessionId, storage)) commit({ type: 'complete' })
      return
    }
    if (!prior.allCompleted && allCompleted) commit({ type: 'complete' })
    else if (prior.allCompleted && !allCompleted) commit({ type: 'resume', key: listKey })
  }, [allCompleted, commit, listKey, sessionId, storage])

  return {
    collapsed: memory.collapsed,
    docked: isTaskCardDocked(memory, listKey),
    toggle: () => commit({ type: 'toggle' }),
    dismiss: () => {
      if (listKey) commit({ type: 'dismiss', key: listKey })
    },
  }
}
