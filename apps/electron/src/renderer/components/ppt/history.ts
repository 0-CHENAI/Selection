import type { PptProgress } from '@craft-agent/shared/protocol'

export interface PptHistoryStamp {
  lastMessageAt?: number
  createdAt?: number
}

export type PptHistoryKind =
  | { kind: 'progress'; current: number; total: number }
  | { kind: 'generating' }
  | { kind: 'pages'; count: number }
  | { kind: 'file' }

/** History rows never show 0/0. A turn with no deck yet is just “generating”. */
export function pptHistoryKind(input: { processing?: boolean; progress?: PptProgress; templatePages?: number }): PptHistoryKind {
  const generating = !!input.processing || !!input.progress?.generating
  const total = input.progress?.total ?? 0
  if (generating && total > 0) {
    const current = input.progress?.current ?? Math.min(total, (input.progress?.completed ?? 0) + 1)
    return { kind: 'progress', current, total }
  }
  if (generating) return { kind: 'generating' }
  if (total > 0) return { kind: 'pages', count: total }
  if (input.templatePages) return { kind: 'pages', count: input.templatePages }
  return { kind: 'file' }
}

export function pptHistoryStamp(item: PptHistoryStamp): number {
  return item.lastMessageAt ?? item.createdAt ?? 0
}

/**
 * Session that should open after the focused PPT history row is deleted.
 * Prefers the row that slides into the deleted slot, then the previous row.
 * An unknown id falls back to the first remaining row.
 */
export function nextPptHistoryId<T extends { id: string }>(items: readonly T[], deletedId: string): string | null {
  const remaining = items.filter(item => item.id !== deletedId)
  if (remaining.length === 0) return null
  const index = items.findIndex(item => item.id === deletedId)
  if (index < 0) return remaining[0]!.id
  return remaining[Math.min(index, remaining.length - 1)]!.id
}

/** Today / this week (Monday) / earlier, matching the signed-off PPT history. */
export function groupPptHistory<T extends PptHistoryStamp>(items: T[], now = Date.now()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const week = today - ((start.getDay() + 6) % 7) * 86_400_000
  const recent: T[] = []
  const thisWeek: T[] = []
  const earlier: T[] = []
  for (const item of items) {
    const stamp = pptHistoryStamp(item)
    if (stamp >= today) recent.push(item)
    else if (stamp >= week) thisWeek.push(item)
    else earlier.push(item)
  }
  return { recent, thisWeek, earlier }
}
