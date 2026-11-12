/**
 * Even out bursty stream appends without delaying the end of the turn.
 *
 * IPC/token batches arrive in 30–120ms clumps (sometimes seconds). Painting
 * each clump whole makes the transcript grow by entire lines. Reveal at a
 * steady rate, but always catch the backlog within `STREAM_PACE_MAX_LAG_MS`
 * so the last token is not parked behind a typewriter.
 */

/** Catch any burst within ~4 frames at 60Hz. Flush immediately when the stream ends. */
export const STREAM_PACE_MAX_LAG_MS = 64
export const STREAM_PACE_MAX_DT_MS = 32

export function revealStreamingText(
  shown: string,
  incoming: string,
  dtMs: number,
  streaming: boolean,
  maxLagMs = STREAM_PACE_MAX_LAG_MS,
): string {
  if (!streaming || !incoming.startsWith(shown)) return incoming
  const backlog = incoming.length - shown.length
  if (backlog <= 0) return shown
  const dt = Math.min(STREAM_PACE_MAX_DT_MS, Math.max(0, dtMs))
  if (dt <= 0) return shown
  const chars = Math.max(1, Math.ceil(backlog * (dt / Math.max(1, maxLagMs))))
  return incoming.slice(0, shown.length + Math.min(backlog, chars))
}
