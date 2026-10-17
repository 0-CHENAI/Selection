import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RailToc, type RailTocItem, type RailTocStatus } from '../ui/rail-toc'
import type { TodoItem } from './TurnCard'

interface TodoListProps {
  todos: TodoItem[]
}

const STATUSES = ['in_progress', 'pending', 'completed', 'interrupted'] as const

/** Same outline rhythm as a heading TOC: siblings share a column, then the rail steps back. */
const OUTLINE_DEPTH = [0, 1, 1, 0, 1, 2, 1] as const

/**
 * Real depth wins when any item carries one.
 * A flat list has no parent field, so it borrows this outline. Status is not used:
 * an all-completed list would otherwise sit on one column and lose the bend.
 */
export function taskRailDepth(todos: readonly { depth?: number }[], index: number): number {
  if (todos.some(todo => typeof todo.depth === 'number')) {
    const depth = todos[index]?.depth
    return typeof depth === 'number' && depth > 0 ? Math.floor(depth) : 0
  }
  return OUTLINE_DEPTH[index % OUTLINE_DEPTH.length] ?? 0
}

function summaryLabel(
  items: readonly TodoItem[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (items.length > 0 && items.every(item => item.status === 'completed')) return t('taskList.allCompleted')
  return STATUSES
    .filter(status => items.some(item => item.status === status))
    .map(status => t(`taskList.count.${status}`, { count: items.filter(item => item.status === status).length }))
    .join(' · ')
}

/** Conversation task progress. Legacy todo snapshots share this renderer. */
export function TodoList({ todos }: TodoListProps) {
  const { t } = useTranslation()
  const items = useMemo<RailTocItem[]>(() => todos.map((todo, index) => ({
    id: todo.id || `task-${index}`,
    label: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
    status: todo.status as RailTocStatus,
    statusLabel: t(`taskList.status.${todo.status}`),
    depth: taskRailDepth(todos, index),
  })), [t, todos])

  if (todos.length === 0) return null

  return (
    <RailToc
      items={items}
      title={t('taskList.title')}
      liveSummary={summaryLabel(todos, t)}
      className="mt-3 w-full max-w-full select-text"
      data-task-rail=""
      data-readonly="true"
    />
  )
}
