import { encodedSize } from './image-resize-core.ts'
import { runImageOptimizer, type ImageResizeRunnerDependencies } from './image-resize-runner.ts'
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_MAX_ENCODED_BYTES,
  DEFAULT_MAX_HEIGHT,
  DEFAULT_MAX_WIDTH,
} from './image-resize-types.ts'
import type { ImageProcessingFailureCode, ImageResizeLimits } from './image-resize-types.ts'

export type { ImageProcessingFailureCode } from './image-resize-types.ts'

export type ProcessedReadImage =
  | {
      ok: true
      data: string
      mimeType: string
      hints: string[]
    }
  | {
      ok: false
      code: ImageProcessingFailureCode
      message: string
    }

export interface ReadImageProcessingOptions {
  maxWidth?: number
  maxHeight?: number
  maxEncodedBytes?: number
  jpegQuality?: number
}

export interface ReadImageProcessingDependencies {
  optimize?: typeof runImageOptimizer
  runner?: ImageResizeRunnerDependencies
}

interface ImageDimensions {
  width: number
  height: number
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType.toLowerCase()
}

function normalizeInlineMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case 'image/png':
      return 'image/png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg'
    case 'image/gif':
      return 'image/gif'
    case 'image/webp':
      return 'image/webp'
    default:
      return null
  }
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function inspectPng(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || Buffer.from(bytes.subarray(12, 16)).toString('ascii') !== 'IHDR') return null
  const width = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(16)
  const height = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

function inspectGif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10 || Buffer.from(bytes.subarray(0, 3)).toString('ascii') !== 'GIF') return null
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8)
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8)
  return width > 0 && height > 0 ? { width, height } : null
}

function inspectJpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) continue
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 1 >= bytes.length) return null
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && segmentLength >= 7) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0)
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += segmentLength
  }
  return null
}

function inspectWebp(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 30
    || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF'
    || Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WEBP'
  ) return null

  const chunk = Buffer.from(bytes.subarray(12, 16)).toString('ascii')
  if (chunk === 'VP8X') {
    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    }
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21] ?? 0
    const b2 = bytes[22] ?? 0
    const b3 = bytes[23] ?? 0
    const b4 = bytes[24] ?? 0
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    }
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff
    const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

export function inspectImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  switch (normalizeInlineMimeType(mimeType)) {
    case 'image/png':
      return inspectPng(bytes)
    case 'image/jpeg':
      return inspectJpeg(bytes)
    case 'image/gif':
      return inspectGif(bytes)
    case 'image/webp':
      return inspectWebp(bytes)
    default:
      return null
  }
}

function failure(code: ImageProcessingFailureCode, detail: string): ProcessedReadImage {
  return {
    ok: false,
    code,
    message: `[Image omitted: ${code}: ${detail}]`,
  }
}

function isWithinLimits(
  dimensions: ImageDimensions,
  byteLength: number,
  maxWidth: number,
  maxHeight: number,
  maxEncodedBytes: number,
): boolean {
  return dimensions.width <= maxWidth
    && dimensions.height <= maxHeight
    && encodedSize(byteLength) < maxEncodedBytes
}

export async function processReadImage(
  bytes: Uint8Array,
  mimeType: string,
  options: ReadImageProcessingOptions = {},
  dependencies: ReadImageProcessingDependencies = {},
  signal?: AbortSignal,
): Promise<ProcessedReadImage> {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT
  const maxEncodedBytes = options.maxEncodedBytes ?? DEFAULT_MAX_ENCODED_BYTES
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY
  const inlineMimeType = normalizeInlineMimeType(mimeType)
  const inspectedDimensions = inspectImageDimensions(bytes, mimeType)

  if (inlineMimeType && inspectedDimensions && isWithinLimits(
    inspectedDimensions,
    bytes.byteLength,
    maxWidth,
    maxHeight,
    maxEncodedBytes,
  )) {
    return {
      ok: true,
      data: Buffer.from(bytes).toString('base64'),
      mimeType: inlineMimeType,
      hints: [],
    }
  }

  const limits: ImageResizeLimits = { maxWidth, maxHeight, maxEncodedBytes, jpegQuality }
  const optimized = await (dependencies.optimize ?? runImageOptimizer)(
    bytes,
    mimeType,
    limits,
    signal,
    dependencies.runner,
  )
  if (!optimized.ok) return failure(optimized.code, optimized.detail)

  const outputEncodedSize = encodedSize(optimized.bytes.byteLength)
  if (outputEncodedSize >= maxEncodedBytes) {
    return failure(
      'image_size_limit_exceeded',
      `Encoded image is ${outputEncodedSize} bytes; limit is ${maxEncodedBytes} bytes.`,
    )
  }
  const data = Buffer.from(optimized.bytes).toString('base64')

  const hints: string[] = []
  const sourceMimeType = normalizeInlineMimeType(mimeType) ?? baseMimeType(mimeType)
  if (sourceMimeType !== optimized.mimeType) {
    const gifNote = sourceMimeType === 'image/gif'
      ? ' Oversized GIFs are represented by the first decoded frame.'
      : ''
    hints.push(`[Image converted from ${sourceMimeType} to ${optimized.mimeType}.${gifNote}]`)
  }
  if (optimized.wasResized) {
    const scale = optimized.originalWidth / optimized.width
    hints.push(
      `[Image: original ${optimized.originalWidth}x${optimized.originalHeight}, displayed at ${optimized.width}x${optimized.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`,
    )
  }
  return {
    ok: true,
    data,
    mimeType: optimized.mimeType,
    hints,
  }
}
