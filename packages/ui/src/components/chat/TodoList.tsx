import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RailToc, type RailTocItem, type RailTocStatus } from '../ui/rail-toc'
import type { TodoItem } from './TurnCard'

interface TodoListProps {
  todos: TodoItem[]
}

const STATUSES = ['in_progress', 'pending', 'completed', 'interrupted'] as const

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
