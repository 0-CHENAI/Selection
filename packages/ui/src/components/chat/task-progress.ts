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

export const EMPTY_TASK_CARD_MEMORY: TaskCardMemory = {
  expanded: false,
  phase: 'hidden',
  listKey: null,
}

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
 * round, or a newer list replaces it. Only then does the older turn keep the
 * one-line summary, so the same round is never in both places at once.
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

function hidden(snapshot: TaskListSnapshot): TaskCardMemory {
  return { expanded: false, phase: 'hidden', listKey: snapshot.key }
}

/** A finished session does not bring the capsule back. Only live, open work does. */
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

