import type { Session, Message, CreateSessionOptions } from '../../../shared/types'
import type { SessionDraft } from '@craft-agent/shared/config'

export function contextRecoverySource(messages: Message[], errorId: string): Message | undefined {
  const index = messages.findIndex(message => message.id === errorId && message.role === 'error' && message.errorCode === 'context_limit')
  if (index < 0 || messages.slice(index + 1).some(message => message.answerCommitted
    || (message.role === 'error' && message.errorCode === 'context_limit')
    || (message.role === 'user' && !message.hidden && !message.isQueued))) return undefined
  return messages.slice(0, index).findLast(message => message.role === 'user' && !message.hidden && !message.isQueued)
}

/** Keep the original task and composer intact; never send the copied input. */
export async function prepareContextRecoveryDraft(session: Session, source: Message, services: {
  statPath: (path: string) => Promise<{ type: string } | null>
  createSession: (workspaceId: string, options: CreateSessionOptions) => Promise<Session>
  saveDraft: (sessionId: string, draft: SessionDraft) => Promise<void>
}): Promise<Session> {
  const attachments = source.attachments?.map(attachment => ({ path: attachment.storedPath, name: attachment.name }))
  for (const attachment of attachments ?? []) {
    const stat = await services.statPath(attachment.path)
    if (stat?.type !== 'file') throw new Error(`Attachment is unavailable: ${attachment.name}`)
  }
  const child = await services.createSession(session.workspaceId, {
    llmConnection: session.llmConnection, model: session.model, permissionMode: session.permissionMode,
    workingDirectory: session.workingDirectory, enabledSourceSlugs: session.enabledSourceSlugs, projectId: session.projectId,
  })
  await services.saveDraft(child.id, { text: source.content, ...(attachments?.length ? { attachments } : {}) })
  return child
}
