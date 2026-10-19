import type { TodoItem } from './TurnCard'

export type TodoRailMode = 'full' | 'summary' | 'hidden'

export type TaskCardPhase = 'hidden' | 'active' | 'complete' | 'interrupted'

/** Expanded is in-memory only. Closing the capsule is not a user action. */
export interface TaskCardMemory {
  expanded: boolean
  phase: TaskCardPhase
  listKey: string | null
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
  | { type: 'fade'; force?: boolean }

export const EMPTY_TASK_CARD_MEMORY: TaskCardMemory = {
  expanded: false,
  phase: 'hidden',
  listKey: null,
}

/** Completed or interrupted capsule stays this long, then fades. */
export const TASK_CARD_HOLD_MS = 2500

/** Hover or an open panel can postpone the fade only until this deadline. */
export const TASK_CARD_HOLD_MAX_MS = 6000

/** Exit motion toward the inline summary of the turn. */
export const TASK_CARD_EXIT_MS = 200

/** Room the transcript keeps so the last line sits above the capsule. */
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

/** Latest floating list is omitted from the turn. Older lists keep a one-line summary. */
export function todoRailForTurn(input: {
  enabled: boolean
  isLatest: boolean
  docked: boolean
  hasTodos: boolean
}): TodoRailMode {
  if (!input.enabled || !input.hasTodos) return 'full'
  if (input.isLatest && input.docked) return 'hidden'
  return 'summary'
}

function hidden(snapshot: TaskListSnapshot): TaskCardMemory {
  return { expanded: false, phase: 'hidden', listKey: snapshot.key }
}

/** Only a running session with open work shows a capsule. Finished sessions stay inline. */
function restoreSnapshot(snapshot: TaskListSnapshot, userTurnAfterList: boolean): TaskCardMemory {
  if (!snapshot.key || !snapshot.hasIncomplete || userTurnAfterList || snapshot.generationEnded) {
    return hidden(snapshot)
  }
  return { expanded: false, phase: 'active', listKey: snapshot.key }
}

function applyLive(
  state: TaskCardMemory,
  snapshot: TaskListSnapshot,
  userTurnAfterList: boolean,
): TaskCardMemory {
  if (!snapshot.key || snapshot.total === 0 || userTurnAfterList) return hidden(snapshot)

  const showingThisList = state.phase !== 'hidden' && state.listKey === snapshot.key
  if (snapshot.allCompleted) {
    if (showingThisList) return { ...state, phase: 'complete', listKey: snapshot.key }
    return hidden(snapshot)
  }

  if (snapshot.generationEnded && snapshot.hasIncomplete) {
    if (showingThisList) return { ...state, phase: 'interrupted', listKey: snapshot.key }
    return hidden(snapshot)
  }

  const fresh = state.listKey !== snapshot.key || state.phase === 'hidden'
  return {
    expanded: fresh ? false : state.expanded,
    phase: 'active',
    listKey: snapshot.key,
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
      if (state.phase === 'hidden') return state
      return hidden(event.snapshot)
    case 'toggle':
      if (state.phase === 'hidden') return state
      return { ...state, expanded: !state.expanded }
    case 'expand':
      if (state.phase === 'hidden' || state.expanded === event.expanded) return state
      return { ...state, expanded: event.expanded }
    case 'collapse':
      if (!state.expanded) return state
      return { ...state, expanded: false }
    case 'fade': {
      if (state.phase !== 'complete' && state.phase !== 'interrupted') return state
      if (state.expanded && !event.force) return state
      return { ...state, phase: 'hidden', expanded: false }
    }
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

/**
 * Terminal capsules fade after the hold. An open panel or hover waits,
 * but never past the hard deadline, which also collapses the panel.
 */
export function shouldFadeTaskCard(
  state: TaskCardMemory,
  hovering: boolean,
  elapsedMs = TASK_CARD_HOLD_MS,
): { fade: boolean; force: boolean } {
  const terminal = state.phase === 'complete' || state.phase === 'interrupted'
  if (!terminal) return { fade: false, force: false }
  if (elapsedMs >= TASK_CARD_HOLD_MAX_MS) return { fade: true, force: true }
  if (elapsedMs >= TASK_CARD_HOLD_MS && !state.expanded && !hovering) {
    return { fade: true, force: false }
  }
  return { fade: false, force: false }
}
