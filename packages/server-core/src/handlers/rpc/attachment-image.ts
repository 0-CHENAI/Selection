import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IMAGE_LIMITS, resolveImageSendPolicy, type ImageSendPolicy } from '@craft-agent/shared/utils'
import { originalAttachmentFileName } from '@craft-agent/shared/utils/image-attachment'
import type { ImageProcessor, Logger } from '../../runtime/platform'
import { encodeImageForModel, imageHasAlphaChannel, inspectImageBuffer } from '../../services/image-utils'

export interface StoredAttachmentImage {
  wasResized: boolean
  finalSize: number
  resizedBase64?: string
  /** Present only when the bytes written to storedPath were downscaled or recompressed. */
  originalPath?: string
  originalWidth?: number
  originalHeight?: number
  sentWidth?: number
  sentHeight?: number
  /** Mime type of the bytes written to storedPath. */
  outputMimeType?: string
  writtenPaths: string[]
}

/**
 * Validate, maybe downscale, and write an image attachment.
 * The file at `storedFileName` is the copy sent to the model. The untouched
 * bytes are written beside it only when that copy is not the original.
 */
export async function storeAttachmentImage(input: {
  bytes: Buffer
  mimeType: string
  declaredSize: number
  attachmentsDir: string
  storedFileName: string
  processor: ImageProcessor
  logger: Logger
  policy?: ImageSendPolicy
}): Promise<StoredAttachmentImage> {
  let decoded = input.bytes
  let wasResized = false
  let finalSize = input.declaredSize
  let resizedBase64: string | undefined
  let originalBytes: Buffer | undefined
  let originalWidth: number | undefined
  let originalHeight: number | undefined

  const imageInspection = await inspectImageBuffer(decoded, input.processor)
  const imageSize = imageInspection.status === 'ok'
    ? { width: imageInspection.width, height: imageInspection.height }
    : null

  let sentWidth: number | undefined
  let sentHeight: number | undefined
  let outputMimeType: string | undefined

  if (imageInspection.status === 'processor_unavailable') {
    input.logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
    if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
      throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
    }
  } else if (imageInspection.status === 'invalid_image') {
    throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
  } else {
    const policy = input.policy ?? resolveImageSendPolicy()
    originalBytes = Buffer.from(decoded)
    originalWidth = imageSize!.width
    originalHeight = imageSize!.height
    try {
      const encoded = await encodeImageForModel(decoded, {
        sourceWidth: originalWidth,
        sourceHeight: originalHeight,
        hasAlpha: imageHasAlphaChannel(input.mimeType, imageInspection.hasAlpha),
        policy,
        processor: input.processor,
      })
      if (!encoded) {
        throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
      }
      const changed = encoded.buffer !== decoded || encoded.width !== originalWidth || encoded.height !== originalHeight
      if (changed) {
        input.logger.info(`Resizing image from ${originalWidth}x${originalHeight} to ${encoded.width}x${encoded.height}`)
        decoded = encoded.buffer
        wasResized = true
        finalSize = decoded.length
        sentWidth = encoded.width
        sentHeight = encoded.height
        outputMimeType = encoded.mimeType
        resizedBase64 = decoded.toString('base64')
        input.logger.info(`Image resized: ${input.declaredSize} -> ${finalSize} bytes (${Math.round((1 - finalSize / input.declaredSize) * 100)}% reduction)`)
      } else {
        originalBytes = undefined
        originalWidth = undefined
        originalHeight = undefined
      }
    } catch (resizeError) {
      input.logger.error('Image resize failed:', resizeError)
      const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
      if (reason.includes('still too large') || reason.includes('Please use a smaller image')) throw resizeError
      throw new Error(`Image too large (${imageSize!.width}x${imageSize!.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
    }
  }

  const writtenPaths: string[] = []
  let originalPath: string | undefined
  try {
    if (wasResized && originalBytes) {
      originalPath = join(input.attachmentsDir, originalAttachmentFileName(input.storedFileName))
      await writeFile(originalPath, originalBytes)
      writtenPaths.push(originalPath)
    }
    const storedPath = join(input.attachmentsDir, input.storedFileName)
    await writeFile(storedPath, decoded)
    writtenPaths.push(storedPath)
  } catch (error) {
    await Promise.all(writtenPaths.map(path => unlink(path).catch(() => {})))
    throw error
  }

  return {
    wasResized,
    finalSize,
    resizedBase64,
    originalPath: wasResized ? originalPath : undefined,
    originalWidth: wasResized ? originalWidth : undefined,
    originalHeight: wasResized ? originalHeight : undefined,
    sentWidth: wasResized ? sentWidth : undefined,
    sentHeight: wasResized ? sentHeight : undefined,
    outputMimeType: wasResized ? outputMimeType : undefined,
    writtenPaths,
  }
}
