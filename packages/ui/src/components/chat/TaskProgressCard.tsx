import * as React from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { cn } from '../../lib/utils'
import { TodoList } from './TodoList'
import type { TodoItem } from './TurnCard'
import {
  EMPTY_TASK_CARD_MEMORY,
  TASK_CARD_EXIT_MS,
  isTaskCardVisible,
  reduceTaskCardMemory,
  snapshotFromTodos,
  taskListSignature,
  taskStepProgress,
  taskTurnInterrupted,
  type TaskCardEvent,
  type TaskCardMemory,
  type TaskCardPhase,
} from './task-progress'

const EASE = [0.23, 1, 0.32, 1] as const
const ENTER = { duration: 0.18, ease: EASE }
// Real width/height, not a scale transform. Bounce 0 keeps the border circular.
const SHELL_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.32 }
// Fixed radius. A ~32px capsule clamps into a pill; the panel keeps 16px corners.
const FIXED_RADIUS = 16
const CONTENT_BLUR = 'blur(4px)'
const BUTTON_GAP = 6

type ShellSize = { width: number; height: number }

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function readPanelWidth(anchor: HTMLElement): number {
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const style = getComputedStyle(anchor)
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  const available = anchor.clientWidth - pad - 2.75 * rootFont
  return Math.max(0, Math.min(420, Math.floor(available)))
}

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
  settled = false,
}: {
  todos: TodoItem[]
  expanded: boolean
  onToggle: () => void
  trailing?: React.ReactNode
  className?: string
  controls?: string
  /** The turn has finished, so leftover work reads as interrupted. */
  settled?: boolean
}) {
  const { t } = useTranslation()
  const progress = taskStepProgress(todos)
  const interrupted = taskTurnInterrupted(todos, settled)
  const label = progress.allCompleted
    ? t('taskCard.completed', { current: progress.current, total: progress.total })
    : interrupted
      ? t('taskCard.interrupted', { current: progress.current, total: progress.total })
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
        {!progress.allCompleted && !interrupted && (
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
  settled = false,
  listSeed,
}: {
  todos: TodoItem[]
  defaultExpanded?: boolean
  /** The turn has finished, so leftover work reads as interrupted. */
  settled?: boolean
  /** Same seed the floating card used, so the rail shape matches. */
  listSeed?: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const reduceMotion = !!useReducedMotion()
  if (todos.length === 0) return null
  return (
    <div className="mt-3" role="group" aria-label={t('taskCard.review')} data-task-turn-summary="">
      <TaskProgressSummary
        todos={todos}
        expanded={expanded}
        settled={settled}
        onToggle={() => setExpanded(open => !open)}
        className="px-0 py-0.5"
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            data-task-turn-summary-panel=""
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : ENTER.duration, ease: ENTER.ease }}
            className="overflow-hidden"
          >
            <TodoList todos={todos} listSeed={listSeed} className="mt-2" />
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
  showScrollToBottom = false,
  onScrollToBottom,
  visible = true,
  onPresenceChange,
  listSeed,
}: {
  todos: TodoItem[]
  phase: Exclude<TaskCardPhase, 'hidden'>
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  /** False plays the fade, then the capsule unmounts. The scroll button can stay. */
  visible?: boolean
  onPresenceChange?: (present: boolean) => void
  /** Same seed the history summary uses, so the rail shape matches. */
  listSeed?: string
}) {
  const { t } = useTranslation()
  const reduceMotion = !!useReducedMotion()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const cardShown = visible && todos.length > 0
  const shownRef = useRef(cardShown)
  shownRef.current = cardShown
  const [present, setPresent] = useState(cardShown)
  if (cardShown && !present) setPresent(true)
  const progress = taskStepProgress(todos)
  const shapeRef = useRef(expanded)
  if (cardShown) shapeRef.current = expanded
  const shapeExpanded = cardShown ? expanded : shapeRef.current
  const onScreen = cardShown || present
  const shellRef = useRef<HTMLElement>(null)
  const sizerRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef(true)
  const [panelWidth, setPanelWidth] = useState(420)
  const [shellSize, setShellSize] = useState<ShellSize | null>(null)

  useIsoLayoutEffect(() => {
    const anchor = rootRef.current
    const shell = shellRef.current
    const sizer = sizerRef.current
    if (!anchor || !shell || !sizer) return

    const measure = () => {
      if (!shownRef.current) return
      const nextPanel = readPanelWidth(anchor)
      const frame = sizer.querySelector<HTMLElement>('[data-task-card-frame]')
      if (frame?.dataset.taskCardFrame === 'panel') frame.style.width = `${nextPanel}px`
      if (frame?.dataset.taskCardFrame === 'capsule') frame.style.maxWidth = `${nextPanel}px`
      setPanelWidth(prev => prev === nextPanel ? prev : nextPanel)
      const shellStyle = getComputedStyle(shell)
      const borderX = (parseFloat(shellStyle.borderLeftWidth) || 0) + (parseFloat(shellStyle.borderRightWidth) || 0)
      const borderY = (parseFloat(shellStyle.borderTopWidth) || 0) + (parseFloat(shellStyle.borderBottomWidth) || 0)
      const width = Math.ceil(sizer.offsetWidth + borderX)
      const height = Math.ceil(sizer.offsetHeight + borderY)
      if (width <= 0 || height <= 0) return
      setShellSize(prev => prev && prev.width === width && prev.height === height ? prev : { width, height })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    observer.observe(sizer)
    return () => observer.disconnect()
  }, [present, shapeExpanded, showScrollToBottom])

  useIsoLayoutEffect(() => {
    if (shellSize) snapRef.current = false
  }, [shellSize])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    onPresenceChange?.(onScreen)
  }, [onPresenceChange, onScreen])

  useEffect(() => () => {
    onPresenceChange?.(false)
  }, [onPresenceChange])

  useEffect(() => {
    if (!shapeExpanded || !cardShown) return
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
  }, [cardShown, onExpandedChange, shapeExpanded])

  if (!onScreen && !showScrollToBottom) return null

  const fraction = t('taskCard.progress', { current: progress.current, total: progress.total })
  const heading = t('taskCard.heading', { current: progress.current, total: progress.total })
  const label = phase === 'complete'
    ? t('taskCard.completed', { current: progress.current, total: progress.total })
    : phase === 'interrupted'
      ? t('taskCard.interrupted', { current: progress.current, total: progress.total })
      : progress.title || fraction
  const scrollLabel = t('chat.scrollToBottom')
  const glass = 'border border-foreground/10 bg-background/80 shadow-minimal backdrop-blur-md'
  const exitSeconds = reduceMotion ? 0 : TASK_CARD_EXIT_MS / 1000
  const fade = { duration: reduceMotion ? 0 : ENTER.duration, ease: ENTER.ease }
  const buttonGap = showScrollToBottom && onScrollToBottom ? BUTTON_GAP : 0
  const snap = snapRef.current || reduceMotion
  const shellTransition = {
    width: snap ? { duration: 0 } : SHELL_SPRING,
    height: snap ? { duration: 0 } : SHELL_SPRING,
    marginRight: snap ? { duration: 0 } : SHELL_SPRING,
    opacity: fade,
  }
  const contentInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, filter: CONTENT_BLUR }
  const contentAnimate = { opacity: 1, y: 0, filter: 'blur(0px)' }
  const contentExit = reduceMotion
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0, y: -4, filter: CONTENT_BLUR, transition: { duration: 0.14, ease: EASE } }

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-end justify-center px-4"
        data-task-card-anchor=""
      >
        <AnimatePresence
          initial={false}
          onExitComplete={() => {
            if (!alive.current || shownRef.current) return
            setPresent(false)
          }}
        >
          {cardShown && (
            <motion.section
              key="task-card"
              ref={shellRef}
              data-task-card=""
              data-task-card-state={phase}
              data-task-card-expanded={shapeExpanded ? 'true' : 'false'}
              aria-label={t('taskCard.label')}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={shellSize
                ? { opacity: 1, width: shellSize.width, height: shellSize.height, marginRight: buttonGap }
                : { opacity: 1, marginRight: buttonGap }}
              exit={{
                opacity: 0,
                width: 0,
                height: 0,
                marginRight: 0,
                transition: reduceMotion
                  ? { duration: 0 }
                  : {
                      width: SHELL_SPRING,
                      height: SHELL_SPRING,
                      marginRight: SHELL_SPRING,
                      opacity: { duration: exitSeconds, ease: EASE },
                    },
              }}
              transition={shellTransition}
              style={{ borderRadius: FIXED_RADIUS, overflow: 'hidden' }}
              className={cn(
                'pointer-events-auto relative min-w-0 shrink-0',
                glass,
                !shellSize && (shapeExpanded
                  ? 'w-[min(420px,calc(100%-2.75rem))]'
                  : 'w-max max-w-[min(420px,calc(100%-2.75rem))]'),
              )}
            >
              <div ref={sizerRef} className="w-max">
                <AnimatePresence mode="wait" initial={false}>
                  {shapeExpanded ? (
                    <motion.div
                      key="panel"
                      id={panelId}
                      data-task-card-frame="panel"
                      style={{ width: panelWidth }}
                      initial={contentInitial}
                      animate={contentAnimate}
                      exit={contentExit}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE }}
                    >
                      <div className="flex items-center gap-1 pl-3 pr-1.5 pt-1.5">
                        <p
                          className="min-w-0 flex-1 truncate py-1 text-[13px] font-medium text-foreground"
                          data-task-card-heading=""
                        >
                          {heading}
                        </p>
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
                      </div>
                      <div className="max-h-[40vh] overflow-y-auto overscroll-contain px-3 pb-3">
                        <TodoList todos={todos} listSeed={listSeed} showTitle={false} className="mt-0" />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="capsule"
                      data-task-card-frame="capsule"
                      data-task-card-summary=""
                      style={{ maxWidth: panelWidth }}
                      initial={contentInitial}
                      animate={contentAnimate}
                      exit={contentExit}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE }}
                      className="flex w-max min-w-0 max-w-[min(420px,calc(100%-2.75rem))] items-center"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1.5 pl-3 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
        {showScrollToBottom && onScrollToBottom && (
          <button
            type="button"
            data-testid="chat-scroll-to-bottom"
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
    </MotionConfig>
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
) {
  const snapshot = snapshotFromTodos(input.listKey, input.todos, input.generationEnded)
  const signature = taskListSignature(snapshot)
  const userTurnAfterList = input.userTurnAfterList
  const [memory, setMemory] = useState<TaskCardMemory>(() => reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
    type: 'hydrate',
    snapshot,
    userTurnAfterList,
  }))
  const previous = useRef({ sessionId, signature, userTurnAfterList, ready: false })
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const commit = React.useCallback((event: TaskCardEvent) => {
    setMemory(current => reduceTaskCardMemory(current, event))
  }, [])

  useEffect(() => {
    const prior = previous.current
    previous.current = { sessionId, signature, userTurnAfterList, ready: true }
    if (!prior.ready) return
    const currentSnapshot = snapshotRef.current
    if (prior.sessionId !== sessionId) {
      setMemory(reduceTaskCardMemory(EMPTY_TASK_CARD_MEMORY, {
        type: 'session',
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
  }, [commit, sessionId, signature, userTurnAfterList])

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
  }
}
