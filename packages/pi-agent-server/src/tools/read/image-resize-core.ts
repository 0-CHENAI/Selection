import { applyExifOrientation } from './exif-orientation.ts'
import { MAX_RESIZE_PASSES, MIN_JPEG_QUALITY } from './image-resize-types.ts'
import type {
  ImageOptimizationResult,
  ImageProcessingFailureCode,
  ImageResizeLimits,
} from './image-resize-types.ts'
import { loadPhoton, type PhotonImageLike, type PhotonModuleLike } from './photon-runtime.ts'

interface EncodingCandidate {
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  jpegQuality?: number
}

interface JpegSearchResult {
  candidate?: EncodingCandidate
  smallestEncodedSize: number
  attempts: number
}

export interface ImageResizeCoreDependencies {
  loadPhoton?: () => Promise<PhotonModuleLike>
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType.toLowerCase()
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 300) || 'unknown error'
}

function failure(code: ImageProcessingFailureCode, error: unknown): ImageOptimizationResult {
  return { ok: false, code, detail: errorDetail(error) }
}

export function encodedSize(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4
}

function fitsEncodedLimit(bytes: Uint8Array, maxEncodedBytes: number): boolean {
  return encodedSize(bytes.byteLength) < maxEncodedBytes
}

function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function compositeOnWhite(
  photon: PhotonModuleLike,
  image: PhotonImageLike,
): PhotonImageLike | null {
  const pixels = image.get_raw_pixels()
  let hasTransparency = false
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 255) < 255) {
      hasTransparency = true
      break
    }
  }
  if (!hasTransparency) return null

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = (pixels[index + 3] ?? 255) / 255
    pixels[index] = Math.round((pixels[index] ?? 0) * alpha + 255 * (1 - alpha))
    pixels[index + 1] = Math.round((pixels[index + 1] ?? 0) * alpha + 255 * (1 - alpha))
    pixels[index + 2] = Math.round((pixels[index + 2] ?? 0) * alpha + 255 * (1 - alpha))
    pixels[index + 3] = 255
  }
  return new photon.PhotonImage(pixels, image.get_width(), image.get_height())
}

function searchJpegQuality(
  image: PhotonImageLike,
  requestedQuality: number,
  maxEncodedBytes: number,
): JpegSearchResult {
  const maximumQuality = Math.max(MIN_JPEG_QUALITY, Math.min(100, Math.round(requestedQuality)))
  let attempts = 0
  let smallestEncodedSize = Number.POSITIVE_INFINITY
  const encode = (quality: number): Uint8Array => {
    attempts += 1
    const bytes = image.get_bytes_jpeg(quality)
    smallestEncodedSize = Math.min(smallestEncodedSize, encodedSize(bytes.byteLength))
    return bytes
  }

  {
    const bytes = encode(maximumQuality)
    if (fitsEncodedLimit(bytes, maxEncodedBytes)) {
      return {
        candidate: { bytes, mimeType: 'image/jpeg', jpegQuality: maximumQuality },
        smallestEncodedSize,
        attempts,
      }
    }
  }
  if (maximumQuality === MIN_JPEG_QUALITY) {
    return { smallestEncodedSize, attempts }
  }

  const minimumBytes = encode(MIN_JPEG_QUALITY)
  if (!fitsEncodedLimit(minimumBytes, maxEncodedBytes)) {
    return { smallestEncodedSize, attempts }
  }

  let bestBytes = minimumBytes
  let bestQuality = MIN_JPEG_QUALITY
  let low = MIN_JPEG_QUALITY + 1
  let high = maximumQuality - 1
  while (low <= high) {
    const quality = Math.floor((low + high) / 2)
    const bytes = encode(quality)
    if (fitsEncodedLimit(bytes, maxEncodedBytes)) {
      bestBytes = bytes
      bestQuality = quality
      low = quality + 1
    } else {
      high = quality - 1
    }
  }
  return {
    candidate: { bytes: bestBytes, mimeType: 'image/jpeg', jpegQuality: bestQuality },
    smallestEncodedSize,
    attempts,
  }
}

function nextDimensions(
  width: number,
  height: number,
  encodedBytes: number,
  maxEncodedBytes: number,
): { width: number; height: number } | null {
  if (width === 1 && height === 1) return null
  const estimatedScale = Math.sqrt((maxEncodedBytes * 0.98) / encodedBytes)
  const scale = Math.min(0.95, Math.max(0.5, estimatedScale))
  let nextWidth = Math.max(1, Math.floor(width * scale))
  let nextHeight = Math.max(1, Math.floor(height * scale))
  if (nextWidth === width && width > 1) nextWidth -= 1
  if (nextHeight === height && height > 1) nextHeight -= 1
  return { width: nextWidth, height: nextHeight }
}

export async function optimizeImageInProcess(
  inputBytes: Uint8Array,
  mimeType: string,
  limits: ImageResizeLimits,
  dependencies: ImageResizeCoreDependencies = {},
): Promise<ImageOptimizationResult> {
  let photon: PhotonModuleLike
  try {
    photon = await (dependencies.loadPhoton ?? loadPhoton)()
  } catch (error) {
    return failure('image_runtime_unavailable', `Photon could not be loaded: ${errorDetail(error)}`)
  }

  let decoded: PhotonImageLike
  try {
    decoded = photon.PhotonImage.new_from_byteslice(inputBytes)
  } catch (error) {
    return failure('image_decode_failed', error)
  }

  let image = decoded
  try {
    image = applyExifOrientation(photon, decoded, inputBytes)
    if (image !== decoded) decoded.free()
  } catch (error) {
    decoded.free()
    return failure('image_decode_failed', error)
  }

  try {
    const originalWidth = image.get_width()
    const originalHeight = image.get_height()
    let current = fitDimensions(originalWidth, originalHeight, limits.maxWidth, limits.maxHeight)
    const preferJpeg = baseMimeType(mimeType) === 'image/jpeg' || baseMimeType(mimeType) === 'image/jpg'
    let encodingAttempts = 0

    for (let resizePasses = 1; resizePasses <= MAX_RESIZE_PASSES; resizePasses += 1) {
      let workingImage = image
      if (current.width !== originalWidth || current.height !== originalHeight) {
        try {
          workingImage = photon.resize(
            image,
            current.width,
            current.height,
            photon.SamplingFilter.Lanczos3,
          )
        } catch (error) {
          return failure('image_resize_failed', error)
        }
      }

      let jpegImage: PhotonImageLike | null = null
      try {
        let smallestEncodedSize = Number.POSITIVE_INFINITY
        if (!preferJpeg) {
          let pngBytes: Uint8Array
          try {
            pngBytes = workingImage.get_bytes()
          } catch (error) {
            return failure('image_conversion_failed', error)
          }
          encodingAttempts += 1
          smallestEncodedSize = encodedSize(pngBytes.byteLength)
          if (fitsEncodedLimit(pngBytes, limits.maxEncodedBytes)) {
            return {
              ok: true,
              bytes: pngBytes,
              mimeType: 'image/png',
              originalWidth,
              originalHeight,
              width: current.width,
              height: current.height,
              wasResized: current.width !== originalWidth || current.height !== originalHeight,
              encodingAttempts,
              resizePasses,
            }
          }

          try {
            jpegImage = compositeOnWhite(photon, workingImage)
          } catch (error) {
            return failure('image_conversion_failed', error)
          }
        }

        let jpegSearch: JpegSearchResult
        try {
          jpegSearch = searchJpegQuality(
            jpegImage ?? workingImage,
            limits.jpegQuality,
            limits.maxEncodedBytes,
          )
        } catch (error) {
          return failure('image_conversion_failed', error)
        }
        encodingAttempts += jpegSearch.attempts
        smallestEncodedSize = Math.min(smallestEncodedSize, jpegSearch.smallestEncodedSize)
        if (jpegSearch.candidate) {
          return {
            ok: true,
            bytes: jpegSearch.candidate.bytes,
            mimeType: 'image/jpeg',
            originalWidth,
            originalHeight,
            width: current.width,
            height: current.height,
            wasResized: current.width !== originalWidth || current.height !== originalHeight,
            jpegQuality: jpegSearch.candidate.jpegQuality,
            encodingAttempts,
            resizePasses,
          }
        }

        const next = nextDimensions(
          current.width,
          current.height,
          smallestEncodedSize,
          limits.maxEncodedBytes,
        )
        if (!next) break
        current = next
      } finally {
        jpegImage?.free()
        if (workingImage !== image) workingImage.free()
      }
    }

    return failure(
      'image_size_limit_exceeded',
      `Image could not be encoded below ${limits.maxEncodedBytes} bytes in ${MAX_RESIZE_PASSES} resize passes.`,
    )
  } catch (error) {
    return failure('image_decode_failed', error)
  } finally {
    image.free()
  }
}
