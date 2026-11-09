import {
  checkAttachmentSizes,
  DEFAULT_MAX_MESSAGE_BYTES,
  formatAttachmentBytes,
  type AttachmentSizeInput,
  type AttachmentSizeProblem,
} from '@craft-agent/shared/protocol'
type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string

export function currentMaxMessageBytes(): number {
  const advertised = window.electronAPI?.getMaxMessageBytes?.()
  return typeof advertised === 'number' && advertised > 0 ? advertised : DEFAULT_MAX_MESSAGE_BYTES
}

export function attachmentSizeInput(file: { name: string; size: number; type?: string; mimeType?: string }): AttachmentSizeInput {
  const mime = file.mimeType || (file.type?.includes('/') ? file.type : '')
  const isImage = file.type === 'image' || mime.startsWith('image/')
  return { name: file.name, size: file.size, ...(isImage ? { type: 'image' } : {}) }
}

export function findAttachmentSizeProblem(
  files: readonly { name: string; size: number; type?: string; mimeType?: string }[],
): AttachmentSizeProblem | null {
  return checkAttachmentSizes(files.map(attachmentSizeInput), currentMaxMessageBytes())
}

export function formatAttachmentSizeProblem(problem: AttachmentSizeProblem, t: Translate): string {
  if (problem.kind === 'file') {
    return t('chat.attachmentFileTooLarge', '{{name}} is {{size}}, over the {{limit}} limit for one message. Send a smaller file.', {
      name: problem.name,
      size: formatAttachmentBytes(problem.size),
      limit: formatAttachmentBytes(problem.limit),
    })
  }
  return t('chat.attachmentsTotalTooLarge', 'These attachments total {{size}}, over the {{limit}} limit for one message. Send them in smaller batches.', {
    size: formatAttachmentBytes(problem.size),
    limit: formatAttachmentBytes(problem.limit),
  })
}
