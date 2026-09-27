import type { AnnotationFeedbackStatus, AnnotationV1 } from '@craft-agent/core'

export type AnnotationFollowUpState = 'none' | 'pending' | 'sent'

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normalizeFollowUpText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function getAnnotationNoteText(annotation: AnnotationV1): string {
  const noteBody = annotation.body.find((body): body is Extract<AnnotationV1['body'][number], { type: 'note' }> => body.type === 'note')
  const bodyText = noteBody?.text?.trim() ?? ''
  if (bodyText.length > 0) return bodyText

  const followUpMeta = asRecord(asRecord(annotation.meta)?.followUp)
  const metaText = typeof followUpMeta?.text === 'string' ? followUpMeta.text.trim() : ''
  return metaText
}

export function getAnnotationFollowUpState(annotation: AnnotationV1): AnnotationFollowUpState {
  const noteText = getAnnotationNoteText(annotation)
  if (!noteText) return 'none'

  const followUpMeta = asRecord(asRecord(annotation.meta)?.followUp)
  if (!followUpMeta) return 'pending'

  const sentAt = typeof followUpMeta.lastSentAt === 'number'
    ? followUpMeta.lastSentAt
    : (typeof followUpMeta.sentAt === 'number' ? followUpMeta.sentAt : null)

  const sentTextRaw = typeof followUpMeta.lastSentText === 'string'
    ? followUpMeta.lastSentText
    : (typeof followUpMeta.sentText === 'string' ? followUpMeta.sentText : '')

  const sentText = sentTextRaw.trim()
  return sentAt != null && sentText.length > 0 && sentText === noteText.trim()
    ? 'sent'
    : 'pending'
}

export function isAnnotationFollowUpSent(annotation: AnnotationV1): boolean {
  return getAnnotationFollowUpState(annotation) === 'sent'
}

export function formatAnnotationFollowUpTooltipText(annotation: AnnotationV1, maxLength = 180): string {
  const note = normalizeFollowUpText(getAnnotationNoteText(annotation))
  if (!note) return ''

  return note.length > maxLength
    ? `${note.slice(0, maxLength - 1).trimEnd()}…`
    : note
}

/** Display only lifecycle facts supplied by the runtime; legacy annotations have no status. */
export function getAnnotationFeedbackStatus(annotation: AnnotationV1 | null | undefined): AnnotationFeedbackStatus | undefined {
  const followUp = asRecord(annotation?.meta?.followUp)
  if (typeof followUp?.requestMessageId !== 'string' || !followUp.requestMessageId) return undefined
  switch (followUp.status) {
    case 'queued': case 'running': case 'waiting-user': case 'delivered': case 'failed': case 'interrupted':
      return followUp.status
    default: return undefined
  }
}
