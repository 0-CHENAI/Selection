import type { Session } from '../../shared/types'

export type SessionRefreshResult = 'refreshed' | 'preserved_stale_messages' | 'superseded' | 'failed'

/** A reload may race with completion or a new turn. Live events own newer state. */
export async function refreshSessionSnapshot(
  readCurrent: () => Session | null,
  load: () => Promise<Session | null>,
  apply: (session: Session) => void,
): Promise<SessionRefreshResult> {
  const before = readCurrent()
  const fresh = await load()
  if (readCurrent() !== before) return 'superseded'
  if (!fresh) return 'failed'
  const preserveMessages = !!before?.messages.length && !fresh.messages?.length
  apply(preserveMessages ? { ...fresh, messages: before!.messages } : fresh)
  return preserveMessages ? 'preserved_stale_messages' : 'refreshed'
}
