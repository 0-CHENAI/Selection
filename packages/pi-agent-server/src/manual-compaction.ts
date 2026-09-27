import { reserveCompaction } from './compaction-reservation';
import { waitForCompaction } from './wait-for-compaction';

type CompactableSession<T> = { isCompacting: boolean; compact(instructions?: string): Promise<T> };


/** Reserve synchronously: the SDK sets isCompacting only AFTER awaiting abort(). */
export async function runManualCompaction<T>(
  session: CompactableSession<T>,
  instructions?: string,
  beforeCompact?: () => void,
  signal?: AbortSignal,
): Promise<T> {
  const release = reserveCompaction(session);
  try {
    await waitForCompaction(session, 300_000, 200, true, signal);
    beforeCompact?.();
    signal?.throwIfAborted();
    return await session.compact(instructions);
  } finally {
    release();
  }
}
