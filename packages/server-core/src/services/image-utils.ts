import type { ImageProcessor } from '../runtime/platform'
import {
  IMAGE_ENCODING_QUALITIES,
  IMAGE_LIMITS,
  encodingMediaType,
  resolveImageSendPolicy,
  resolveImageSendSize,
  type ImageSendPolicy,
} from '@craft-agent/shared/utils'

export interface ImageResizeResult {
  /** Resized image buffer */
  buffer: Buffer
  /** Output dimensions */
  width: number
  height: number
  /** Output format */
  format: 'png' | 'jpeg' | 'webp'
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
}

let imageProcessor: ImageProcessor

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isImageProcessorUnavailableError(error: unknown): boolean {
  const message = toError(error).message.toLowerCase()
  return (
    (message.includes('cannot find package') || message.includes('cannot find module'))
    && message.includes('sharp')
  )
}

export type ImageBufferInspection =
  | { status: 'ok'; width: number; height: number; hasAlpha?: boolean }
  | { status: 'invalid_image'; error?: Error }
  | { status: 'processor_unavailable'; error?: Error }

/**
 * Inspect an uploaded image buffer and distinguish between invalid input and
 * unavailable image-processing support.
 */
export async function inspectImageBuffer(
  buffer: Buffer,
  processor: ImageProcessor,
): Promise<ImageBufferInspection> {
  try {
    const metadata = await processor.getMetadata(buffer)
    if (metadata?.width && metadata?.height) {
      return { status: 'ok', width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha }
    }
  } catch (error) {
    if (isImageProcessorUnavailableError(error)) {
      return { status: 'processor_unavailable', error: toError(error) }
    }
  }

  try {
    const normalized = await processor.process(buffer, { format: 'png' })
    const metadata = await processor.getMetadata(normalized)
    if (metadata?.width && metadata?.height) {
      return { status: 'ok', width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha }
    }
    return { status: 'invalid_image' }
  } catch (error) {
    if (isImageProcessorUnavailableError(error)) {
      return { status: 'processor_unavailable', error: toError(error) }
    }
    return { status: 'invalid_image', error: toError(error) }
  }
}

export function setImageProcessor(proc: ImageProcessor) {
  imageProcessor = proc
}

/**
 * Get image dimensions from a buffer.
 * Returns { width, height } or null if the buffer is not a valid image.
 */
export async function getImageSize(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    return await imageProcessor.getMetadata(buffer)
  } catch {
    return null
  }
}

/**
 * Resize an image buffer to fit within maxSize×maxSize, output as PNG.
 * Returns the resized PNG buffer, or undefined if the input is invalid.
 */
export async function resizeIconBuffer(buffer: Buffer, targetSize: number): Promise<Buffer | undefined> {
  try {
    return await imageProcessor.process(buffer, {
      resize: { width: targetSize, height: targetSize },
      fit: 'inside',
      format: 'png',
    })
  } catch {
    return undefined
  }
}

function sniffImageFormat(buffer: Buffer): ImageResizeResult['format'] {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg'
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp'
  return 'png'
}

function mimeForFormat(format: ImageResizeResult['format']): ImageResizeResult['mimeType'] {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

export function imageHasAlphaChannel(mimeType: string | undefined, hasAlpha?: boolean): boolean {
  if (typeof hasAlpha === 'boolean') return hasAlpha
  const mime = mimeType?.split(';')[0]?.trim().toLowerCase()
  return mime !== 'image/jpeg' && mime !== 'image/jpg'
}

/**
 * Encode one image onto the shared send-size target.
 * Qualities 85/75/60 are tried in order. The first output within `maxBytes`
 * wins; otherwise the smallest is kept. Returns null only when that smallest
 * output still exceeds the 5MB hard limit.
 */
export async function encodeImageForModel(
  source: Buffer,
  input: {
    sourceWidth: number
    sourceHeight: number
    hasAlpha: boolean
    policy?: ImageSendPolicy
    processor: ImageProcessor
    maxBytes?: number
  },
): Promise<ImageResizeResult | null> {
  const policy = input.policy ?? resolveImageSendPolicy()
  const byteTarget = input.maxBytes ?? policy.maxBytes
  const target = resolveImageSendSize(input.sourceWidth, input.sourceHeight, policy)
  const geometryFits = target.width === input.sourceWidth && target.height === input.sourceHeight
  if (geometryFits && source.length <= byteTarget && source.length <= IMAGE_LIMITS.MAX_SIZE) {
    const format = sniffImageFormat(source)
    return {
      buffer: source,
      width: target.width,
      height: target.height,
      format,
      mimeType: mimeForFormat(format),
    }
  }

  const format = encodingMediaType(input.hasAlpha) === 'image/webp' ? 'webp' : 'jpeg'
  let smallest: Buffer | null = null
  for (const quality of IMAGE_ENCODING_QUALITIES) {
    const output = await input.processor.process(source, {
      ...(geometryFits ? {} : {
        resize: { width: target.width, height: target.height },
        fit: 'inside',
        withoutEnlargement: true,
      }),
      format,
      quality,
      ...(format === 'webp' ? { effort: 0 } : {}),
      normalize: true,
    })
    if (!smallest || output.length < smallest.length) smallest = output
    if (output.length <= byteTarget) {
      smallest = output
      break
    }
  }
  if (!smallest || smallest.length > IMAGE_LIMITS.MAX_SIZE) return null
  return {
    buffer: smallest,
    width: target.width,
    height: target.height,
    format,
    mimeType: mimeForFormat(format),
  }
}

/**
 * Resize and/or compress an image buffer for a model request.
 * Uses the shared pixel budget (or the DeepSeek token grid when `policy` says so).
 * Returns null when the smallest ladder output still exceeds the hard size limit.
 */
export async function resizeImageForAPI(
  buffer: Buffer,
  options?: {
    /** Override the policy byte target. The 5MB hard limit still applies. */
    maxSizeBytes?: number
    /** Force JPEG output. */
    isPhoto?: boolean
    policy?: ImageSendPolicy
    processor?: ImageProcessor
  },
): Promise<ImageResizeResult | null> {
  const processor = options?.processor ?? imageProcessor
  const metadata = await processor.getMetadata(buffer).catch(() => null)
  if (!metadata) return null
  return encodeImageForModel(buffer, {
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    hasAlpha: options?.isPhoto ? false : imageHasAlphaChannel(undefined, metadata.hasAlpha),
    policy: options?.policy,
    processor,
    maxBytes: options?.maxSizeBytes,
  })
}
