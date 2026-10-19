import type { TodoItem } from './TurnCard'

export type TodoRailMode = 'full' | 'summary' | 'hidden'

export interface TaskCardMemory {
  collapsed: boolean
  /** Turn key whose completed card the user closed. */
  dismissedKey: string | null
}

export type TaskCardEvent =
  | { type: 'hydrate' | 'session'; memory: TaskCardMemory | null; allCompleted: boolean }
  | { type: 'toggle' }
  | { type: 'complete' }
  | { type: 'dismiss'; key: string }
  | { type: 'resume'; key: string }

export const EMPTY_TASK_CARD_MEMORY: TaskCardMemory = {
  collapsed: false,
  dismissedKey: null,
}

const STORAGE_PREFIX = 'craft-task-card:'

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

/** Latest docked list is omitted from the turn. Older lists keep a one-line summary. */
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

export function reduceTaskCardMemory(state: TaskCardMemory, event: TaskCardEvent): TaskCardMemory {
  switch (event.type) {
    case 'hydrate':
    case 'session':
      return {
        collapsed: event.memory?.collapsed ?? event.allCompleted,
        dismissedKey: event.memory?.dismissedKey ?? null,
      }
    case 'toggle':
      return { ...state, collapsed: !state.collapsed }
    case 'complete':
      return { ...state, collapsed: true }
    case 'dismiss':
      return { ...state, collapsed: true, dismissedKey: event.key }
    case 'resume':
      return state.dismissedKey === event.key
        ? { ...state, dismissedKey: null }
        : state
    default:
      return state
  }
}

export function isTaskCardDocked(state: TaskCardMemory, listKey: string | null): boolean {
  return !!listKey && state.dismissedKey !== listKey
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
    const parsed = JSON.parse(raw) as Partial<TaskCardMemory>
    if (typeof parsed.collapsed !== 'boolean') return null
    return {
      collapsed: parsed.collapsed,
      dismissedKey: typeof parsed.dismissedKey === 'string' ? parsed.dismissedKey : null,
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
