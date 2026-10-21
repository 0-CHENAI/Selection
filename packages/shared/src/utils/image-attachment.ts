import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

/**
 * Full-resolution sibling kept beside a downscaled session attachment.
 * `id_pasted-image-1.png` -> `id_pasted-image-1.original.png`
 *
 * The id prefix is the attachment UUID, so a user file that merely contains
 * ".original" in its name is not treated as this sibling.
 */
const ORIGINAL_ATTACHMENT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_.+\.original(?:\.[^.]+)?$/i

export function originalAttachmentFileName(storedFileName: string): string {
  const extension = extname(storedFileName)
  if (!extension) return `${storedFileName}.original`
  return `${storedFileName.slice(0, -extension.length)}.original${extension}`
}

/** True only for the full-resolution file saved next to a resized attachment. */
export function isOriginalFullResolutionAttachment(filePath: string): boolean {
  if (!filePath || basename(dirname(filePath)) !== 'attachments') return false
  return ORIGINAL_ATTACHMENT_NAME.test(basename(filePath))
}

export function formatAttachedImagePrompt(input: {
  name: string
  path: string
  originalPath?: string
  originalWidth?: number
  originalHeight?: number
  sentWidth?: number
  sentHeight?: number
}): string {
  const lines = [
    `[Attached image: ${input.name}]`,
    `The image is included as visual input — look at it. Path: ${input.path}`,
  ]
  if (input.sentWidth && input.sentHeight) {
    lines.push(`Sent to the model at ${input.sentWidth}x${input.sentHeight}.`)
  }
  if (input.originalPath) {
    const sized = input.originalWidth && input.originalHeight
      ? ` (${input.originalWidth}x${input.originalHeight})`
      : ''
    lines.push(`Original full-resolution file for cropping/zooming: ${input.originalPath}${sized}`)
  }
  return lines.join('\n')
}

/**
 * Prompt text for one image attachment.
 * The inline image stays the downscaled `storedPath`. The original line is
 * included only when that full-resolution sibling is actually on disk.
 */
export function buildAttachedImagePrompt(attachment: {
  name: string
  storedPath?: string
  path?: string
  originalPath?: string
  originalWidth?: number
  originalHeight?: number
  sentWidth?: number
  sentHeight?: number
}): string | undefined {
  const stored = attachment.storedPath || attachment.path
  if (!stored) return undefined
  const candidate = attachment.originalPath
    ?? join(dirname(stored), originalAttachmentFileName(basename(stored)))
  const originalPath = isOriginalFullResolutionAttachment(candidate) && existsSync(candidate)
    ? candidate
    : undefined
  return formatAttachedImagePrompt({
    name: attachment.name,
    path: stored,
    originalPath,
    originalWidth: originalPath ? attachment.originalWidth : undefined,
    originalHeight: originalPath ? attachment.originalHeight : undefined,
    sentWidth: originalPath ? attachment.sentWidth : undefined,
    sentHeight: originalPath ? attachment.sentHeight : undefined,
  })
}
