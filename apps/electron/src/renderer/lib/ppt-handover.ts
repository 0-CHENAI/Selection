import type { SessionCommand } from '@craft-agent/shared/protocol'
import type { Session } from '../../shared/types'

/** PPT uses this conversation's next-turn PRO strategy; it does not create a new session. */
export async function ensurePptProSession(
  session: Session,
  command: (sessionId: string, command: SessionCommand) => Promise<unknown>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  if (session.workMode === 'PRO') return session.id
  await command(session.id, { type: 'setWorkMode', mode: 'PRO' })
  signal.throwIfAborted()
  return session.id
}
