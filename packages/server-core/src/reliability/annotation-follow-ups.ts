import { createHash } from 'node:crypto'
import type { AnnotationFeedbackStatus, AnnotationV1, Message } from '@craft-agent/core/types'
import type { SendMessageOptions } from '@craft-agent/shared/protocol'

/** A rendered-text range is only valid against the raw message version it was selected from. */
export function assertAnnotationSource(content: string, annotation: AnnotationV1): string {
  const hash = createHash('sha256').update(content).digest('hex')
  const expected = annotation.meta?.sourceContentHash
  if (expected !== undefined && expected !== hash) {
    throw new Error('Annotation source changed; select the text again')
  }
  return hash
}

/** Validate the entire batch before changing any annotation. */
export function prepareAnnotationFollowUps(messages: Message[], references: SendMessageOptions['annotationFollowUps'], captureSource?: (content: string, hash: string) => void) {
  if (references === undefined) return (_messageId: string, _accepted?: Message) => () => {}
  if (!Array.isArray(references)) throw new Error('Invalid annotation feedback references')
  const seen = new Set<string>()
  const targets = references.map(reference => {
    if (!reference || typeof reference.messageId !== 'string' || typeof reference.annotationId !== 'string'
      || typeof reference.text !== 'string' || !reference.text.trim() || !Number.isFinite(reference.updatedAt)) throw new Error('Invalid annotation feedback reference')
    const key = JSON.stringify([reference.messageId, reference.annotationId])
    if (seen.has(key)) throw new Error('Duplicate annotation feedback reference')
    seen.add(key)
    const message = messages.find(item => item.id === reference.messageId && ['assistant', 'plan'].includes(item.role))
    const annotation = message?.annotations?.find(item => item.id === reference.annotationId && !item.deletedAt)
    if (!message || !annotation || (annotation.updatedAt ?? annotation.createdAt) !== reference.updatedAt) throw new Error('Annotation feedback changed; review the selection again')
    return { reference, annotation, content: message.content, hash: assertAnnotationSource(message.content, annotation) }
  })
  return (messageId: string, accepted?: Message) => {
    const captured = new Set<string>()
    for (const target of targets) {
      if (!captured.has(target.hash)) { captureSource?.(target.content, target.hash); captured.add(target.hash) }
    }
    if (accepted) accepted.annotationFollowUps = targets.map(({ reference, annotation, hash }) => ({
      ...reference, sourceContentHash: hash,
      target: { source: { ...annotation.target.source }, selectors: annotation.target.selectors.map(selector => ({ ...selector })) },
    }))
    const changes: Array<{ annotation: NonNullable<Message['annotations']>[number]; previous: Record<string, unknown> | undefined; applied: Record<string, unknown> }> = []
    for (const { reference, annotation, hash } of targets) {
      const previousMeta = annotation.meta
      const previous = annotation.meta?.followUp
      annotation.meta = { ...annotation.meta, sourceContentHash: hash, followUp: {
        ...(previous && typeof previous === 'object' ? previous : {}),
        text: reference.text, lastSentText: reference.text, lastSentAt: Date.now(),
        requestMessageId: messageId, baseContentHash: hash, status: 'queued',
        resultMessageId: undefined, resultAnswerRunId: undefined, resultSalvaged: undefined,
        userResolved: undefined,
      } }
      changes.push({ annotation, previous: previousMeta, applied: annotation.meta })
    }
    return () => {
      for (const { annotation, previous, applied } of changes) {
        if (annotation.meta === applied) annotation.meta = previous
      }
    }
  }
}

/** Link revisions inside the answer transaction; return an identity-checked rollback. */
export function linkAnnotationFollowUpResults(messages: Message[], requestMessageId: string, answer: Message, captureVersion?: (content: string, hash: string) => void): () => void {
  const changes: Array<{ annotation: NonNullable<Message['annotations']>[number]; previous: Record<string, unknown> | undefined }> = []
  if (!answer.answerCommitted) return () => {}
  const request = messages.find(message => message.id === requestMessageId && message.role === 'user')
  const previousReferences = request?.annotationFollowUps
  const resultContentHash = createHash('sha256').update(answer.content).digest('hex')
  if (previousReferences?.length) captureVersion?.(answer.content, resultContentHash)
  const deliveredReferences = previousReferences?.map(reference => ({ ...reference,
    resultMessageId: answer.id, resultAnswerRunId: answer.answerRunId, resultContentHash, resultSalvaged: !!answer.answerSalvaged,
  }))
  if (request && deliveredReferences) request.annotationFollowUps = deliveredReferences
  for (const message of messages) {
    for (const annotation of message.annotations ?? []) {
      const followUp = annotation.meta?.followUp as Record<string, unknown> | undefined
      if (!followUp || followUp.requestMessageId !== requestMessageId || annotation.deletedAt) continue
      if (followUp.baseContentHash !== createHash('sha256').update(message.content).digest('hex')) continue
      changes.push({ annotation, previous: annotation.meta })
      annotation.meta = { ...annotation.meta, followUp: { ...followUp,
        resultMessageId: answer.id, resultAnswerRunId: answer.answerRunId,
        resultSalvaged: !!answer.answerSalvaged, status: 'delivered',
      } }
    }
  }
  return () => {
    if (request && request.annotationFollowUps === deliveredReferences) request.annotationFollowUps = previousReferences
    for (const { annotation, previous } of changes) {
      const followUp = annotation.meta?.followUp as Record<string, unknown> | undefined
      if (followUp?.resultMessageId === answer.id) annotation.meta = previous
    }
  }
}

/** Only update this request; newer edits and delivered answers retain their state. */
export function setAnnotationFeedbackStatus(messages: Message[], requestMessageId: string, status: Exclude<AnnotationFeedbackStatus, 'delivered' | 'queued'>): Message[] {
  const changed: Message[] = []
  for (const message of messages) {
    let updated = false
    for (const annotation of message.annotations ?? []) {
      const followUp = annotation.meta?.followUp as Record<string, unknown> | undefined
      if (!followUp || followUp.requestMessageId !== requestMessageId || annotation.deletedAt
        || followUp.resultMessageId || followUp.status === 'delivered' || followUp.status === status) continue
      annotation.meta = { ...annotation.meta, followUp: { ...followUp, status } }
      updated = true
    }
    if (updated) changed.push(message)
  }
  return changed
}
