import type { Turn } from '@craft-agent/ui'
import { isCancelledTurnMarker } from '@craft-agent/shared/sessions/cancelled-turn'

export interface WorkTiming {
  startTime: number
  endTime: number
  interrupted: boolean
  /** Backend execution clock, independent of the original user message time. */
  recorded?: boolean
}

/** One status above the last assistant card of each user request. */
export function getWorkTimings(
  turns: Turn[],
  completedRun?: { startedAt: number; completedAt: number },
  currentRun?: { startedAt: number },
): Map<number, WorkTiming> {
  const timings = new Map<number, WorkTiming>()
  let startTime: number | undefined
  let statusIndex = -1
  let endTime = 0
  let interrupted = false
  const save = (nextRequestAt = Infinity) => {
    if (statusIndex >= 0 && startTime !== undefined) {
      const recorded = completedRun
        && completedRun.startedAt >= startTime
        && completedRun.startedAt < nextRequestAt
        // A new attempt on the same prompt must not inherit the old usage.
        // Compare execution clocks, not renderer receipt/reveal timestamps.
        && !(currentRun && currentRun.startedAt >= startTime
          && currentRun.startedAt < nextRequestAt
          && currentRun.startedAt > completedRun.startedAt)
      timings.set(statusIndex, recorded
        ? { startTime: completedRun.startedAt, endTime: completedRun.completedAt, interrupted, recorded: true }
        : { startTime, endTime, interrupted })
    }
  }
  turns.forEach((turn, index) => {
    if (turn.type === 'user') {
      save(turn.timestamp)
      startTime = turn.timestamp
      statusIndex = -1
      endTime = turn.timestamp
      interrupted = false
    } else if (turn.type === 'assistant') {
      startTime ??= turn.timestamp
      statusIndex = index
      // A later assistant turn can recover from an earlier error.
      interrupted = false
      endTime = Math.max(endTime, turn.timestamp, turn.response?.timestamp ?? 0,
        turn.response?.completedRevealStartTime ?? 0)
      for (const activity of turn.activities) endTime = Math.max(endTime, activity.timestamp)
    } else if (turn.type === 'system' && (turn.message.role === 'error' || isCancelledTurnMarker(turn.message))) {
      interrupted = true
      endTime = Math.max(endTime, turn.timestamp)
      // A stop before the first token still retains its elapsed work status.
      if (statusIndex < 0 && startTime !== undefined) statusIndex = index
    }
  })
  save()
  return timings
}

/** The status row belongs to the user message that opened its request. */
export function workStatusOwnsUser(turns: readonly Turn[], statusIndex: number, userId: string): boolean {
  for (let index = statusIndex; index >= 0; index--) {
    const turn = turns[index]
    if (turn?.type === 'user') return turn.message.id === userId
  }
  return false
}
