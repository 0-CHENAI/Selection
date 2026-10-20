import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IMAGE_LIMITS, validateImageForClaudeAPI } from '@craft-agent/shared/utils'
import { originalAttachmentFileName } from '@craft-agent/shared/utils/image-attachment'
import type { ImageProcessor, Logger } from '../../runtime/platform'
import { inspectImageBuffer, resizeImageForAPI } from '../../services/image-utils'

export interface StoredAttachmentImage {
  wasResized: boolean
  finalSize: number
  resizedBase64?: string
  /** Present only when the bytes written to storedPath were downscaled or recompressed. */
  originalPath?: string
  originalWidth?: number
  originalHeight?: number
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

  let shouldResize = false
  let targetSize: { width: number; height: number } | undefined

  if (imageInspection.status === 'processor_unavailable') {
    input.logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
    if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
      throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
    }
  } else if (imageInspection.status === 'invalid_image') {
    throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
  } else {
    const validation = validateImageForClaudeAPI(decoded.length, imageSize!.width, imageSize!.height)
    shouldResize = validation.needsResize ?? false
    targetSize = validation.suggestedSize

    if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
      const maxDim = IMAGE_LIMITS.MAX_DIMENSION
      const scale = Math.min(maxDim / imageSize!.width, maxDim / imageSize!.height)
      targetSize = {
        width: Math.floor(imageSize!.width * scale),
        height: Math.floor(imageSize!.height * scale),
      }
      shouldResize = true
      input.logger.info(`Image exceeds ${maxDim}px limit (${imageSize!.width}x${imageSize!.height}), will resize to ${targetSize.width}x${targetSize.height}`)
    } else if (!validation.valid && validation.errorCode === 'size_exceeded') {
      shouldResize = true
      input.logger.info(`Image exceeds 5MB (${(decoded.length / 1024 / 1024).toFixed(1)}MB), will attempt resize`)
    } else if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  if (shouldResize) {
    // Snapshot before process() replaces the buffer. This is the only copy of the original.
    originalBytes = Buffer.from(decoded)
    originalWidth = imageSize!.width
    originalHeight = imageSize!.height
    const isPhoto = input.mimeType === 'image/jpeg'

    if (targetSize) {
      input.logger.info(`Resizing image from ${imageSize!.width}x${imageSize!.height} to ${targetSize.width}x${targetSize.height}`)
      try {
        decoded = await input.processor.process(decoded, {
          resize: { width: targetSize.width, height: targetSize.height },
          format: isPhoto ? 'jpeg' : 'png',
          quality: isPhoto ? IMAGE_LIMITS.JPEG_QUALITY_HIGH : undefined,
        })
        wasResized = true
        finalSize = decoded.length

        if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
          decoded = await input.processor.process(decoded, { format: 'jpeg', quality: IMAGE_LIMITS.JPEG_QUALITY_FALLBACK })
          finalSize = decoded.length
          if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
            throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
          }
        }
      } catch (resizeError) {
        input.logger.error('Image resize failed:', resizeError)
        const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
        throw new Error(`Image too large (${imageSize!.width}x${imageSize!.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
      }
    } else {
      const result = await resizeImageForAPI(decoded, { isPhoto })
      if (!result) {
        throw new Error(`Image too large (${(decoded.length / 1024 / 1024).toFixed(1)}MB) and could not be compressed enough. Please use a smaller image.`)
      }
      decoded = result.buffer
      wasResized = true
      finalSize = decoded.length
    }

    input.logger.info(`Image resized: ${input.declaredSize} -> ${finalSize} bytes (${Math.round((1 - finalSize / input.declaredSize) * 100)}% reduction)`)
    resizedBase64 = decoded.toString('base64')
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
    writtenPaths,
  }
}
