import { createHash } from 'node:crypto'

export type ImageInputFailureCode =
  | 'image_capability_mismatch'
  | 'image_bytes_unavailable'
  | 'image_resource_expired'
  | 'image_unsupported_format'

export interface ImageBlockDiagnostic {
  name: string
  source: 'attachment' | 'prompt' | 'tool'
  mimeType?: string
  byteLength?: number
  sha256?: string
  hasBytes: boolean
}

export function isImageLike(attachment: { type?: string; mimeType?: string }): boolean {
  return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true
}

export function digestImageBase64(base64: string): { sha256: string; byteLength: number } {
  const bytes = Buffer.from(base64, 'base64')
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

export function describeImageAttachment(attachment: {
  name: string
  mimeType?: string
  base64?: string
  size?: number
  source?: ImageBlockDiagnostic['source']
}): ImageBlockDiagnostic {
  const digest = attachment.base64 ? digestImageBase64(attachment.base64) : undefined
  return {
    name: attachment.name,
    source: attachment.source ?? 'attachment',
    mimeType: attachment.mimeType,
    byteLength: digest?.byteLength ?? attachment.size,
    sha256: digest?.sha256,
    hasBytes: Boolean(attachment.base64),
  }
}

export function describePromptImages(
  images: Array<{ mimeType?: string; data?: string }> | undefined,
): ImageBlockDiagnostic[] {
  return (images ?? []).map((image, index) => {
    const digest = image.data ? digestImageBase64(image.data) : undefined
    return {
      name: `prompt-image-${index + 1}`,
      source: 'prompt' as const,
      mimeType: image.mimeType,
      byteLength: digest?.byteLength,
      sha256: digest?.sha256,
      hasBytes: Boolean(image.data),
    }
  })
}
