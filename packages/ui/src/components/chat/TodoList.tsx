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
  /**
   * Identity of this list. The floating card and the history summary must
   * pass the same value so the rail does not change shape between them.
   */
  listSeed?: string
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

// FNV's low bits stay sequential for ids "1".."6". Mix them so the bend
// position and direction actually change with the list seed.
function mixHash(hash: number): number {
  let value = hash >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

function railHash(seed: string): number {
  return mixHash(railSeedHash(seed))
}

/** One level toward the side the hash picks. At 0 or 2 there is only one way. */
function nudgeDepth(depth: number, hash: number): number {
  const outward = (hash & 4) !== 0
  if (outward && depth < RAIL_DEPTH_MAX) return depth + 1
  if (!outward && depth > 0) return depth - 1
  return depth < RAIL_DEPTH_MAX ? depth + 1 : depth - 1
}

function taskKey(todo: { id?: string; content: string } | undefined, index: number): string {
  return todo?.id?.trim() || todo?.content || String(index)
}

/**
 * Visual depth for a flat task list. The first step stays at 0.
 * Each later step bends with probability about 1/4. The hash mixes the
 * list seed with the task id, so ids "1".."6" do not draw the same rail
 * every time. A bend moves one level, consecutive bends and reversals are
 * allowed, and depth stays inside 0..2.
 *
 * A list of three or more always bends at least once. The fallback slot is
 * chosen from the list seed alone (the 2nd or 3rd step), so appending a
 * task never moves an earlier node.
 */
export function taskRailDepths(
  todos: readonly { id?: string; content: string }[],
  listSeed = '',
): number[] {
  const depths: number[] = []
  let depth = 0
  let bent = false
  const fallbackIndex = (railHash(`${listSeed}\0bend`) % 2) + 1
  for (let index = 0; index < todos.length; index++) {
    if (index > 0) {
      const hash = railHash(`${listSeed}\0${taskKey(todos[index], index)}`)
      const natural = hash % 4 === 0
      const guarantee = !bent && index === fallbackIndex
      if (natural || guarantee) {
        depth = nudgeDepth(depth, hash)
        bent = true
      }
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
export function TodoList({ todos, className, showTitle = true, listSeed = '' }: TodoListProps) {
  const { t } = useTranslation()
  const depths = useMemo(() => taskRailDepths(todos, listSeed), [listSeed, todos])
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
