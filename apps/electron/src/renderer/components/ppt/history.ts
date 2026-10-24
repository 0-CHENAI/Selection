export interface PptHistoryStamp {
  lastMessageAt?: number
  createdAt?: number
}

export function pptHistoryStamp(item: PptHistoryStamp): number {
  return item.lastMessageAt ?? item.createdAt ?? 0
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
