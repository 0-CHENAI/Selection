import type { TodoItem } from './TurnCard'

export type TodoRailMode = 'full' | 'summary' | 'hidden'

export type TaskCardPhase = 'hidden' | 'active' | 'complete' | 'interrupted'

export interface TaskCardMemory {
  expanded: boolean
  /** Turn key the user closed with the capsule's ×. */
  dismissedKey: string | null
  /** Every item id present at dismiss time. A later id is a new list. */
  dismissedIds: string[]
  /** Incomplete ids at dismiss time. One of these becoming the only change stays closed. */
  dismissedIncompleteIds: string[]
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
  /** Stop, error, or the turn ended while work is still open. */
  interrupted: boolean
}

export type TaskCardEvent =
  | { type: 'hydrate' | 'session'; memory: TaskCardMemory | null; snapshot: TaskListSnapshot; userTurnAfterList: boolean }
  | { type: 'list'; snapshot: TaskListSnapshot; userTurnAfterList: boolean }
  | { type: 'user-message'; snapshot: TaskListSnapshot }
  | { type: 'toggle' }
  | { type: 'expand'; expanded: boolean }
  | { type: 'collapse' }
  | { type: 'dismiss'; snapshot: TaskListSnapshot }
  | { type: 'fade' }

export const EMPTY_TASK_CARD_MEMORY: TaskCardMemory = {
  expanded: false,
  dismissedKey: null,
  dismissedIds: [],
  dismissedIncompleteIds: [],
  phase: 'hidden',
  listKey: null,
}

/** Completed capsule stays this long, then fades. Hover and expand pause it. */
export const TASK_CARD_FADE_MS = 4000

/** Room the transcript keeps so the last line sits above the capsule. */
export const TASK_CARD_CAPSULE_CLEARANCE = 48

const STORAGE_PREFIX = 'craft-task-card:'
const PHASES = new Set<TaskCardPhase>(['hidden', 'active', 'complete', 'interrupted'])

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
    interrupted: hasIncomplete && (markedInterrupted || generationEnded),
  }
}

export function taskListSignature(snapshot: TaskListSnapshot): string {
  return [
    snapshot.key ?? '',
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
    if (turn?.type === 'assistant' && turn.todos && turn.todos.length > 0) {
      return { index, todos: turn.todos }
    }
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function dismissalBlocks(state: TaskCardMemory, snapshot: TaskListSnapshot): boolean {
  if (!snapshot.key || state.dismissedKey !== snapshot.key) return false
  if (state.dismissedIds.length === 0 && state.dismissedIncompleteIds.length === 0) return true
  const known = new Set(state.dismissedIds)
  const blocked = new Set(state.dismissedIncompleteIds)
  if (snapshot.ids.some(id => !known.has(id))) return false
  if (snapshot.incompleteIds.some(id => !blocked.has(id))) return false
  return true
}

function applySnapshot(
  state: TaskCardMemory,
  snapshot: TaskListSnapshot,
  userTurnAfterList: boolean,
  mode: 'live' | 'restore',
): TaskCardMemory {
  if (!snapshot.key || snapshot.total === 0) {
    return { ...state, phase: 'hidden', expanded: false, listKey: snapshot.key }
  }

  if (userTurnAfterList && snapshot.allCompleted) {
    return { ...state, phase: 'hidden', expanded: false, listKey: snapshot.key }
  }

  if (dismissalBlocks(state, snapshot)) {
    return { ...state, phase: 'hidden', expanded: false, listKey: snapshot.key }
  }

  if (snapshot.allCompleted) {
    const showingThisList = state.phase !== 'hidden' && state.listKey === snapshot.key
    if (mode === 'live' && showingThisList) {
      return {
        ...state,
        phase: 'complete',
        listKey: snapshot.key,
        dismissedKey: null,
        dismissedIds: [],
        dismissedIncompleteIds: [],
      }
    }
    return { ...state, phase: 'hidden', expanded: false, listKey: snapshot.key }
  }

  const fresh = mode === 'live' && state.listKey !== snapshot.key
  return {
    ...state,
    phase: snapshot.interrupted ? 'interrupted' : 'active',
    listKey: snapshot.key,
    expanded: fresh ? false : state.expanded,
    dismissedKey: null,
    dismissedIds: [],
    dismissedIncompleteIds: [],
  }
}

export function reduceTaskCardMemory(state: TaskCardMemory, event: TaskCardEvent): TaskCardMemory {
  switch (event.type) {
    case 'hydrate':
    case 'session': {
      const loaded = event.memory ?? EMPTY_TASK_CARD_MEMORY
      const base: TaskCardMemory = {
        ...loaded,
        phase: loaded.phase === 'complete' ? 'hidden' : loaded.phase,
      }
      return applySnapshot(base, event.snapshot, event.userTurnAfterList, 'restore')
    }
    case 'list':
      return applySnapshot(state, event.snapshot, event.userTurnAfterList, 'live')
    case 'user-message':
      if (event.snapshot.allCompleted || state.phase === 'complete') {
        return { ...state, phase: 'hidden', expanded: false, listKey: event.snapshot.key ?? state.listKey }
      }
      return state
    case 'toggle':
      if (state.phase === 'hidden') return state
      return { ...state, expanded: !state.expanded }
    case 'expand':
      if (state.phase === 'hidden' || state.expanded === event.expanded) return state
      return { ...state, expanded: event.expanded }
    case 'collapse':
      if (!state.expanded) return state
      return { ...state, expanded: false }
    case 'dismiss':
      if (!event.snapshot.key) return { ...state, phase: 'hidden', expanded: false }
      return {
        ...state,
        phase: 'hidden',
        expanded: false,
        listKey: event.snapshot.key,
        dismissedKey: event.snapshot.key,
        dismissedIds: event.snapshot.ids,
        dismissedIncompleteIds: event.snapshot.incompleteIds,
      }
    case 'fade':
      if (state.phase !== 'complete' || state.expanded) return state
      return { ...state, phase: 'hidden', expanded: false }
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

export function shouldFadeTaskCard(state: TaskCardMemory, hovering: boolean): boolean {
  return state.phase === 'complete' && !state.expanded && !hovering
}

export function taskCardStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

export function readTaskCardMemory(
  sessionId: string | null,
  storage: Pick<Storage, 'getItem'> | null,
): TaskCardMemory | null {
  if (!sessionId || !storage) return null
  try {
    const raw = storage.getItem(taskCardStorageKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TaskCardMemory> & { collapsed?: boolean }
    const expanded = typeof parsed.expanded === 'boolean'
      ? parsed.expanded
      : typeof parsed.collapsed === 'boolean'
        ? !parsed.collapsed
        : null
    if (expanded === null && parsed.phase == null && parsed.dismissedKey == null) return null
    const phase = PHASES.has(parsed.phase as TaskCardPhase) ? parsed.phase as TaskCardPhase : 'hidden'
    return {
      expanded: expanded ?? false,
      dismissedKey: typeof parsed.dismissedKey === 'string' ? parsed.dismissedKey : null,
      dismissedIds: stringList(parsed.dismissedIds),
      dismissedIncompleteIds: stringList(parsed.dismissedIncompleteIds),
      phase,
      listKey: typeof parsed.listKey === 'string' ? parsed.listKey : null,
    }
  } catch {
    return null
  }
}

export function writeTaskCardMemory(
  sessionId: string | null,
  memory: TaskCardMemory,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  if (!sessionId || !storage) return
  try {
    storage.setItem(taskCardStorageKey(sessionId), JSON.stringify(memory))
  } catch {
    // Private mode and full disks should not break the transcript.
  }
}
