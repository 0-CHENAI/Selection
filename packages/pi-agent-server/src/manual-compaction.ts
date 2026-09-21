import { waitForCompaction } from './wait-for-compaction';

type CompactableSession<T> = { isCompacting: boolean; compact(instructions?: string): Promise<T> };
const pendingSessions = new WeakSet<object>();

/** Reserve synchronously: the SDK sets isCompacting only AFTER awaiting abort(). */
export async function runManualCompaction<T>(session: CompactableSession<T>, instructions?: string): Promise<T> {
  if (pendingSessions.has(session)) throw new Error('A manual compaction request is already pending for this session.');
  pendingSessions.add(session);
  try {
    await waitForCompaction(session);
    return await session.compact(instructions);
  } finally {
    pendingSessions.delete(session);
  }
}
