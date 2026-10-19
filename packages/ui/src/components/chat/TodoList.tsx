import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { RailToc, type RailTocItem, type RailTocStatus } from '../ui/rail-toc'
import type { TodoItem } from './TurnCard'

interface TodoListProps {
  todos: TodoItem[]
  className?: string
  /** The floating panel has its own progress heading, so it drops this one. */
  showTitle?: boolean
}

const STATUSES = ['in_progress', 'pending', 'completed', 'interrupted'] as const

const RAIL_DEPTH_MAX = 2

function railSeedHash(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** One level toward the side the hash picks. At 0 or 2 there is only one way. */
function nudgeDepth(depth: number, hash: number): number {
  const outward = (hash & 4) !== 0
  if (outward && depth < RAIL_DEPTH_MAX) return depth + 1
  if (!outward && depth > 0) return depth - 1
  return depth < RAIL_DEPTH_MAX ? depth + 1 : depth - 1
}

/**
 * Visual depth for a flat task list. The first step stays at 0.
 * Each later step bends with probability 1/4, from a hash of its id
 * (or its content when it has no id). A bend moves one level, and
 * two bends in a row are allowed. Appending a task does not move earlier nodes.
 */
export function taskRailDepths(todos: readonly { id?: string; content: string }[]): number[] {
  const depths: number[] = []
  let depth = 0
  for (let index = 0; index < todos.length; index++) {
    if (index > 0) {
      const todo = todos[index]
      const seed = todo?.id?.trim() || todo?.content || String(index)
      const hash = railSeedHash(seed)
      if (hash % 4 === 0) depth = nudgeDepth(depth, hash)
    }
    depths.push(depth)
  }
  return depths
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
export function TodoList({ todos, className, showTitle = true }: TodoListProps) {
  const { t } = useTranslation()
  const depths = useMemo(() => taskRailDepths(todos), [todos])
  const items = useMemo<RailTocItem[]>(() => todos.map((todo, index) => ({
    id: todo.id || `task-${index}`,
    label: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
    status: todo.status as RailTocStatus,
    statusLabel: t(`taskList.status.${todo.status}`),
    depth: depths[index] ?? 0,
  })), [depths, t, todos])

  if (todos.length === 0) return null

  return (
    <RailToc
      items={items}
      title={t('taskList.title')}
      showTitle={showTitle}
      liveSummary={summaryLabel(todos, t)}
      className={cn('mt-3 w-full max-w-full select-text', className)}
      data-task-rail=""
      data-readonly="true"
    />
  )
}
