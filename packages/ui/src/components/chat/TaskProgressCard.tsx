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
  TASK_CARD_FADE_MS,
  isTaskCardVisible,
  readTaskCardMemory,
  reduceTaskCardMemory,
  shouldFadeTaskCard,
  snapshotFromTodos,
  taskListSignature,
  taskStepProgress,
  writeTaskCardMemory,
  type TaskCardEvent,
  type TaskCardMemory,
  type TaskCardPhase,
} from './task-progress'

const PRESENCE = { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const }

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

function ProgressRing({ current, total }: { current: number; total: number }) {
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-foreground/70" fill="none" aria-hidden>
      <circle cx="8" cy="8" r={radius} stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={`${circumference * ratio} ${circumference}`}
        transform="rotate(-90 8 8)"
      />
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

function iconButtonClass(extra?: string) {
  return cn(
    'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-foreground/50',
    'transition-colors hover:bg-foreground/5 hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
    extra,
  )
}

export function TaskProgressCard({
  todos,
  phase,
  expanded,
  onExpandedChange,
  onDismiss,
  onHoverChange,
  showScrollToBottom = false,
  onScrollToBottom,
  visible = true,
  onPresenceChange,
}: {
  todos: TodoItem[]
  phase: Exclude<TaskCardPhase, 'hidden'>
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onDismiss?: () => void
  onHoverChange?: (hovering: boolean) => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  /** False plays the fade, then the overlay unmounts. */
  visible?: boolean
  onPresenceChange?: (present: boolean) => void
}) {
  const { t } = useTranslation()
  const reduceMotion = !!useReducedMotion()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const progress = taskStepProgress(todos)
  const [mounted, setMounted] = useState(visible)
  const shapeRef = useRef(expanded)
  if (visible) shapeRef.current = expanded
  const shapeExpanded = visible ? expanded : shapeRef.current
  const shown = visible && mounted
  const present = mounted && todos.length > 0
  const reported = useRef<boolean | null>(null)

  useEffect(() => {
    if (visible) setMounted(true)
    else if (reduceMotion) setMounted(false)
  }, [reduceMotion, visible])

  useEffect(() => {
    if (reported.current === present) return
    reported.current = present
    onPresenceChange?.(present)
  }, [onPresenceChange, present])

  useEffect(() => () => {
    reported.current = null
    onPresenceChange?.(false)
  }, [onPresenceChange])

  useEffect(() => {
    if (!shapeExpanded || !shown) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return
      event.preventDefault()
      onExpandedChange(false)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onExpandedChange(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onExpandedChange, shapeExpanded, shown])

  if (todos.length === 0 || !mounted) return null

  const fraction = t('taskCard.progress', { current: progress.current, total: progress.total })
  const label = phase === 'complete'
    ? t('taskCard.completed', { current: progress.current, total: progress.total })
    : phase === 'interrupted'
      ? t('taskCard.interrupted', { current: progress.current, total: progress.total })
      : progress.title || fraction
  const scrollLabel = t('chat.scrollToBottom')
  const glass = 'border border-foreground/10 bg-background/80 shadow-minimal backdrop-blur-md'
  const hover = (hovering: boolean) => onHoverChange?.(hovering)
  const inside = (event: React.MouseEvent) => {
    const next = event.relatedTarget
    return next instanceof Node && !!rootRef.current?.contains(next)
  }

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-end justify-center gap-1.5 px-4"
      data-task-card-anchor=""
    >
      <motion.section
        data-task-card=""
        data-task-card-state={phase}
        data-task-card-expanded={shapeExpanded ? 'true' : 'false'}
        aria-label={t('taskCard.label')}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: shown ? 1 : 0, scale: shown && !reduceMotion ? 1 : reduceMotion ? 1 : 0.96 }}
        transition={{ duration: reduceMotion ? 0 : PRESENCE.duration, ease: PRESENCE.ease }}
        onAnimationComplete={() => { if (!visible) setMounted(false) }}
        style={{ transformOrigin: 'bottom center' }}
        onMouseEnter={() => hover(true)}
        onMouseLeave={(event) => { if (!inside(event)) hover(false) }}
        className={cn(
          'pointer-events-auto min-w-0',
          glass,
          shapeExpanded
            ? 'w-[min(420px,calc(100%-2.75rem))] rounded-2xl'
            : 'w-max max-w-[min(420px,calc(100%-2.75rem))] rounded-full',
        )}
      >
        <AnimatePresence initial={false} mode="wait">
          {shapeExpanded ? (
            <motion.div
              key="panel"
              id={panelId}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: reduceMotion ? 0 : PRESENCE.duration, ease: PRESENCE.ease }}
            >
              <div className="flex items-center justify-end gap-0.5 px-2 pt-1.5">
                <button
                  type="button"
                  className={iconButtonClass()}
                  aria-expanded
                  aria-controls={panelId}
                  title={t('taskCard.collapse')}
                  onClick={() => onExpandedChange(false)}
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
                {onDismiss && (
                  <button
                    type="button"
                    className={iconButtonClass()}
                    aria-label={t('taskCard.dismiss')}
                    title={t('taskCard.dismiss')}
                    onClick={onDismiss}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              <div className="max-h-[40vh] overflow-y-auto overscroll-contain px-3 pb-3">
                <TodoList todos={todos} showTitle={false} className="mt-0" />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="capsule"
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: reduceMotion ? 0 : PRESENCE.duration, ease: PRESENCE.ease }}
              className="flex min-w-0 items-center"
              data-task-card-summary=""
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1.5 pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-expanded={false}
                aria-controls={panelId}
                title={t('taskCard.expand')}
                onClick={() => onExpandedChange(true)}
              >
                {phase === 'complete' ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                ) : phase === 'interrupted' ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
                ) : (
                  <ProgressRing current={progress.current} total={progress.total} />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={label}>
                  {label}
                </span>
                {phase === 'active' && (
                  <span className="shrink-0 text-xs tabular-nums text-foreground/50" data-task-card-progress="">
                    {fraction}
                  </span>
                )}
                <ChevronDown className="size-3.5 shrink-0 rotate-180 text-foreground/50" aria-hidden />
              </button>
              {onDismiss && (
                <button
                  type="button"
                  className={iconButtonClass('mr-1')}
                  aria-label={t('taskCard.dismiss')}
                  title={t('taskCard.dismiss')}
                  onClick={onDismiss}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
      {showScrollToBottom && onScrollToBottom && (
        <button
          type="button"
          data-testid="chat-scroll-to-bottom"
          onMouseEnter={() => hover(true)}
          onMouseLeave={(event) => { if (!inside(event)) hover(false) }}
          onClick={onScrollToBottom}
          aria-label={scrollLabel}
          title={scrollLabel}
          className={cn(
            'pointer-events-auto inline-flex size-8 shrink-0 items-center justify-center rounded-full',
            'border border-foreground/10 bg-background/90 text-foreground/70 shadow-minimal backdrop-blur-sm',
            'transition-colors hover:bg-background hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <ChevronDown className="size-4" />
        </button>
      )}
    </div>
  )
}

export function useSessionTaskCard(
  sessionId: string | null,
  input: {
    listKey: string | null
    todos: readonly TodoItem[]
    generationEnded: boolean
    userTurnAfterList: boolean
  },
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
) {
  const snapshot = snapshotFromTodos(input.listKey, input.todos, input.generationEnded)
  const signature = taskListSignature(snapshot)
  const userTurnAfterList = input.userTurnAfterList
  const [hovering, setHovering] = useState(false)
  const [memory, setMemory] = useState<TaskCardMemory>(() => reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
    type: 'hydrate',
    memory: readTaskCardMemory(sessionId, storage),
    snapshot,
    userTurnAfterList,
  }))
  const previous = useRef({ sessionId, signature, userTurnAfterList, ready: false })
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const commit = React.useCallback((event: TaskCardEvent) => {
    setMemory(current => {
      const next = reduceTaskCardMemory(current, event)
      writeTaskCardMemory(sessionId, next, storage)
      return next
    })
  }, [sessionId, storage])

  useEffect(() => {
    const prior = previous.current
    previous.current = { sessionId, signature, userTurnAfterList, ready: true }
    if (!prior.ready) return
    const currentSnapshot = snapshotRef.current
    if (prior.sessionId !== sessionId) {
      setHovering(false)
      setMemory(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
        type: 'session',
        memory: readTaskCardMemory(sessionId, storage),
        snapshot: currentSnapshot,
        userTurnAfterList,
      }))
      return
    }
    if (prior.signature !== signature) {
      commit({ type: 'list', snapshot: currentSnapshot, userTurnAfterList })
    }
    if (!prior.userTurnAfterList && userTurnAfterList) {
      commit({ type: 'user-message', snapshot: currentSnapshot })
    }
  }, [commit, sessionId, signature, storage, userTurnAfterList])

  useEffect(() => {
    if (!shouldFadeTaskCard(memory, hovering)) return
    const timer = window.setTimeout(() => commit({ type: 'fade' }), TASK_CARD_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [commit, hovering, memory])

  const phaseRef = useRef<Exclude<TaskCardPhase, 'hidden'>>('active')
  if (memory.phase !== 'hidden') phaseRef.current = memory.phase

  return {
    visible: isTaskCardVisible(memory),
    expanded: memory.expanded && memory.phase !== 'hidden',
    phase: memory.phase === 'hidden' ? phaseRef.current : memory.phase,
    docked: isTaskCardVisible(memory),
    toggle: () => commit({ type: 'toggle' }),
    setExpanded: (expanded: boolean) => commit({ type: 'expand', expanded }),
    collapse: () => commit({ type: 'collapse' }),
    dismiss: () => commit({ type: 'dismiss', snapshot }),
    setHovering,
  }
}
