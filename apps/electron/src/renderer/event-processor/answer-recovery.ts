import type { Session } from '../../shared/types'

/** Only the latest visible user turn may request a durable answer refresh. */
export function missingCommittedAnswerRun(session: Session): string | undefined {
  const userIndex = session.messages.findLastIndex(m => m.role === 'user' && !m.hidden && !m.isQueued)
  const messages = session.messages.slice(Math.max(0, userIndex))
  const run = messages.findLast(m => m.answerRunId)?.answerRunId
  return run && messages.some(m => m.answerRunId === run && m.answerRoutingVersion === 1)
    && !messages.some(m => m.answerRunId === run && m.answerCommitted) ? run : undefined
}

/** Merge only the durable delivery, preserving concurrent client metadata and later turns. */
export function recoverCommittedAnswer(current: Session, loaded: Session, runId: string): Session {
  if (current.isProcessing || missingCommittedAnswerRun(current) !== runId) return current
  const answer = loaded.messages.find(m => m.answerRunId === runId && m.answerCommitted && m.answerRoutingVersion === 1)
  if (!answer) return current
  return { ...current, messages: [...current.messages.filter(m => !(m.answerPreview && m.answerRunId === runId)), answer] }
}
