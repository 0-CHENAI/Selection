import * as React from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown } from 'lucide-react'
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { taskCardContentMotion, taskCardRestingBox, taskCardScrollDockFrame, taskCardShellSize, type TaskCardBox, type TaskCardMotionDirection } from './task-card-motion'
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
import {
  TOOLBAR_BUTTON_GAP,
  TOOLBAR_CAPSULE_RADIUS,
  TOOLBAR_CONTROL_HEIGHT,
  TOOLBAR_SCROLL_SIZE,
  TOOLBAR_SHELL_MAX,
} from './toolbar-capsule-fit'

const EASE = [0.23, 1, 0.32, 1] as const
const ENTER = { duration: 0.18, ease: EASE }
// Real width/height, not a scale transform. Bounce 0 keeps the border circular.
const SHELL_SPRING = { type: 'spring' as const, bounce: 0, duration: 0.32 }
// Fixed radius. A ~32px capsule clamps into a pill; the panel keeps 16px corners.
const FIXED_RADIUS = 16
const CONTENT_BLUR = 'blur(4px)'
const BUTTON_GAP = TOOLBAR_BUTTON_GAP

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

function PanelFrame({
  panelId,
  panelWidth,
  heading,
  todos,
  listSeed,
  onCollapse,
  collapseLabel,
}: {
  panelId: string
  panelWidth: number
  heading: string
  todos: TodoItem[]
  listSeed?: string
  onCollapse: () => void
  collapseLabel: string
  toolbar?: boolean
}) {
  return (
    <div data-task-card-frame="panel" style={{ width: panelWidth }}>
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
          title={collapseLabel}
          onClick={onCollapse}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="max-h-[40vh] overflow-y-auto overscroll-contain px-3 pb-3">
        <TodoList todos={todos} listSeed={listSeed} showTitle={false} className="mt-0" />
      </div>
    </div>
  )
}

function CapsuleFrame({
  panelId,
  panelWidth,
  phase,
  progress,
  fraction,
  expandLabel,
  onExpand,
  toolbar = false,
  probe = false,
  unbounded = false,
}: {
  panelId: string
  panelWidth: number
  phase: Exclude<TaskCardPhase, 'hidden'>
  progress: ReturnType<typeof taskStepProgress>
  fraction: string
  expandLabel: string
  onExpand: () => void
  /** Sit in the composer toolbar: 30px shell, 12px type, pill ends. */
  toolbar?: boolean
  probe?: boolean
  unbounded?: boolean
}) {
  return (
    <div
      data-task-card-frame={probe ? undefined : 'capsule'}
      data-task-card-summary={probe ? undefined : ''}
      style={unbounded ? undefined : { maxWidth: panelWidth }}
      className={cn(
        'flex w-max min-w-0 items-center',
        !toolbar && 'max-w-[min(420px,calc(100%-2.75rem))]',
        toolbar && 'overflow-hidden',
      )}
    >
      <button
        type="button"
        tabIndex={probe ? -1 : undefined}
        className={cn(
          'flex min-w-0 max-w-full flex-1 items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          toolbar
            ? 'h-7 gap-1.5 rounded-full pl-2.5 pr-2 text-xs font-medium'
            : 'gap-2 rounded-full py-1.5 pl-3 pr-3',
        )}
        aria-expanded={false}
        aria-controls={probe ? undefined : panelId}
        title={expandLabel}
        onClick={probe ? undefined : onExpand}
      >
        {phase === 'complete' ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
        ) : phase === 'interrupted' ? (
          <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
        ) : (
          <ProgressRing current={progress.current} total={progress.total} />
        )}
        <span className="shrink-0 text-xs tabular-nums text-foreground/50" data-task-card-progress="">
          {fraction}
        </span>
        <ChevronDown className="size-3.5 shrink-0 rotate-180 text-foreground/50" aria-hidden />
      </button>
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
  motionSample,
  placement = 'overlay',
  shellMaxWidth,
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
  /** Pin the shape crossfade at 0 (capsule) to 1 (panel). Used to inspect frames. */
  motionSample?: number
  /** Overlay floats over the transcript. Toolbar docks the capsule in the composer row. */
  placement?: 'overlay' | 'toolbar'
  /** Measured width the centered toolbar shell may use before it meets the side buttons. */
  shellMaxWidth?: number
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
  const toolbar = placement === 'toolbar'
  const scrollShown = !!(showScrollToBottom && onScrollToBottom)
  const dockedScroll = toolbar && onScreen
  // 0 = tucked into the pill's right edge. 1 = full control.
  // Plain numbers, not motion styles: the first commit must already be the
  // tucked pose. A motion value applied after mount paints the resting size first.
  const dockTRef = useRef(0)
  const centerTRef = useRef(0)
  const [dockT, setDockT] = useState(0)
  const [centerT, setCenterT] = useState(0)
  const scrollShownRef = useRef(scrollShown)
  scrollShownRef.current = scrollShown
  const [scrollHold, setScrollHold] = useState(false)
  const prevDockedScroll = useRef<boolean | null>(null)
  if (prevDockedScroll.current !== null && prevDockedScroll.current !== dockedScroll && scrollShown) {
    // The pill mounted or left while the button was already up. Don't replay the grow.
    if (dockedScroll && dockTRef.current !== 1) {
      dockTRef.current = 1
      setDockT(1)
    }
    if (!dockedScroll && centerTRef.current !== 1) {
      centerTRef.current = 1
      setCenterT(1)
    }
  }
  prevDockedScroll.current = dockedScroll
  if (scrollShown && !scrollHold) setScrollHold(true)
  const shellRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef(true)
  const boxSpring = useRef<{ stop: () => void } | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const [shapes, setShapes] = useState<{ panel: TaskCardBox; capsule: TaskCardBox } | null>(null)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const directionRef = useRef<TaskCardMotionDirection>(shapeExpanded ? 'expand' : 'collapse')
  const shapeProgress = useMotionValue(shapeExpanded ? 1 : 0)
  const shellWidth = useMotionValue<number | undefined>(undefined)
  const shellHeight = useMotionValue<number | undefined>(undefined)
  const panelOpacity = useMotionValue(shapeExpanded ? 1 : 0)
  const capsuleOpacity = useMotionValue(shapeExpanded ? 0 : 1)
  const panelY = useMotionValue(0)
  const capsuleY = useMotionValue(0)
  const panelFilter = useMotionValue('blur(0px)')
  const capsuleFilter = useMotionValue('blur(0px)')
  const panelPointer = useMotionValue<'auto' | 'none'>(shapeExpanded ? 'auto' : 'none')
  const capsulePointer = useMotionValue<'auto' | 'none'>(shapeExpanded ? 'none' : 'auto')
  const shellRadius = useMotionValue(toolbar && !shapeExpanded ? TOOLBAR_CAPSULE_RADIUS : FIXED_RADIUS)
  const [crossfade, setCrossfade] = useState(false)
  const [mounted, setMounted] = useState(false)
  const toolbarShellMax = toolbar
    ? Math.max(0, Math.min(TOOLBAR_SHELL_MAX, Math.floor(shellMaxWidth ?? TOOLBAR_SHELL_MAX)))
    : null

  const publishShape = React.useCallback((value: number) => {
    const current = shapesRef.current
    if (!current) return
    const frame = taskCardContentMotion({
      progress: value,
      panel: current.panel,
      capsule: current.capsule,
      direction: directionRef.current,
      reduceMotion,
    })
    shellWidth.set(frame.width)
    shellHeight.set(frame.height)
    panelOpacity.set(frame.panelOpacity)
    capsuleOpacity.set(frame.capsuleOpacity)
    panelY.set(frame.panelY)
    capsuleY.set(frame.capsuleY)
    panelFilter.set(frame.panelBlur >= 4 ? CONTENT_BLUR : frame.panelBlur > 0 ? `blur(${frame.panelBlur}px)` : 'blur(0px)')
    capsuleFilter.set(frame.capsuleBlur >= 4 ? CONTENT_BLUR : frame.capsuleBlur > 0 ? `blur(${frame.capsuleBlur}px)` : 'blur(0px)')
    panelPointer.set(frame.panelOpacity > 0.05 ? 'auto' : 'none')
    capsulePointer.set(frame.capsuleOpacity > 0.05 ? 'auto' : 'none')
    shellRadius.set(toolbar
      ? TOOLBAR_CAPSULE_RADIUS + value * (FIXED_RADIUS - TOOLBAR_CAPSULE_RADIUS)
      : FIXED_RADIUS)
  }, [capsuleFilter, capsuleOpacity, capsulePointer, capsuleY, panelFilter, panelOpacity, panelPointer, panelY, reduceMotion, shellHeight, shellRadius, shellWidth, toolbar])

  useEffect(() => {
    setMounted(true)
  }, [])

  useIsoLayoutEffect(() => {
    const anchor = rootRef.current
    const shell = shellRef.current
    const measure = measureRef.current
    if (!anchor || !shell || !measure) return
    measure.setAttribute('inert', '')

    const read = () => {
      if (!shownRef.current) return
      const nextPanel = toolbarShellMax ?? readPanelWidth(anchor)
      const panelFrame = measure.querySelector<HTMLElement>('[data-task-card-frame="panel"]')
      const capsuleFrame = measure.querySelector<HTMLElement>('[data-task-card-frame="capsule"]')
      if (panelFrame) panelFrame.style.width = `${nextPanel}px`
      if (capsuleFrame) capsuleFrame.style.maxWidth = `${nextPanel}px`
      setPanelWidth(prev => prev === nextPanel ? prev : nextPanel)
      if (!panelFrame || !capsuleFrame) return
      const shellStyle = getComputedStyle(shell)
      const borderX = (parseFloat(shellStyle.borderLeftWidth) || 0) + (parseFloat(shellStyle.borderRightWidth) || 0)
      const borderY = (parseFloat(shellStyle.borderTopWidth) || 0) + (parseFloat(shellStyle.borderBottomWidth) || 0)
      const panelBox = {
        width: Math.ceil(panelFrame.offsetWidth + borderX),
        height: Math.ceil(panelFrame.offsetHeight + borderY),
      }
      const capsuleBox = {
        width: Math.ceil(capsuleFrame.offsetWidth + borderX),
        height: Math.ceil(capsuleFrame.offsetHeight + borderY),
      }
      if (panelBox.width <= 0 || panelBox.height <= 0 || capsuleBox.width <= 0 || capsuleBox.height <= 0) return
      setShapes(prev => prev
        && prev.panel.width === panelBox.width && prev.panel.height === panelBox.height
        && prev.capsule.width === capsuleBox.width && prev.capsule.height === capsuleBox.height
        ? prev
        : { panel: panelBox, capsule: capsuleBox })
    }

    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(anchor)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [mounted, present, shapeExpanded, shellMaxWidth, showScrollToBottom, toolbar, toolbarShellMax])

  useEffect(() => {
    if (!shapes) return
    setCrossfade(true)
    if (motionSample != null) {
      boxSpring.current?.stop()
      boxSpring.current = null
      shapeProgress.set(motionSample)
      publishShape(motionSample)
      return
    }
    const progress = shapeProgress.get()
    const resting = progress <= 0.001 || progress >= 0.999
    // Expand and collapse already spring the shell. A resting count change must not snap.
    if (!resting && !snapRef.current) return
    const next = taskCardShellSize(progress, shapes.panel, shapes.capsule)
    const widthNow = shellWidth.get()
    const heightNow = shellHeight.get()
    if (reduceMotion || snapRef.current || widthNow == null || heightNow == null) {
      boxSpring.current?.stop()
      boxSpring.current = null
      publishShape(progress)
      return
    }
    if (Math.abs(widthNow - next.width) < 0.5 && Math.abs(heightNow - next.height) < 0.5) {
      boxSpring.current?.stop()
      boxSpring.current = null
      publishShape(progress)
      return
    }
    boxSpring.current?.stop()
    const from = { width: widthNow, height: heightNow }
    const controls = animate(0, 1, {
      ...SHELL_SPRING,
      onUpdate: (t) => {
        const box = taskCardRestingBox(from, next, t)
        shellWidth.set(box.width)
        shellHeight.set(box.height)
      },
    })
    boxSpring.current = controls
    return () => {
      controls.stop()
      if (boxSpring.current === controls) boxSpring.current = null
    }
  }, [motionSample, publishShape, reduceMotion, shapeProgress, shapes, shellHeight, shellWidth])

  const shapesReady = shapes != null
  useEffect(() => {
    if (!shapesRef.current || motionSample != null) return
    boxSpring.current?.stop()
    boxSpring.current = null
    directionRef.current = shapeExpanded ? 'expand' : 'collapse'
    const target = shapeExpanded ? 1 : 0
    if (reduceMotion || snapRef.current) {
      shapeProgress.set(target)
      publishShape(target)
      snapRef.current = false
      return
    }
    const controls = animate(shapeProgress, target, { ...SHELL_SPRING, onUpdate: publishShape })
    return () => controls.stop()
  }, [motionSample, publishShape, reduceMotion, shapeExpanded, shapeProgress, shapesReady])

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

  useIsoLayoutEffect(() => {
    if (!toolbar) return
    const target = scrollShown ? 1 : 0
    const leadRef = dockedScroll ? dockTRef : centerTRef
    const setLead = dockedScroll ? setDockT : setCenterT
    if (reduceMotion) {
      leadRef.current = target
      setLead(target)
      if (!scrollShown) setScrollHold(false)
      return
    }
    if (leadRef.current === target) {
      if (!scrollShown) setScrollHold(false)
      return
    }
    let stopped = false
    const controls = animate(leadRef.current, target, {
      ...(dockedScroll ? SHELL_SPRING : { duration: ENTER.duration, ease: ENTER.ease }),
      onUpdate: (value) => {
        if (stopped) return
        leadRef.current = value
        setLead(value)
      },
      onComplete: () => {
        if (!scrollShownRef.current) setScrollHold(false)
      },
    })
    return () => {
      stopped = true
      controls.stop()
    }
  }, [dockedScroll, reduceMotion, scrollShown, toolbar])

  if (!onScreen && !scrollShown && !scrollHold) return null

  const fraction = t('taskCard.progress', { current: progress.current, total: progress.total })
  const heading = t('taskCard.heading', { current: progress.current, total: progress.total })
  const scrollLabel = t('chat.scrollToBottom')
  const glass = 'border border-foreground/10 bg-background/80 shadow-minimal backdrop-blur-md'
  const exitSeconds = reduceMotion ? 0 : TASK_CARD_EXIT_MS / 1000
  const fade = { duration: reduceMotion ? 0 : ENTER.duration, ease: ENTER.ease }
  const buttonGap = scrollShown ? BUTTON_GAP : 0
  // Layout budget for the side buttons. The visual group is centered on its live
  // width, so this reserve is not copied into the translate (that offset jumps).
  const toolbarEndReserve = dockedScroll && (scrollShown || scrollHold) ? TOOLBAR_SCROLL_SIZE + BUTTON_GAP : 0
  const dockFrame = taskCardScrollDockFrame(dockT, TOOLBAR_SCROLL_SIZE, BUTTON_GAP)
  const scrollVisual = dockedScroll
    ? { width: dockFrame.span, opacity: dockFrame.opacity }
    : { width: TOOLBAR_SCROLL_SIZE, opacity: centerT }
  const scrollInteractive = dockedScroll ? dockT >= 0.999 : centerT >= 0.999
  const restingCapsulePx = shapes?.capsule.height ?? TOOLBAR_CONTROL_HEIGHT
  const frameWidth = toolbarShellMax ?? panelWidth
  const frameProps = {
    panelId,
    panelWidth: frameWidth,
    heading,
    todos,
    listSeed,
    phase,
    progress,
    fraction,
    toolbar,
    collapseLabel: t('taskCard.collapse'),
    expandLabel: t('taskCard.expand'),
    onCollapse: () => onExpandedChange(false),
    onExpand: () => onExpandedChange(true),
  }
  const restingRadius = toolbar && !shapeExpanded ? TOOLBAR_CAPSULE_RADIUS : FIXED_RADIUS

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        data-task-card-anchor=""
        data-task-card-placement={placement}
        data-task-card-end-reserve={toolbar ? toolbarEndReserve : undefined}
        className={cn(
          'pointer-events-none z-20 flex items-end',
          toolbar
            ? 'absolute left-1/2'
            : 'absolute inset-x-0 bottom-3 justify-center px-4',
        )}
        style={toolbar ? {
          bottom: `calc(50% - ${restingCapsulePx}px / 2)`,
          // Live width includes the growing button, so -50% shifts the pill left
          // on the same frame the button grows. A fixed endReserve offset jumps.
          transform: 'translateX(-50%)',
        } : undefined}
      >
        {toolbar && onScreen && (
          <>
            <div
              data-task-card-cluster="min"
              className="pointer-events-none invisible absolute left-0 top-0 flex w-max border border-transparent"
              aria-hidden
            >
              <CapsuleFrame {...frameProps} toolbar unbounded probe />
            </div>
            <div
              data-task-card-cluster="natural"
              className="pointer-events-none invisible absolute left-0 top-0 flex w-max border border-transparent"
              aria-hidden
            >
              <CapsuleFrame {...frameProps} toolbar unbounded probe />
            </div>
          </>
        )}
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
              animate={toolbar ? { opacity: 1 } : { opacity: 1, marginRight: buttonGap }}
              exit={toolbar ? {
                opacity: 0,
                transition: reduceMotion ? { duration: 0 } : { opacity: { duration: exitSeconds, ease: EASE } },
              } : {
                opacity: 0,
                marginRight: 0,
                transition: reduceMotion
                  ? { duration: 0 }
                  : { marginRight: SHELL_SPRING, opacity: { duration: exitSeconds, ease: EASE } },
              }}
              transition={toolbar
                ? { opacity: fade }
                : { marginRight: reduceMotion ? { duration: 0 } : SHELL_SPRING, opacity: fade }}
              style={{
                borderRadius: toolbar && crossfade ? shellRadius : restingRadius,
                overflow: 'hidden',
                width: crossfade ? shellWidth : undefined,
                height: crossfade ? shellHeight : undefined,
              }}
              className={cn(
                'pointer-events-auto relative z-[1] min-w-0 shrink-0',
                glass,
                !crossfade && (toolbar
                  ? (shapeExpanded ? undefined : 'w-max')
                  : (shapeExpanded
                    ? 'w-[min(420px,calc(100%-2.75rem))]'
                    : 'w-max max-w-[min(420px,calc(100%-2.75rem))]')),
              )}
            >
              {mounted && (
                <div
                  ref={measureRef}
                  className="pointer-events-none invisible absolute left-0 top-0 -z-10"
                  aria-hidden
                >
                  <PanelFrame {...frameProps} />
                  <CapsuleFrame {...frameProps} />
                </div>
              )}
              {crossfade ? (
                <div className="relative h-full w-full">
                  <motion.div
                    id={panelId}
                    data-task-card-layer="panel"
                    className="absolute bottom-0 left-0"
                    style={{ opacity: panelOpacity, y: panelY, filter: panelFilter, pointerEvents: panelPointer }}
                  >
                    <PanelFrame {...frameProps} />
                  </motion.div>
                  <motion.div
                    data-task-card-layer="capsule"
                    className="absolute bottom-0 left-0"
                    style={{ opacity: capsuleOpacity, y: capsuleY, filter: capsuleFilter, pointerEvents: capsulePointer }}
                  >
                    <CapsuleFrame {...frameProps} />
                  </motion.div>
                </div>
              ) : shapeExpanded ? (
                <div id={panelId}>
                  <PanelFrame {...frameProps} />
                </div>
              ) : (
                <CapsuleFrame {...frameProps} />
              )}
            </motion.section>
          )}
        </AnimatePresence>
        {(toolbar ? scrollShown || scrollHold : scrollShown) && (
          toolbar ? (
            <button
              type="button"
              data-testid="chat-scroll-to-bottom"
              data-toolbar-scroll={onScreen ? 'docked' : 'center'}
              data-scroll-dock-width={scrollVisual.width}
              data-scroll-dock-opacity={scrollVisual.opacity}
              onClick={onScrollToBottom}
              aria-label={scrollLabel}
              title={scrollLabel}
              style={{ width: scrollVisual.width, opacity: scrollVisual.opacity }}
              className={cn(
                'relative z-0 inline-flex h-[30px] min-w-0 shrink-0 p-0',
                scrollInteractive ? 'pointer-events-auto' : 'pointer-events-none',
                // Clip while growing so the circle stays behind the pill's right edge.
                // At rest, overflow stays visible so the shadow is not cut off.
                dockedScroll && !scrollInteractive ? 'overflow-hidden' : 'overflow-visible',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              )}
            >
              <span
                className={cn(
                  'absolute right-0 top-0 inline-flex size-[30px] items-center justify-center rounded-full',
                  'border border-foreground/10 bg-background/90 text-foreground/70 shadow-minimal backdrop-blur-sm',
                  'transition-colors hover:bg-background hover:text-foreground',
                )}
              >
                <ChevronDown className="size-4" />
              </span>
            </button>
          ) : (
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
          )
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
