import type { HandoverResult, SessionCommand } from '@craft-agent/shared/protocol'
import type { Session } from '../../shared/types'

/** A busy source stays untouched; keep the draft rather than send later from an abandoned composer. */
export async function ensurePptProSession(
  session: Session,
  handoverId: string,
  command: (sessionId: string, command: SessionCommand) => Promise<unknown>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  if (session.workMode === 'PRO') return session.id
  const result = await command(session.id, { type: 'handover', operation: { type: 'create', handoverId, targetMode: 'PRO' } }) as HandoverResult
  const record = result.records.find(item => item.handoverId === handoverId)
  if (record?.status === 'waiting') {
    await command(session.id, { type: 'handover', operation: { type: 'cancel', handoverId } })
    signal.throwIfAborted()
    throw new Error(record.error || '请等待当前会话任务完成后再生成 PPT，输入和附件已保留。')
  }
  signal.throwIfAborted()
  if (record?.status !== 'applied' || !record.targetSessionId) throw new Error(record?.error || 'PPT 会话交接未完成，输入和附件已保留。')
  return record.targetSessionId
}
