import { artifactPathKey } from '@craft-agent/ui/chat'

export interface PptShelfMessage {
  id?: string
  role?: string
  turnId?: string
  answerRunId?: string
  isIntermediate?: boolean
  isQueued?: boolean
  artifactVersions?: readonly { path: string }[]
}

/** Identities a turn card already uses for this message, including both reveal forms. */
export function messageShelfAnchors(sessionId: string, message: PptShelfMessage): string[] {
  const id = message.id
  if (!id) return []
  const turnId = message.answerRunId ? `answer-${message.answerRunId}` : message.turnId || id
  const streamKey = message.turnId || id
  return [id, turnId, `${sessionId}:${turnId}`, `${sessionId}:${turnId}:${streamKey}`, `${sessionId}:${turnId}:response`]
}

/** Host used only before any assistant message exists, so the row can sit above the composer. */
export function pptSessionAnchor(sessionId: string): string {
  return `ppt-session:${sessionId}`
}

/**
 * A listed pptx stays on the message that delivered it, so a later restyle updates that row.
 * Otherwise the live assistant message hosts the row until the file is recorded.
 */
export function pptShelfTarget(
  sessionId: string,
  messages: readonly PptShelfMessage[] | undefined,
  pptxPath: string | undefined,
): { anchors: string[]; listed: boolean } {
  const list = messages ?? []
  if (pptxPath) {
    const key = artifactPathKey(pptxPath)
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index]
      if (!message?.artifactVersions?.some(item => artifactPathKey(item.path) === key)) continue
      const anchors = messageShelfAnchors(sessionId, message)
      if (anchors.length) return { anchors, listed: true }
    }
  }
  for (let index = list.length - 1; index >= 0; index--) {
    const message = list[index]
    if (!message || message.role !== 'assistant' || !message.id || message.isQueued) continue
    const anchors = messageShelfAnchors(sessionId, message)
    if (anchors.length) return { anchors, listed: false }
  }
  return { anchors: [], listed: false }
}
