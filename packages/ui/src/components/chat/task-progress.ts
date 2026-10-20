import type { TodoItem } from './TurnCard'

export type TodoRailMode = 'full' | 'summary' | 'hidden'

export type TaskCardPhase = 'hidden' | 'active' | 'complete' | 'interrupted'

/**
 * One session's capsule for this process. Expanded is remembered per session.
 * `dismissed` means a later user message closed this list — not a manual close,
 * and not a session switch.
 */
export interface TaskCardMemory {
  expanded: boolean
  phase: TaskCardPhase
  listKey: string | null
  dismissed: boolean
}

export interface TaskListSnapshot {
  key: string | null
  ids: string[]
  incompleteIds: string[]
  total: number
  completed: number
  allCompleted: boolean
  hasIncomplete: boolean
  /** The turn has stopped, so an open list is no longer live. */
  generationEnded: boolean
  /** Stop, error, or the turn ended while work is still open. */
  interrupted: boolean
}

export type TaskCardEvent =
  | { type: 'hydrate' | 'session'; snapshot: TaskListSnapshot; userTurnAfterList: boolean }
  | { type: 'list'; snapshot: TaskListSnapshot; userTurnAfterList: boolean }
  | { type: 'user-message'; snapshot: TaskListSnapshot }
  | { type: 'toggle' }
  | { type: 'expand'; expanded: boolean }
  | { type: 'collapse' }

export const EMPTY_TASK_CARD_MEMORY: TaskCardMemory = {
  expanded: false,
  phase: 'hidden',
  listKey: null,
  dismissed: false,
}

/** Capsules for every session touched in this process. Not written to disk. */
export interface SessionTaskCards {
  bySession: Readonly<Record<string, TaskCardMemory>>
}

export const EMPTY_SESSION_TASK_CARDS: SessionTaskCards = { bySession: {} }

export type SessionTaskCardEvent =
  | { type: 'show'; sessionId: string; snapshot: TaskListSnapshot; userTurnAfterList: boolean }
  | { type: 'user-message'; sessionId: string; snapshot: TaskListSnapshot }
  | { type: 'toggle'; sessionId: string }
  | { type: 'expand'; sessionId: string; expanded: boolean }
  | { type: 'collapse'; sessionId: string }

/** Opacity fade when a finished capsule leaves for the next round. */
export const TASK_CARD_EXIT_MS = 200

/** Former transcript gap. The capsule now sits in the composer toolbar, so the list does not reserve this. */
export const TASK_CARD_CAPSULE_CLEARANCE = 48

export function taskStepProgress(todos: readonly TodoItem[]): {
  current: number
  total: number
  title: string
  allCompleted: boolean
} {
  const total = todos.length
  const allCompleted = total > 0 && todos.every(item => item.status === 'completed')
  if (allCompleted) return { current: total, total, title: '', allCompleted: true }

  const activeIndex = todos.findIndex(item => item.status === 'in_progress')
  if (activeIndex >= 0) {
    const active = todos[activeIndex]
    return {
      current: activeIndex + 1,
      total,
      title: active?.activeForm?.trim() || active?.content || '',
      allCompleted: false,
    }
  }

  const nextIndex = todos.findIndex(item => item.status !== 'completed')
  const next = nextIndex >= 0 ? todos[nextIndex] : undefined
  const completed = todos.filter(item => item.status === 'completed').length
  return {
    current: nextIndex >= 0 ? nextIndex + 1 : completed,
    total,
    title: next?.content ?? '',
    allCompleted: false,
  }
}

/** A settled turn with leftover work reads as interrupted in the one-line summary. */
export function taskTurnInterrupted(todos: readonly TodoItem[], settled: boolean): boolean {
  if (todos.length === 0 || todos.every(item => item.status === 'completed')) return false
  return settled || todos.some(item => item.status === 'interrupted')
}

export function snapshotFromTodos(
  key: string | null,
  todos: readonly TodoItem[],
  generationEnded: boolean,
): TaskListSnapshot {
  const ids = todos.map((item, index) => item.id || `task-${index}`)
  const incompleteIds = todos.flatMap((item, index) => (
    item.status === 'completed' ? [] : [item.id || `task-${index}`]
  ))
  const total = todos.length
  const completed = total - incompleteIds.length
  const allCompleted = total > 0 && incompleteIds.length === 0
  const hasIncomplete = incompleteIds.length > 0
  const markedInterrupted = todos.some(item => item.status === 'interrupted')
  return {
    key,
    ids,
    incompleteIds,
    total,
    completed,
    allCompleted,
    hasIncomplete,
    generationEnded,
    interrupted: hasIncomplete && (markedInterrupted || generationEnded),
  }
}

export function taskListSignature(snapshot: TaskListSnapshot): string {
  return [
    snapshot.key ?? '',
    snapshot.generationEnded ? '1' : '0',
    snapshot.interrupted ? '1' : '0',
    snapshot.allCompleted ? '1' : '0',
    snapshot.ids.join('\n'),
    snapshot.incompleteIds.join('\n'),
  ].join('\u0000')
}

export function latestTodoList<T extends { type: string; todos?: TodoItem[] }>(
  turns: readonly T[],
): { index: number; todos: TodoItem[] } | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]
    if (turn?.type !== 'assistant' || !turn.todos) continue
    // An explicit empty list is the latest update. Don't flash an older plan.
    return { index, todos: turn.todos }
  }
  return null
}

/**
 * The capsule owns the latest list, including after it completes or stops.
 * That turn stays out of the transcript until a later user message closes the
 * round, or a newer list replaces it. Switching sessions does not close it.
 * Only then does the older turn keep the one-line summary, so the same round
 * is never in both places at once.
 */
export function todoRailForTurn(input: {
  enabled: boolean
  isLatest: boolean
  /** The capsule is still on screen, including while it fades out. */
  docked: boolean
  hasTodos: boolean
  /** A later user message closed this round. */
  superseded?: boolean
}): TodoRailMode {
  if (!input.enabled || !input.hasTodos) return 'full'
  if (input.isLatest && (input.docked || !input.superseded)) return 'hidden'
  return 'summary'
}

function conceal(snapshot: TaskListSnapshot, dismissed = false): TaskCardMemory {
  return { expanded: false, phase: 'hidden', listKey: snapshot.key, dismissed }
}

/**
 * Cold open: the latest list is still this session's checklist until a later
 * user message. A finished or stopped round comes back collapsed. A following
 * user message means that round was already dismissed.
 */
function restoreSnapshot(snapshot: TaskListSnapshot, userTurnAfterList: boolean): TaskCardMemory {
  if (!snapshot.key || snapshot.total === 0 || userTurnAfterList) {
    return conceal(snapshot, userTurnAfterList && !!snapshot.key)
  }
  if (snapshot.allCompleted) {
    return { expanded: false, phase: 'complete', listKey: snapshot.key, dismissed: false }
  }
  if (snapshot.generationEnded && snapshot.hasIncomplete) {
    return { expanded: false, phase: 'interrupted', listKey: snapshot.key, dismissed: false }
  }
  return { expanded: false, phase: 'active', listKey: snapshot.key, dismissed: false }
}

function applyLive(
  state: TaskCardMemory,
  snapshot: TaskListSnapshot,
  userTurnAfterList: boolean,
): TaskCardMemory {
  // No list in view yet (session still loading). Don't treat that as a clear.
  if (!snapshot.key) {
    if (state.phase === 'hidden' && state.listKey === null) return state
    if (state.phase !== 'hidden') return state
    return conceal(snapshot, false)
  }
  if (snapshot.total === 0 || userTurnAfterList) {
    const dismissed = userTurnAfterList
      ? !!snapshot.key
      : state.dismissed && state.listKey === snapshot.key
    return conceal(snapshot, dismissed)
  }
  if (state.dismissed && state.listKey === snapshot.key) return conceal(snapshot, true)

  const showingThisList = state.phase !== 'hidden' && state.listKey === snapshot.key
  if (snapshot.allCompleted) {
    if (showingThisList) return { ...state, phase: 'complete', listKey: snapshot.key, dismissed: false }
    return conceal(snapshot)
  }

  if (snapshot.generationEnded && snapshot.hasIncomplete) {
    if (showingThisList) return { ...state, phase: 'interrupted', listKey: snapshot.key, dismissed: false }
    return conceal(snapshot)
  }

  const fresh = state.listKey !== snapshot.key || state.phase === 'hidden'
  return {
    expanded: fresh ? false : state.expanded,
    phase: 'active',
    listKey: snapshot.key,
    dismissed: false,
  }
}

export function reduceTaskCardMemory(state: TaskCardMemory, event: TaskCardEvent): TaskCardMemory {
  switch (event.type) {
    case 'hydrate':
    case 'session':
      return restoreSnapshot(event.snapshot, event.userTurnAfterList)
    case 'list':
      return applyLive(state, event.snapshot, event.userTurnAfterList)
    case 'user-message':
      if (state.phase === 'hidden' && (state.dismissed || !event.snapshot.key)) return state
      return conceal(event.snapshot, true)
    case 'toggle':
      if (state.phase === 'hidden') return state
      return { ...state, expanded: !state.expanded }
    case 'expand':
      if (state.phase === 'hidden' || state.expanded === event.expanded) return state
      return { ...state, expanded: event.expanded }
    case 'collapse':
      if (!state.expanded) return state
      return { ...state, expanded: false }
    default:
      return state
  }
}

function writeSession(state: SessionTaskCards, sessionId: string, memory: TaskCardMemory): SessionTaskCards {
  if (state.bySession[sessionId] === memory) return state
  return { bySession: { ...state.bySession, [sessionId]: memory } }
}

export function sessionTaskCardMemory(state: SessionTaskCards, sessionId: string | null): TaskCardMemory {
  if (!sessionId) return EMPTY_TASK_CARD_MEMORY
  return state.bySession[sessionId] ?? EMPTY_TASK_CARD_MEMORY
}

/**
 * Remember each session's capsule. The first time a session is seen — including
 * after a restart, when nothing is stored yet — the phase comes from its latest
 * list. Later updates keep that memory, so a switch away and back is not a dismiss.
 */
export function reduceSessionTaskCards(state: SessionTaskCards, event: SessionTaskCardEvent): SessionTaskCards {
  const stored = state.bySession[event.sessionId]
  const current = stored ?? EMPTY_TASK_CARD_MEMORY
  switch (event.type) {
    case 'show': {
      const cold = !stored || (stored.phase === 'hidden' && !stored.dismissed)
      const next = cold
        ? restoreSnapshot(event.snapshot, event.userTurnAfterList)
        : applyLive(current, event.snapshot, event.userTurnAfterList)
      return writeSession(state, event.sessionId, next)
    }
    case 'user-message':
      return writeSession(state, event.sessionId, reduceTaskCardMemory(current, {
        type: 'user-message',
        snapshot: event.snapshot,
      }))
    case 'toggle':
      return writeSession(state, event.sessionId, reduceTaskCardMemory(current, { type: 'toggle' }))
    case 'expand':
      return writeSession(state, event.sessionId, reduceTaskCardMemory(current, {
        type: 'expand',
        expanded: event.expanded,
      }))
    case 'collapse':
      return writeSession(state, event.sessionId, reduceTaskCardMemory(current, { type: 'collapse' }))
    default:
      return state
  }
}

export function isTaskCardVisible(state: TaskCardMemory): boolean {
  return state.phase !== 'hidden'
}

/** True while the floating card is on screen. `listKey` is unused and kept for older call sites. */
export function isTaskCardDocked(state: TaskCardMemory, _listKey?: string | null): boolean {
  return isTaskCardVisible(state)
}

