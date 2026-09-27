import { hasCompactionReservation } from './compaction-reservation';
/** Serialize model requests with SDK compaction; expiry never grants permission to overlap. */
export async function waitForCompaction(
  session: { isCompacting: boolean },
  timeoutMs = 300_000,
  pollMs = 200,
  ownsReservation = false,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  signal?.throwIfAborted();
  while (session.isCompacting || (!ownsReservation && hasCompactionReservation(session))) {
    signal?.throwIfAborted();
    if (Date.now() - start >= timeoutMs) {
      throw new Error('Compaction is still running; refusing to start a concurrent model request.');
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, timeoutMs)));
  }
  signal?.throwIfAborted();
}
